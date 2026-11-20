# XMX runtime / XMX 运行环境

Opti2XMX 0.3.5 configures an optional per-game runtime built from the upstream
[xess-xmx-linux 20261119 release](https://github.com/HHHHanasak1/xess-xmx-linux/releases/tag/20261119).
The separate runtime download is 213,295,873 bytes (203.4 MiB). Downloading and configuring it is an
explicit action and does not change system Mesa, the Steam session, Proton
installations, or an already-configured game's launcher.

Opti2XMX 0.3.5 使用上述上游版本组装可选的单游戏运行库。独立运行库为 213,295,873 字节（203.4 MiB）。
下载和配置由用户主动触发，不修改系统 Mesa、Steam 会话、Proton 安装或已经配置好的游戏启动器。

## Install or upgrade / 安装或升级

Use **Download and configure XMX runtime** in the plugin. Opti verifies the
pinned archive from `runtime-source.json`, extracts regular files, checks the
host driver and compiler, and changes `runtime.json` only after those checks
pass. Old runtime directories remain available to their recorded launchers. To
move a previously configured game to the new runtime, exit the game, restore
its existing XMX setup in the plugin, and enable XMX again.

在插件中选择 **下载并配置 XMX 运行环境**。插件根据内置描述校验附件、提取普通文件并验证主机驱动
和编译器，通过后才更新 `runtime.json`。已配置的游戏继续使用其启动记录中的旧运行库。要对某个
旧游戏使用新版本，退出游戏，在插件中恢复该游戏原有 XMX 设置，再重新开启 XMX。

The new runtime contains Mesa ANV 26.3.1 in patched and unpatched variants. The
per-game launcher uses the bundled unpatched driver plus
`VK_LAYER_XESS_xmx` for Intel PCI IDs listed by the layer. The existing
FSR 4.1.2 Lite XMX path and other Intel IDs use patched Mesa 26.3.1. Patched Mesa
26.1.2 is retained in the composite as part of the upstream driver set. Already
installed 20261005 runtimes and their per-game rollback records remain usable.

新版同时包含 Mesa ANV 26.3.1 的原版和补丁版。Vulkan 层名单内的 Intel PCI ID 使用包内原版驱动
和 `VK_LAYER_XESS_xmx`。已有的 FSR 4.1.2 Lite XMX 路径及其余 Intel ID 使用补丁版 26.3.1。
复合包另保留上游驱动组中的补丁版 26.1.2。现有 20261005 运行库和单游戏恢复记录仍可使用。

To try asynchronous presentation on a game's supported XeSS FG path, close
the game and add `export XESS_ASYNC=1` to its managed `game.conf`, next to
its per-game `launch.sh`. It is off by default. The standalone plugin does not install upstream's global
Proton hook, FSR translation, OFLOW, D3D11 bridge, or Vulkan game DLL override.

如需在支持的 XeSS 帧生成路径上试用异步呈现，请先退出游戏，再在该游戏受管 `launch.sh` 同目录的
`game.conf` 中加入 `export XESS_ASYNC=1`。默认关闭。独立插件不安装上游全局 Proton hook，也不部署上游的 FSR 转译、
OFLOW、D3D11 桥接或 Vulkan 游戏 DLL 覆盖。

## Host requirements / 主机要求

Use x86_64 Linux or SteamOS, a compatible Intel GPU, and `bash`, `python3`,
`ldd`, and `vulkaninfo`. The upstream prebuilt ANV drivers require glibc 2.38
and Wayland client 1.24 or newer. They also require the newer XCB Present and
DRI3 APIs supplied by SteamOS 3.10. See the
[upstream driver requirements](https://github.com/HHHHanasak1/xess-xmx-linux/blob/20261119/docs/drivers.md#library-requirements).
Driver loading and Vulkan enumeration do not establish game performance.

需要 x86_64 Linux 或 SteamOS、兼容 Intel GPU 及上述命令。上游预构建 ANV 驱动要求 glibc 2.38
和 Wayland 客户端 1.24 或更新版本，以及 SteamOS 3.10 提供的新版 XCB Present 与 DRI3 接口。
驱动加载和 Vulkan 枚举只能核对运行条件。

## Prepared and retained runtimes / 预配置与留存运行库

Prepared runtimes point to absolute paths owned by the Steam user. The new
composite and old archives keep the existing `runtime/` and `sdk/` layout:

```json
{
  "package": "/home/YOUR_USER/.local/share/opti2xmx/runtime",
  "sr": "/home/YOUR_USER/.local/share/opti2xmx/sdk/libxess.dll"
}
```

Use `~/.local/share/opti2xmx/runtime.json` for explicit paths. The SR library
must be version 2.0.2.68 or later. The compiler helper and ocloc must be
executable. Run Decky and the plugin as the ordinary Steam user. Boiler's
maintenance runtime may use independent retained paths and its own signed
descriptor. Its outer shard is not the raw standalone download.

预配置运行库可在 `~/.local/share/opti2xmx/runtime.json` 填写由 Steam 用户拥有的绝对路径。
超分库至少为 2.0.2.68，编译辅助脚本和 ocloc 必须可执行。使用普通 Steam 用户运行。
Boiler 维护发行由自身签名清单管理，独立下载使用原始附件。

## Release preparation / 发布准备

`runtime-build-sources.json` pins the upstream non-debug ZIP, the original
public compiler/SDK bundle, and Mesa 26.3.1 source. `build_runtime.py` accepts
these three archives explicitly and produces the composite and its member
inventory. It reuses binary bytes from the verified archives and retains
upstream license notices and patched-driver source references. The compiler is
IGC 2.10.10 with ocloc 25.18.33578.6. The Intel XeSS SDK remains 3.0.2.

构建工具只接收上述三份明确指定并经校验的公开输入，生成复合包及逐成员清单，保留来源和许可。
新正式附件通过 `runtime-source.json` 固定版本、大小和 SHA-256。旧的
[v0.2.3 独立运行库附件](https://github.com/FlightDan/Opti2XMX/releases/tag/v0.2.3)
继续用于原有部署的恢复与复现。
