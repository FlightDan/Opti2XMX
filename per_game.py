#!/usr/bin/env python3
"""Reversible, user-owned deployment of a staged xess-xmx-linux release."""
import argparse
import contextlib
import datetime
import fcntl
import json
import os
from pathlib import Path
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile


MODERN_REQUIRED = ("lib/active", "lib/mesa-26.3.1/libvulkan_intel.so",
                   "lib/mesa-stock-26.3.1/libvulkan_intel.so", "lib/mesa-26.1.2/libvulkan_intel.so",
                   "lib/deps/libSPIRV-Tools.so", "lib/deps/libdisplay-info.so.3",
                   "layer/libVkLayer_xess_xmx.so", "layer/VkLayer_xess_xmx.json", "layer/gpu-ids.txt")


def modern_layout(package, required=False):
    modern = required or any((package / p).exists() for p in ("lib/active", "layer", "lib/mesa-26.3.1"))
    if modern:
        for name in MODERN_REQUIRED:
            p = package / name
            if p.is_symlink() or not p.is_file() or not p.stat().st_size:
                raise RuntimeError("Incomplete modern XMX runtime: " + name)
        if (package / "lib/active").read_text().strip() != "26.3.1":
            raise RuntimeError("Unsupported active Mesa version")
    return modern


DLL_REL = Path("drive_c/opti2xmx-driver/igdext64.dll")
OWNER_REL = Path(".oxp3-xess-owner.json")
DIAGNOSTICS = ("igdext_kernels", "igdext_dump", "igdext_trace.log", "igdext_xell.log")


def dxgi_identity_config():
    # Proton's DXVK can unconditionally hide Intel when libxess is loaded.
    # An explicit vendor bypasses that branch; -1 keeps the physical device ID.
    return ('\n# Opti2XMX: retain Intel identity through DXVK\n'
            'export DXVK_CONFIG="${DXVK_CONFIG:+$DXVK_CONFIG;}dxgi.customVendorId = 8086;'
            'dxgi.customDeviceId = -1;dxgi.customDeviceDesc = \\\"\\\""\n')


def dll_overrides_config(*names):
    """Replace only our DLL names, preserving unrelated inherited Wine overrides."""
    code = ('import sys; names=set(sys.argv[2:]); parts=[]\n'
            'for item in sys.argv[1].split(";"):\n'
            ' key,sep,value=item.partition("="); aliases=key.split(",")\n'
            ' kept=[alias for alias in aliases if alias.strip().lower() not in names]\n'
            ' if sep and kept: parts.append(",".join(kept)+"="+value)\n'
            ' elif not sep and item.strip() and key.strip().lower() not in names: parts.append(item)\n'
            'parts.extend(name+"=n,b" for name in sys.argv[2:]); print(";".join(parts))')
    return ('WINEDLLOVERRIDES="$(python3 -c ' + shlex.quote(code) +
            ' "${WINEDLLOVERRIDES-}" ' + ' '.join(shlex.quote(name) for name in names) +
            ')"\nexport WINEDLLOVERRIDES\n')


def dll_environment_config(prefix, dll):
    drive = windows_prefix_path(prefix, Path('drive_c'))
    if drive not in dll.parents:
        raise RuntimeError('DLL path must remain inside its original prefix drive_c')
    winpath = 'C:\\' + str(dll.parent.relative_to(drive)).replace('/', '\\')
    return ('export INTC_ALT_DRIVER_EXTENSIONS_PATH=' + shlex.quote(winpath) + '\n' +
            dll_overrides_config('igdext64'))


def absolute(value):
    # Keep the spelling of symlinks so mutation checks can reject them.
    return Path(os.path.abspath(os.path.expanduser(str(value))))


def windows_prefix_path(prefix, relative):
    """Reuse Wine's existing Windows directory spelling on case-sensitive hosts."""
    path = prefix
    for component in relative.parts:
        if path.is_symlink():
            raise RuntimeError(f"Symlink parent is not supported: {path}")
        matches = [entry for entry in path.iterdir()
                   if entry.name.casefold() == component.casefold()] if path.is_dir() else []
        if len(matches) > 1:
            raise RuntimeError(f"Ambiguous Windows path spelling below {path}: {component}")
        path = matches[0] if matches else path / component
    return path


def prefix_dll_path(prefix):
    return windows_prefix_path(prefix, DLL_REL)


def recorded_dll_path(manifest):
    prefix = Path(manifest["prefix"])
    records = [record for record in manifest["files"] if record["label"] == "igdext64.dll"]
    if len(records) != 1:
        raise RuntimeError("Backup must contain exactly one DLL path")
    path = Path(records[0]["path"])
    if not path.is_absolute() or ".." in path.parts or prefix not in path.parents:
        raise RuntimeError("DLL backup path must remain inside its original prefix")
    return path


def exists(path):
    return os.path.lexists(path)


def ordinary_user():
    if os.geteuid() == 0 or os.getuid() != os.geteuid() or "SUDO_UID" in os.environ:
        raise RuntimeError("Run directly as the ordinary prefix owner; root/sudo installation or restore is not supported")


def owned_directory(path):
    if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid():
        raise RuntimeError(f"Output directory must belong to the current user: {path}")


def owned_outputs(prefix, state, config, dll):
    """Check ownership before even creating backup state, including absent DLL cases."""
    owned_directory(prefix)
    owned_directory(state if exists(state) else state.parent)
    parent = dll.parent
    while parent != prefix:
        if exists(parent):
            owned_directory(parent)
        parent = parent.parent
    parent = config.parent
    while not exists(parent):
        parent = parent.parent
    owned_directory(parent)
    for path in (dll, config):
        if exists(path) and path.lstat().st_uid != os.getuid():
            raise RuntimeError(f"Output file must belong to the current user: {path}")


def no_symlink_parents(path):
    for parent in (path.parent, *path.parents):
        if parent.is_symlink():
            raise RuntimeError(f"Symlink parent is not supported: {parent}")
        if exists(parent) and not parent.is_dir():
            raise RuntimeError(f"Parent is not a directory: {parent}")


def atomic_text(path, text, mode=0o600):
    no_symlink_parents(path)
    fd, tmp = tempfile.mkstemp(prefix=".xess-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if os.path.lexists(tmp):
            os.unlink(tmp)


def atomic_copy(source, target):
    no_symlink_parents(target)
    fd, tmp = tempfile.mkstemp(prefix=".xess-", dir=target.parent)
    os.close(fd)
    try:
        shutil.copy2(source, tmp)
        os.replace(tmp, target)
    finally:
        if os.path.lexists(tmp):
            os.unlink(tmp)


def save(state, manifest):
    atomic_text(state / "manifest.json", json.dumps(manifest, indent=2) + "\n")


def load(state):
    no_symlink_parents(state / "manifest.json")
    manifest = json.loads((state / "manifest.json").read_text())
    if manifest.get("schema") != 1 or manifest.get("state") != str(state):
        raise RuntimeError("Unsupported or relocated backup state; use its original absolute path")
    return manifest


@contextlib.contextmanager
def prefix_lock(prefix, inherit=False):
    fd = os.open(prefix, os.O_RDONLY | os.O_DIRECTORY)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("This prefix is in use by another wrapper operation") from error
        if inherit:
            os.set_inheritable(fd, True)
        yield fd
    finally:
        os.close(fd)


def game_idle(prefix, game_exe):
    """Refuse live same-user game/prefix processes; no process signalling."""
    ancestors = set()
    pid = os.getpid()
    while pid > 1 and pid not in ancestors:
        ancestors.add(pid)
        try:
            pid = int(Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[1])
        except (FileNotFoundError, ProcessLookupError):
            break
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit() or int(proc.name) in ancestors:
            continue
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            argv = (proc / "cmdline").read_bytes().decode(errors="replace").split("\0")
            words = [word.replace("\\", "/").rsplit("/", 1)[-1].casefold() for word in argv]
            if game_exe.casefold() in words:
                raise RuntimeError(f"Game is running (PID {proc.name}); close it first")
            try:
                env = dict(word.split("=", 1) for word in
                           (proc / "environ").read_bytes().decode(errors="replace").split("\0")
                           if "=" in word)
            except PermissionError:
                # Some same-user setuid processes hide environ; reject only Wine-like ones.
                if any("wine" in word or "proton" in word for word in words):
                    raise RuntimeError(f"Cannot establish prefix idle state for PID {proc.name}")
                continue
            wine_prefix = env.get("WINEPREFIX")
            compatdata = env.get("STEAM_COMPAT_DATA_PATH")
            same = bool(wine_prefix and os.path.realpath(wine_prefix) == str(prefix))
            same |= bool(compatdata and os.path.realpath(compatdata) == str(prefix.parent))
            if same:
                raise RuntimeError(f"Prefix is in use (PID {proc.name}); close its Proton processes first")
        except (FileNotFoundError, ProcessLookupError):
            continue


def stock_icds():
    paths = []
    roots = [Path("/usr/share/vulkan/icd.d"), Path("/usr/local/share/vulkan/icd.d"),
             Path("/etc/vulkan/icd.d"),
             Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "vulkan/icd.d"]
    for root in roots:
        for item in sorted(root.glob("*.json")):
            if item.is_file() and str(item) not in paths:
                paths.append(str(item))
    return paths


def host_environment():
    # Decky's frozen PluginLoader exports its bundled loader libraries. Host
    # tools need the original environment, and are never PluginLoader itself.
    env = os.environ.copy()
    original = env.pop('LD_LIBRARY_PATH_ORIG', None)
    if original:
        env['LD_LIBRARY_PATH'] = original
    else:
        env.pop('LD_LIBRARY_PATH', None)
    env.pop('PYTHONHOME', None)
    env.pop('PYTHONPATH', None)
    return env


def host_python(env):
    python = shutil.which('python3', path=env.get('PATH'))
    if not python:
        raise FileNotFoundError('Host python3 is required for XMX validation')
    return python


def driver_check(package, icd):
    """Resolve dependencies and enumerate a GPU, in child processes only."""
    try:
        modern = modern_layout(package)
        lib = Path(json.loads(icd.read_text())["ICD"]["library_path"]) if modern else package / "lib/libvulkan_intel.so"
        env = host_environment()
        if modern:
            env["LD_LIBRARY_PATH"] = str(package / "lib/deps") + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
            layer = package / "layer/libVkLayer_xess_xmx.so"
            for item in (lib, layer):
                result = subprocess.run(["ldd", str(item)], env=env, capture_output=True, text=True, timeout=20)
                if result.returncode or "not found" in result.stdout + result.stderr:
                    return False, "Runtime dependency check failed:\n" + result.stdout + result.stderr
        python = host_python(env)
        result = subprocess.run(["ldd", str(lib)], env=env, capture_output=True, text=True, timeout=20)
        report = result.stdout + result.stderr
        if result.returncode or "not found" in report:
            return False, "ldd failed or dependencies missing:\n" + report
        result = subprocess.run(
            [python, "-c", "import ctypes,sys; ctypes.CDLL(sys.argv[1], mode=ctypes.RTLD_LOCAL)", str(lib)],
            env=env, capture_output=True, text=True, timeout=20)
        if result.returncode:
            return False, "driver load failed:\n" + result.stderr
        env.update(VK_DRIVER_FILES=str(icd))
        if modern and "mesa-stock-26.3.1" in str(lib):
            env.pop("VK_LOADER_LAYERS_DISABLE", None)
            env.pop("XMX_LAYER_DISABLE", None)
            env.update(VK_ADD_LAYER_PATH=str(package / "layer"), VK_LOADER_LAYERS_ENABLE="VK_LAYER_XESS_xmx",
                       XMX_LAYER_HELPER=str(package / "tools/cm-compile.sh"), XMX_IGC_DIR=str(package / "igc"))
        else:
            env["VK_LOADER_LAYERS_DISABLE"] = "*"
            if modern:
                env["XMX_LAYER_DISABLE"] = "1"
        result = subprocess.run(["vulkaninfo", "--summary"], env=env, capture_output=True, text=True, timeout=20)
        report = result.stdout + result.stderr
        if result.returncode or "deviceName" not in report:
            return False, "Vulkan enumeration failed:\n" + report
        if modern and "mesa-stock-26.3.1" in str(lib) and "VK_LAYER_XESS_xmx" not in report:
            return False, "XMX Vulkan layer unavailable:\n" + report
        return True, report
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.TimeoutExpired) as error:
        return False, str(error)


def compiler_check(package):
    """Detect missing or unloadable toolchain before XeSS can select its CM path."""
    helper = package / "tools/cm-compile.sh"
    packer = package / "tools/cmk_pack.py"
    igc = package / "igc/igc/local/lib"
    neo = package / "igc/neo"
    # Match upstream helper's first sorted ocloc glob; do not silently choose another.
    candidates = sorted((neo / "bin").glob("ocloc*"))
    if not helper.is_file() or not os.access(helper, os.X_OK):
        return False, "Compiler helper is missing or not executable"
    if not packer.is_file() or not os.access(packer, os.R_OK):
        return False, "Kernel packer is missing or unreadable"
    if not candidates or not candidates[0].is_file() or not os.access(candidates[0], os.X_OK):
        return False, "ocloc is missing or not executable"
    libraries = []
    for pattern in ("libigc.so*", "libigdfcl.so*"):
        matches = sorted(path for path in igc.glob(pattern) if path.is_file())
        if not matches:
            return False, "Required IGC libraries libigc.so*/libigdfcl.so* are missing"
        libraries.append(matches[0])
    env = host_environment()
    paths = [str(igc), str(neo / "lib/x86_64-linux-gnu")]
    if env.get("LD_LIBRARY_PATH"):
        paths.append(env["LD_LIBRARY_PATH"])
    env["LD_LIBRARY_PATH"] = ":".join(paths)
    try:
        python = host_python(env)
        result = subprocess.run(["bash", "-n", str(helper)], env=env,
                                capture_output=True, text=True, timeout=20)
        if result.returncode:
            return False, "Compiler helper syntax failed:\n" + result.stderr
        result = subprocess.run([python, "-c",
                                 "import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())", str(packer)],
                                env=env, capture_output=True, text=True, timeout=20)
        if result.returncode:
            return False, "Kernel packer syntax failed:\n" + result.stderr
        for library in [candidates[0], *libraries]:
            result = subprocess.run(["ldd", str(library)], env=env,
                                    capture_output=True, text=True, timeout=20)
            report = result.stdout + result.stderr
            if result.returncode or "not found" in report:
                return False, "Compiler dependencies failed:\n" + report
        result = subprocess.run(
            [python, "-c",
             "import ctypes,sys; [ctypes.CDLL(p, mode=ctypes.RTLD_LOCAL) for p in sys.argv[1:]]",
             *map(str, libraries)], env=env, capture_output=True, text=True, timeout=20)
        if result.returncode:
            return False, "IGC load failed:\n" + result.stderr
        # ocloc loads its own frontend dynamically. Help exercises its loader without
        # compiling kernels or inspecting/validating any artifact identity.
        result = subprocess.run([str(candidates[0]), "--help"], env=env,
                                capture_output=True, text=True, timeout=20)
        if result.returncode:
            return False, "ocloc startup failed:\n" + result.stdout + result.stderr
        return True, "Compiler helper, packer, ocloc and IGC dependencies usable"
    except (OSError, subprocess.TimeoutExpired) as error:
        return False, str(error)


def snapshot(state, label, path):
    record = {"path": str(path), "kind": "absent", "label": label}
    if not exists(path):
        return record
    info = path.lstat()
    if info.st_uid != os.getuid():
        raise RuntimeError(f"Only current-user files may be changed: {path}")
    record.update(mode=stat.S_IMODE(info.st_mode), atime_ns=info.st_atime_ns, mtime_ns=info.st_mtime_ns)
    if path.is_symlink():
        record.update(kind="symlink", link=os.readlink(path))
    elif path.is_file():
        record.update(kind="file", backup=str(state / "original" / label))
        shutil.copy2(path, record["backup"])
    else:
        raise RuntimeError(f"Expected a regular file or symlink: {path}")
    return record


def missing_parents(path):
    missing = []
    parent = path.parent
    while not exists(parent):
        missing.append(str(parent))
        parent = parent.parent
    return list(reversed(missing))


def copy_evidence(source, destination):
    if source.is_symlink():
        destination.symlink_to(os.readlink(source))
    elif source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    elif source.is_file():
        shutil.copy2(source, destination)
    else:
        raise RuntimeError(f"Unsupported evidence object: {source}")


def archive(state, manifest, reason):
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    destination = state / "evidence" / (stamp + "-" + reason)
    destination.mkdir(parents=True)
    prefix = Path(manifest["prefix"])
    for name in DIAGNOSTICS:
        source = prefix / "drive_c" / name
        if exists(source):
            copy_evidence(source, destination / name)
    for name in ("cache", "launch.log"):
        source = state / name
        if exists(source):
            copy_evidence(source, destination / name)
    for record in manifest["files"]:
        source = Path(record["path"])
        if exists(source):
            copy_evidence(source, destination / ("installed-" + record["label"]))
    return str(destination)


def restore_file(record):
    target = Path(record["path"])
    no_symlink_parents(target)
    if target.is_dir() and not target.is_symlink():
        raise RuntimeError(f"A directory replaced an installed file: {target}; preserve and move it before retrying")
    if record["kind"] == "absent":
        if exists(target):
            target.unlink()
    elif record["kind"] == "file":
        atomic_copy(Path(record["backup"]), target)
        os.chmod(target, record["mode"])
        os.utime(target, ns=(record["atime_ns"], record["mtime_ns"]))
    elif record["kind"] == "symlink":
        if exists(target):
            target.unlink()
        target.symlink_to(record["link"])
        os.utime(target, ns=(record["atime_ns"], record["mtime_ns"]), follow_symlinks=False)


def restore_locked(state, manifest, reason="restore"):
    if manifest["status"] == "restored":
        return
    owner = Path(manifest["prefix"]) / OWNER_REL
    progress = manifest.setdefault("restore_progress", [])
    acquired = manifest.get("ownership_acquired", manifest["status"] == "active")
    if exists(owner):
        if owner.is_symlink() or owner.lstat().st_uid != os.getuid() or owner.read_text().strip() != str(state):
            raise RuntimeError("Prefix ownership marker belongs to another installation")
        acquired = True
    elif acquired:
        files_done = all(item["label"] in progress for item in manifest["files"] if item["label"] != "owner")
        if not (manifest.get("owner_cleanup_pending") and files_done):
            raise RuntimeError("Prefix ownership marker is missing; refuse restoring snapshots into a recreated or unowned prefix")
    try:
        # If archiving fails, stop before changing any installed file.
        manifest["last_archive"] = archive(state, manifest, reason)
        manifest["status"] = "restoring"
        save(state, manifest)
        # No prefix/config mutation happens before marker acquisition during install.
        # A failure before acquisition therefore must not replay snapshots at all.
        if acquired:
            for record in manifest["files"]:
                if record["label"] == "owner" or record["label"] in progress:
                    continue
                restore_file(record)
                progress.append(record["label"])
                save(state, manifest)
        # Preexisting user caches/log directories are never removed. New diagnostics are
        # archived too, and kept locally: they can be useful for a later resumed experiment.
        for directory in reversed(manifest["created_dirs"] if acquired else []):
            path = Path(directory)
            if exists(path):
                no_symlink_parents(path / "placeholder")
                try:
                    path.rmdir()
                except OSError:
                    # Preserve files written by another component; never recursively clean.
                    if not path.is_dir() or path.is_symlink():
                        raise
        if acquired and "owner" not in progress:
            # Persist this boundary BEFORE removing the marker. Retry may accept its
            # absence only after all data files were restored, and will skip those files.
            manifest["owner_cleanup_pending"] = True
            save(state, manifest)
            restore_file(next(item for item in manifest["files"] if item["label"] == "owner"))
            progress.append("owner")
            save(state, manifest)
        manifest["status"] = "restored"
        manifest.pop("error", None)
        save(state, manifest)
    except Exception as error:
        manifest.update(status="restore_failed", error=str(error))
        save(state, manifest)
        raise


def fsr_active(manifest):
    if not manifest.get("fsr_guard_ini"):
        return False
    import configparser
    config = configparser.ConfigParser(interpolation=None, strict=False)
    if not config.read(manifest["fsr_guard_ini"], encoding="utf-8-sig"):
        raise RuntimeError('FSR configuration is missing; restore or repair it before launch')
    return (config.get("Upscalers", "Dx12Upscaler", fallback="").lower() == "ffx"
            and config.get("FSR", "UpscalerIndex", fallback="") == "9")


def layer_gpu(package, drm=Path("/sys/class/drm")):
    ids = set()
    for line in (package / "layer/gpu-ids.txt").read_text().splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in ("xe2", "xe3"):
            ids.add(parts[1].lower())
    found = False
    for vendor in drm.glob("card*/device/vendor"):
        try:
            if vendor.read_text().strip().lower() == "0x8086":
                found = True
                if (vendor.parent / "device").read_text().strip().lower() not in ids:
                    return False
        except OSError:
            return False
    return found


def select_driver(package, manifest):
    if not modern_layout(package):
        return package / "lib/libvulkan_intel.so", False
    use_layer = not fsr_active(manifest) and layer_gpu(package)
    return package / ("lib/mesa-stock-26.3.1/libvulkan_intel.so" if use_layer else "lib/mesa-26.3.1/libvulkan_intel.so"), use_layer


def write_icd(path, driver):
    atomic_text(path, json.dumps({"file_format_version": "1.0.1", "ICD": {
        "api_version": "1.4.348", "library_arch": "64", "library_path": str(driver)}}) + "\n")


def install(args):
    ordinary_user()
    prefix, package, state = map(absolute, (args.prefix, args.package, args.state))
    config = absolute(args.config) if args.config else state / "game.conf"
    if not args.game_exe or "/" in args.game_exe or "\\" in args.game_exe:
        raise RuntimeError("--game-exe must be the exact executable basename, e.g. Cyberpunk2077.exe")
    if not windows_prefix_path(prefix, Path("drive_c/windows/system32")).is_dir():
        raise RuntimeError("Explicit initialized prefix required; launch the game once before installing")
    if exists(state) or not state.parent.is_dir():
        raise RuntimeError("--state must be a new directory with an existing parent; retain old backups")
    if config == Path.home() / ".config/xess-xmx.conf":
        raise RuntimeError("Shared upstream default config is not supported; use the per-game default")
    if state in config.parents and config != state / "game.conf":
        raise RuntimeError("Inside backup state, only the default game.conf path is supported")
    if state == prefix or prefix in state.parents or state == package or package in state.parents:
        raise RuntimeError("Keep backup state outside the prefix and release package")
    if config == prefix or prefix in config.parents or config == package or package in config.parents:
        raise RuntimeError("Keep the per-game config outside the prefix and release package")
    no_symlink_parents(prefix / "placeholder")
    no_symlink_parents(state / "placeholder")
    no_symlink_parents(config)
    modern = modern_layout(package)
    required = ("igdext64.dll", "lib/libvulkan_intel.so", "tools/cm-compile.sh", "tools/cmk_pack.py")
    for name in required:
        if not (package / name).is_file():
            raise RuntimeError(f"Missing staged release file: {package / name}")
    if not os.access(package / "tools/cm-compile.sh", os.X_OK):
        raise RuntimeError("Staged compiler helper must be executable")
    if not any(os.access(path, os.X_OK) for path in (package / "igc/neo/bin").glob("ocloc*")):
        raise RuntimeError("Compiler bundle is missing; stage upstream IGC 2.10.10 and ocloc first")
    if not any((package / "igc/igc/local/lib").glob("*.so*")):
        raise RuntimeError("IGC libraries are missing from the staged compiler bundle")
    dll, owner = prefix_dll_path(prefix), prefix / OWNER_REL
    no_symlink_parents(dll)
    owned_outputs(prefix, state, config, dll)
    with prefix_lock(prefix):
        game_idle(prefix, args.game_exe)
        if exists(owner):
            raise RuntimeError("Prefix already has a wrapper installation; restore that state first")
        state.mkdir(mode=0o700)
        (state / "original").mkdir()
        (state / "cache").mkdir()
        (state / "kernels").mkdir()
        manifest = dict(schema=1, state=str(state), prefix=str(prefix), package=str(package),
                        config=str(config), game_exe=args.game_exe, status="backed_up",
                        created_dirs=[], files=[], ownership_acquired=False, restore_progress=[],
                        upstream="20261005 (caller-staged)", modern_runtime=modern)
        try:
            # Snapshot every mutable file before the first mutation. A prior .stock is untouched.
            manifest["files"] = [snapshot(state, "igdext64.dll", dll), snapshot(state, "game.conf", config),
                                 snapshot(state, "owner", owner)]
            manifest["created_dirs"] = list(dict.fromkeys(missing_parents(dll) + missing_parents(config)))
            manifest["initial_archive"] = archive(state, manifest, "before-install")
            save(state, manifest)
        except Exception:
            # No prefix/config mutations have occurred; retain partial backups for inspection.
            raise
        try:
            manifest["status"] = "installing"
            save(state, manifest)
            atomic_text(owner, str(state) + "\n")
            manifest["ownership_acquired"] = True
            save(state, manifest)
            for directory in manifest["created_dirs"]:
                Path(directory).mkdir()
            atomic_copy(package / "igdext64.dll", dll)
            icd = state / "intel_icd.json"
            driver, _ = select_driver(package, manifest)
            write_icd(icd, driver)
            drivers = [str(icd)] + [path for path in stock_icds()
                                    if Path(path).name not in ("intel_icd.json", "intel_icd.x86_64.json")]
            env = dict(XMX_CONF=str(config), VK_DRIVER_FILES=":".join(drivers),
                       VKD3D_DISABLE_EXTENSIONS="VK_EXT_descriptor_buffer", ANV_CM_KERNEL_DIR=str(state / "kernels"),
                       ANV_CM_HELPER=str(package / "tools/cm-compile.sh"), XMX_IGC_DIR=str(package / "igc"),
                       XDG_CACHE_HOME=str(state / "cache"), CM_LOG=str(state / "cache/xess-xmx/compile.log"),
                       force_vk_vendor="0")
            (state / "cache/xess-xmx").mkdir()
            if modern:
                env.pop("VKD3D_DISABLE_EXTENSIONS")
            text = "# Per-game XMX environment; edit diagnostic switches here while the game is closed.\n"
            text += "".join(f"export {key}={shlex.quote(value)}\n" for key, value in env.items())
            if modern:
                text += 'export LD_LIBRARY_PATH=' + shlex.quote(str(package / "lib/deps")) + '${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\n'
                text += 'export VKD3D_DISABLE_EXTENSIONS="${VKD3D_DISABLE_EXTENSIONS:+$VKD3D_DISABLE_EXTENSIONS,}VK_EXT_descriptor_buffer,VK_EXT_descriptor_heap,VK_KHR_present_wait2"\n'
            text += dxgi_identity_config()
            text += dll_environment_config(prefix, dll)
            atomic_text(config, text)
            atomic_copy(Path(__file__).resolve(), state / "runtime.py")
            launch = "#!/bin/sh\nexec python3 " + shlex.quote(str(state / "runtime.py"))
            launch += " launch --state " + shlex.quote(str(state)) + ' -- "$@"\n'
            atomic_text(state / "launch.sh", launch, mode=0o700)
            manifest["status"] = "active"
            save(state, manifest)
        except Exception as error:
            try:
                restore_locked(state, manifest, "install-failure")
            except Exception as rollback_error:
                raise RuntimeError(f"Install failed: {error}; rollback failed: {rollback_error}. Retained state: {state}") from error
            raise RuntimeError(f"Install failed and original files restored: {error}. Backup: {state}") from error
    print("Installed for this prefix only. Set this game's Steam launch options exactly:")
    print(shlex.quote(str(state / "launch.sh")) + " %command%")
    print("Restore with: python3 " + shlex.quote(str(state / "runtime.py")) + " restore --state " + shlex.quote(str(state)))


def restore(args):
    ordinary_user()
    state = absolute(args.state)
    manifest = load(state)
    prefix = Path(manifest["prefix"])
    no_symlink_parents(prefix / "placeholder")
    owned_outputs(prefix, state, Path(manifest["config"]), recorded_dll_path(manifest))
    with prefix_lock(prefix):
        game_idle(prefix, manifest["game_exe"])
        restore_locked(state, manifest)
    print(f"Original DLL/config restored; backup and evidence retained in {state}. Remove this game's launch option.")


XMX_LAYER_NAME = "VK_LAYER_XESS_xmx"


def disable_xmx_layer(env):
    for key, separator in (("VK_LOADER_LAYERS_ENABLE", ","), ("VK_INSTANCE_LAYERS", ":")):
        if key in env:
            env[key] = separator.join(part for part in env[key].split(separator) if part != XMX_LAYER_NAME)
    disabled = env.get("VK_LOADER_LAYERS_DISABLE", "").split(",")
    if XMX_LAYER_NAME not in disabled:
        disabled.append(XMX_LAYER_NAME)
    env["VK_LOADER_LAYERS_DISABLE"] = ",".join(part for part in disabled if part)
    env["XMX_LAYER_DISABLE"] = "1"


# Applied after sourcing the user-editable game config, so session and config
# layer selections cannot reactivate the XMX layer on the patched route.
DISABLE_XMX_LAYER_SHELL = r'''
_xmx_filter_layer() {
    local key="$1" sep="$2" part result=""; local -a parts
    IFS="$sep" read -r -a parts <<< "${!key-}"
    for part in "${parts[@]}"; do
        if [ "$part" != VK_LAYER_XESS_xmx ] && [ -n "$part" ]; then
            result="${result:+$result$sep}$part"
        fi
    done
    printf -v "$key" '%s' "$result"; export "$key"
}
_xmx_filter_layer VK_LOADER_LAYERS_ENABLE ,
_xmx_filter_layer VK_INSTANCE_LAYERS :
case ",${VK_LOADER_LAYERS_DISABLE-}," in
    *,VK_LAYER_XESS_xmx,*) ;;
    *) VK_LOADER_LAYERS_DISABLE="${VK_LOADER_LAYERS_DISABLE:+$VK_LOADER_LAYERS_DISABLE,}VK_LAYER_XESS_xmx" ;;
esac
export VK_LOADER_LAYERS_DISABLE XMX_LAYER_DISABLE=1
'''


def launch(args):
    state = absolute(args.state)
    manifest = load(state)
    if manifest["status"] != "active":
        raise RuntimeError("Installation is not active; remove the Steam launch option or finish recovery")
    command = list(args.command)
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        raise RuntimeError("Launch command is required after --")
    prefix = Path(manifest["prefix"])
    with prefix_lock(prefix, inherit=True):
        game_idle(prefix, manifest["game_exe"])
        package = Path(manifest["package"])
        modern = use_layer = False
        modern_candidate = manifest.get("modern_runtime", False) or any((package / p).exists() for p in ("lib/active", "layer", "lib/mesa-26.3.1"))
        try:
            modern = modern_layout(package, manifest.get("modern_runtime", False))
            driver, use_layer = select_driver(package, manifest)
            if modern:
                write_icd(state / "intel_icd.json", driver)
            ok, report = compiler_check(package)
            if ok:
                usable, driver_report = driver_check(package, state / "intel_icd.json")
                ok, report = usable, report + "\n" + driver_report
        except (OSError, RuntimeError, ValueError) as error:
            ok, report = False, str(error)
        with (state / "launch.log").open("a") as log:
            log.write(datetime.datetime.now(datetime.timezone.utc).isoformat() + "\n")
            log.write(("XMX toolchain and patched driver usable\n" if ok else "stock driver + generic XeSS fallback\n") + report + "\n")
        if ok:
            # Shell config is intentionally editable by this user. Arguments remain positional.
            route = ''
            if modern:
                if use_layer:
                    route = 'unset VK_LOADER_LAYERS_DISABLE XMX_LAYER_DISABLE; export VK_ADD_LAYER_PATH=' + shlex.quote(str(package / "layer")) + '${VK_ADD_LAYER_PATH:+:$VK_ADD_LAYER_PATH}; export VK_LOADER_LAYERS_ENABLE=VK_LAYER_XESS_xmx; export XMX_LAYER_HELPER=' + shlex.quote(str(package / "tools/cm-compile.sh")) + '; '
                else:
                    route = DISABLE_XMX_LAYER_SHELL
                route += 'if [ "${XESS_ASYNC:-0}" = 1 ] && [ -z "${IGDEXT_XEFG_ASYNC+x}" ]; then export IGDEXT_XEFG_ASYNC=1; fi; '
            os.execvpe("bash", ["bash", "-c", 'set -e; . "$1"; shift; ' + route + 'exec "$@"',
                               "xess-game", manifest["config"], *command], os.environ.copy())
        if fsr_active(manifest):
            raise RuntimeError('FSR XMX requires the patched driver and compiler; restore XeSS or repair the XMX runtime before launch. See ' + str(state / 'launch.log'))
        print("XMX toolchain/driver unavailable; using stock Vulkan + generic XeSS. See " + str(state / "launch.log"), file=sys.stderr)
        env = os.environ.copy()
        if modern_candidate:
            disable_xmx_layer(env)
        drivers = stock_icds()
        if drivers:
            env["VK_DRIVER_FILES"] = ":".join(drivers)
        else:
            env.pop("VK_DRIVER_FILES", None)
        env["IGDEXT_FORCE_FALLBACK"] = "1"
        for key in ("ANV_CM_KERNEL_DIR", "ANV_CM_HELPER", "ANV_CM_SPV_DIR", "XMX_IGC_DIR"):
            env.pop(key, None)
        os.execvpe(command[0], command, env)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    add = commands.add_parser("install")
    for name in ("prefix", "package", "state", "game-exe"):
        add.add_argument("--" + name, required=True)
    add.add_argument("--config", help="Unique per-game shell config; default STATE/game.conf")
    for action in ("restore", "status", "launch"):
        sub = commands.add_parser(action)
        sub.add_argument("--state", required=True)
        if action == "launch":
            sub.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        if args.action == "status":
            print(json.dumps(load(absolute(args.state)), indent=2))
        else:
            {"install": install, "restore": restore, "launch": launch}[args.action](args)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"xess: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
