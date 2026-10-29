# Opti2XMX 0.3.1

Opti2XMX now follows the complete game setup sequence rather than showing controls before their prerequisites are ready.

- Opening the plugin refreshes game/component state and prefers the running supported Steam game. Manual game choices survive Steam's native menus. The redundant Refresh button is removed.
- Games with multiple executable candidates show the required executable choice first. Installation, XMX and Opti controls appear after a valid choice. A missing or incomplete Opti installation does not show the overlay control. Record-driven recovery remains accessible when a failed installation needs rollback or launch confirmation.
- Fresh installation, repair and managed installation share the same Opti 10 preview / 0.9.4 / 0.7.9 target selector. Current and target versions are identified separately. Choosing a target does not install it.
- When a matching archive is already cached, **Install from local package** is the first/default source. The cache is shared across games and is compatible with archives supplied by a Boiler device package. An explicit local source never silently falls back to the network. When absent, the first installation can download and retain the archive; later installations reuse it.
- An explicit installation can temporarily restore an active XMX setup, install and confirm Opti, then re-enable XMX through the freshly detected Opti route. The operation survives Quick Access unmount/remount. Errors retain the actual state and recovery actions; reopening does not retry an operation automatically. Migration continues to preserve adopted files/settings.
- Upscaling, frame-generation, multiplier and GPU selections save automatically. A running game is refused with an exit-game message, and the saved selection stays visible. Native / 2× / 3× / 4× multiplier choices save only the confirmed value. Reset, undo and interrupted-settings recovery remain available.
- Version installation resets upscaling to XeSS and frame generation to native control. Select FSR again afterward to prepare/enable its existing XMX path. FSR 4.1.2 Lite XMX still requires the user's exact locally imported model archive; model DLLs and private caches are not distributed.

## Validation

- TypeScript checking, production build and all 23 frontend scenario groups passed. These include fresh and managed installs, executable gating, native menus, active-XMX install ordering, fresh route selection, duplicate-action protection, missing local cache refusal, interrupted installation rollback and launch confirmation.
- All 230 Python fixture tests passed in an isolated Linux directory. They exercise read-only cache discovery, cached source reuse across managers, local-only cache misses without network work, settings preflight and version reset behavior.
- On the test device, all three existing original Opti archives were used with network access prohibited inside the test process. A second pass also prohibited extraction and successfully reused all prepared payloads. No game installation or game settings were changed by this cache check.
- The existing Boiler local OXP3 package's three archive targets, byte sizes and hashes were checked against the plugin's cache contract. The pinned runtime and ordinary public CPU payload remain separate.
- Independent review found and verified fixes for stale snapshot reads, concurrent actions, recovery hidden behind executable selection and an explicit-local choice silently becoming a network source.
- The final new UI/full installation sequence has automated coverage; final physical game installation and native UI acceptance are not claimed. Earlier development candidates do not establish acceptance of this exact release.

This release does not add support for unsupported games/GPUs, prove new performance gains, or distribute the user's FSR model. Existing Opti 10/FSR compatibility limits remain documented in [FSR XMX](FSR_XMX.md).

## 中文摘要

- 先确认游戏程序，再显示安装与设置；未装好 Opti 时隐藏覆盖层入口。
- 新装、修复和已安装入口使用同一套三个版本选项；有本地包时默认“从本地安装”，各游戏共用缓存。
- XMX 开启时安装会自动处理临时关闭与恢复；失败保留恢复入口，不在重开时偷偷重试。
- 设置选完自动保存；游戏运行时提示先退出，并保留已保存选项。
- 23 组前端回归及 230 项 Linux 测试通过；三份实机缓存包的禁止联网与二次直接复用验证通过。最终实机新界面和完整游戏安装验收未完成，详见上述验证边界。
