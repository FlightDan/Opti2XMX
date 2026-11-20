"""Build the pinned per-game XMX runtime from public release archives."""

import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import stat
import tarfile
import zipfile


UPSTREAM_FILES = (
    'igdext64.dll',
    'LICENSE',
    'THIRD_PARTY.md',
    'docs/dev/building.md',
    'layer/VkLayer_xess_xmx.json',
    'layer/gpu-ids.txt',
    'layer/libVkLayer_xess_xmx.so',
    'layer/third_party/blake3/LICENSE_A2',
    'layer/third_party/blake3/LICENSE_CC0',
    'lib/active',
    'lib/libvulkan_intel.so',
    'lib/mesa-26.1.2/libvulkan_intel.so',
    'lib/mesa-26.3.1/libvulkan_intel.so',
    'lib/mesa-stock-26.3.1/libvulkan_intel.so',
    'lib/bundled/LICENSE.SPIRV-Tools',
    'lib/bundled/LICENSE.libdisplay-info',
    'lib/bundled/SOURCES.txt',
    'patches/0001-anv-cm-kernel-injection.patch',
    'patches/0002-anv-cm-debug-tools.patch',
    'patches/0003-anv-cm-xe2-large-grf.patch',
    'patches/0005-anv-cm-sampler-descriptor-table.patch',
    'patches/mesa-26.3/0001-anv-cm-kernel-injection.patch',
    'patches/mesa-26.3/0002-anv-cm-debug-tools.patch',
    'patches/mesa-26.3/0003-anv-cm-xe2-large-grf.patch',
    'patches/mesa-26.3/0005-anv-cm-sampler-descriptor-table.patch',
    'patches/mesa-26.3/0006-anv-cmat-vars-before-jay.patch',
    'shim/LICENSE.md',
    'shim/dxvk-igdext_third-party-programs.md',
    'tools/cm-compile.sh',
    'tools/cmk_pack.py',
)
UPSTREAM_DEPENDENCIES = ('libSPIRV-Tools.so', 'libdisplay-info.so.3')
LEGACY_FILES = {
    'runtime/igc/igc/local/lib/' + name for name in (
        'libiga64.so.2', 'libiga64.so.2.10.10+18926', 'libigc.so.2',
        'libigc.so.2.10.10+18926', 'libigdfcl.so.2', 'libigdfcl.so.2.10.10+18926',
        'libopencl-clang2.so.15', 'igc2/NOTICES.txt',
    )
} | {
    'runtime/igc/neo/bin/ocloc-25.18.1',
    'runtime/igc/neo/lib/x86_64-linux-gnu/libocloc.so',
    'runtime/igc/neo/share/doc/intel-ocloc/changelog.Debian.gz',
    'runtime/igc/neo/share/doc/intel-ocloc/copyright',
    'runtime/licenses/IGC-LICENSE.md',
    'runtime/licenses/IGC-NOTICES.txt',
    'runtime/licenses/IGC-libclc-LICENSE.txt',
    'runtime/licenses/compute-runtime-LICENSE.md',
    'runtime/licenses/compute-runtime-package-copyright.txt',
    'runtime/licenses/Mesa-license.rst',
    'runtime/licenses/Mesa-source-copyright-and-SPDX.txt',
    'runtime/licenses/mesa/licenses/Apache-2.0',
    'runtime/licenses/mesa/licenses/BSL-1.0',
    'runtime/licenses/mesa/licenses/GPL-1.0-or-later',
    'runtime/licenses/mesa/licenses/GPL-2.0-only',
    'runtime/licenses/mesa/licenses/MIT',
    'runtime/licenses/mesa/licenses/SGI-B-2.0',
    'runtime/licenses/mesa/licenses/exceptions/Linux-Syscall-Note',
    'sdk/XeSS-LICENSE.txt',
    'sdk/libxess.dll',
}


def checked_input(path, descriptor):
    source = path.open('rb')
    try:
        size = path.stat().st_size
        if ('size_bytes' in descriptor and size != descriptor['size_bytes']
                or hashlib.file_digest(source, 'sha256').hexdigest() != descriptor['sha256']):
            raise ValueError('Public input does not match its pin: ' + path.name)
        source.seek(0)
        return source
    except Exception:
        source.close()
        raise


class DigestReader:
    def __init__(self, source):
        self.source = source
        self.digest = hashlib.sha256()

    def read(self, size):
        data = self.source.read(size)
        self.digest.update(data)
        return data


def add_member(output, inventory, name, source, size, executable=False):
    if name in inventory or size <= 0:
        raise ValueError('Duplicate or empty runtime member: ' + name)
    info = tarfile.TarInfo(name)
    info.size = size
    info.mode = 0o755 if executable else 0o644
    reader = DigestReader(source)
    output.addfile(info, reader)
    inventory[name] = {'size_bytes': size, 'sha256': reader.digest.hexdigest(), 'mode': info.mode}


def add_upstream(output, inventory, source, version):
    prefix = f'xess-xmx-linux-{version}/'
    staged = {name: name for name in UPSTREAM_FILES}
    staged.update({'lib/bundled/' + name: 'lib/deps/' + name for name in UPSTREAM_DEPENDENCIES})
    with zipfile.ZipFile(source) as archive:
        names = archive.namelist()
        for member, target in sorted(staged.items()):
            archive_name = prefix + member
            if names.count(archive_name) != 1:
                raise ValueError('Missing or duplicate upstream runtime member: ' + archive_name)
            info = archive.getinfo(archive_name)
            if info.is_dir() or stat.S_IFMT(info.external_attr >> 16) not in (0, stat.S_IFREG):
                raise ValueError('Unexpected upstream runtime member type: ' + archive_name)
            with archive.open(info) as content:
                add_member(output, inventory, 'runtime/' + target, content, info.file_size,
                           executable=target == 'tools/cm-compile.sh')


def add_legacy_inputs(output, inventory, source):
    with tarfile.open(fileobj=source, mode='r|gz') as archive:
        for member in archive:
            if member.name not in LEGACY_FILES:
                continue
            if not member.isreg():
                raise ValueError('Unexpected compiler or SDK member type: ' + member.name)
            with archive.extractfile(member) as content:
                add_member(output, inventory, member.name, content, member.size, member.mode & 0o111)
    if missing := LEGACY_FILES - inventory.keys():
        raise ValueError('Legacy compiler or SDK members missing: ' + ', '.join(sorted(missing)))


def add_mesa_licenses(output, inventory, source, version):
    prefix = f'mesa-{version}/'
    destination = f'runtime/licenses/mesa-{version}/'
    with tarfile.open(fileobj=source, mode='r|xz') as archive:
        for member in archive:
            if not member.name.startswith(prefix):
                continue
            relative = PurePosixPath(member.name.removeprefix(prefix))
            if not relative.parts or not (relative.parts[0] == 'licenses' or relative.as_posix() == 'docs/license.rst'):
                continue
            if member.isdir():
                continue
            if relative.is_absolute() or '..' in relative.parts or not member.isreg():
                raise ValueError('Unexpected Mesa source license member: ' + member.name)
            with archive.extractfile(member) as content:
                add_member(output, inventory, destination + relative.as_posix(), content, member.size)
    for name in ('docs/license.rst', 'licenses/MIT'):
        if destination + name not in inventory:
            raise ValueError('Missing Mesa license: ' + name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--compiler-and-sdk', type=Path, required=True)
    parser.add_argument('--mesa-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--inventory', type=Path, required=True)
    args = parser.parse_args()
    sources = json.loads(Path(__file__).with_name('runtime-build-sources.json').read_text())
    members = {}
    with (checked_input(args.upstream, sources['upstream_release']) as upstream,
          checked_input(args.compiler_and_sdk, sources['compiler_and_sdk_release']) as legacy,
          checked_input(args.mesa_source, sources['mesa_source']) as mesa,
          args.output.open('xb') as raw_output,
          gzip.GzipFile(filename='', mode='wb', compresslevel=6, fileobj=raw_output, mtime=0) as gzip_output,
          tarfile.open(mode='w|', fileobj=gzip_output) as output):
        add_upstream(output, members, upstream, sources['version'])
        add_legacy_inputs(output, members, legacy)
        add_mesa_licenses(output, members, mesa, sources['mesa_source']['version'])
        provenance = json.dumps(sources, indent=2).encode('utf-8') + b'\n'
        add_member(output, members, 'runtime/PROVENANCE.json', io.BytesIO(provenance), len(provenance))

    with args.output.open('rb') as archive:
        digest = hashlib.file_digest(archive, 'sha256').hexdigest()
    result = {'filename': args.output.name, 'size_bytes': args.output.stat().st_size,
              'sha256': digest, 'members': dict(sorted(members.items()))}
    with args.inventory.open('x', encoding='utf-8') as report:
        json.dump(result, report, indent=2)
        report.write('\n')
    print(f"{result['filename']}: {result['size_bytes']} bytes, SHA-256 {digest}")


if __name__ == '__main__':
    main()
