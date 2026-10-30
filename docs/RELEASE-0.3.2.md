# Opti2XMX 0.3.2

- Restore the four-position frame-generation multiplier slider (native, 2×, 3×, 4×) and expand advanced settings by default for each selected game. A manual collapse is retained during the plugin session.
- Identify the current super-resolution component as XeSS 2.0.2 and the existing experimental frame-generation output as XeSS 3. This labels the existing SDK 3 path; it does not add a second super-resolution runtime or a native-game frame-generation override.
- Remove the persistent auto-save descriptions beneath upscaling and multiplier controls. After a successful actual settings change, a brief notice asks the user to restart the game. Failed saves keep their error; unchanged values do not show a restart notice.
- Harden stable OptiScaler archive and extracted-payload verification, and remove implicit development-path dependency discovery. This release retains existing game-file ownership, recovery and local-only source rules.

## Validation and limits

The final source and standalone archive are tested separately from the installer integration. XeSS frame generation and multipliers remain experimental: a saved request or an FPS overlay alone does not prove the actual interpolation count. Prior testing used Cyberpunk 2077 on Arc B390 with ray tracing off; the final 0.3.2 UI/game combination has not yet received physical-device acceptance. FSR 4.1.2 Lite XMX still requires the user's locally supplied, verified model archive.

## 中文摘要

- 恢复原生／2×／3×／4×倍率滑块；选定游戏后高级设置默认展开。
- 超分组件显示 XeSS 2.0.2，既有实验性帧生成输出显示 XeSS 3；不新增另一套超分运行库。
- 移除两处常驻保存说明；设置实际变更并保存成功后提示重启游戏，失败继续显示原因。
- 加强 OptiScaler 归档和解压载荷校验；帧生成仍属实验功能，最终版本的游戏实机验收尚未完成。
