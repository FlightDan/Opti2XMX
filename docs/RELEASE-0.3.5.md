# Opti2XMX 0.3.5

- The standalone Decky plugin can download and configure the new XMX runtime
  from [xess-xmx-linux 20261119](https://github.com/HHHHanasak1/xess-xmx-linux/releases/tag/20261119)
  with Mesa ANV 26.3.1. It preserves each game's existing launcher and the
  original runtime until the user explicitly restores and re-enables XMX.
- The listed Intel GPU IDs use unpatched Mesa 26.3.1 with the bundled Vulkan
  layer. Other Intel IDs and the existing FSR Lite XMX route use patched
  26.3.1. OptiScaler and Intel XeSS SDK pins are retained.
- `XESS_ASYNC=1` is an opt-in for supported XeSS frame generation. The plugin
  uses its per-game launcher and preserves the existing recovery flow.
- Source and packaging verification cover release inputs, archive members,
  dependency selection, update controls and recovery fixtures. Both Mesa
  26.3.1 libraries load with SteamOS 3.10 Wayland and XCB libraries in an
  isolated Linux fixture, and the Vulkan loader discovers the bundled layer.
  Physical
  hardware, game performance and Boiler model-package integration are pending.
  The release uses the exact upstream 20261119 binaries. The later upstream
  [Jay GPU-hang fix](https://github.com/HHHHanasak1/xess-xmx-linux/pull/83)
  is outside this pin.

## 中文摘要

独立 Decky 插件可主动下载配置 xess-xmx-linux 20261119 与 Mesa ANV 26.3.1 运行库。已配置的
游戏保留现有启动器和运行库。要切换版本，退出游戏，在插件中恢复原 XMX 设置后重新开启。
受支持的 XeSS 插帧可选用 `XESS_ASYNC=1`，默认关闭。原有 OptiScaler 和 XeSS SDK 锁保持。
实机、游戏性能与 Boiler 新机型包的联测待验收。

See [runtime setup and limits](RUNTIME.md) and [locked source inputs](../runtime-build-sources.json).
