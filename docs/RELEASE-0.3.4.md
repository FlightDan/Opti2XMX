# Opti2XMX 0.3.4

## Changes

- Recover a managed XMX setup when Steam's current launch options are empty: enabling reuses its recorded launcher, and restoring accepts the empty current value before restoring the saved original launch options.
- Keep the existing setup journal and refuse unrecognized non-empty launch options. File restoration still preflights all managed files and preserves game or shim changes on conflict.
- When FSR settings are saved with an active XMX setup and an empty Steam launch field, repair the recorded launcher through the normal confirmation path before continuing the existing FSR flow.
- When Opti detects a missing launch field during active XMX, show the XMX enable/restore actions as the recovery path; the Opti operation does not write launch options.

## Validation

- `pnpm typecheck`, `pnpm build`, and `node test_frontend.mjs` passed.
- Linux Alpine 3.23.6, ordinary user: `python3 -B -m unittest discover -v` passed all 261 tests in 221.592 seconds.
- `python3 -B package_plugin.py` produced `opti2xmx-0.3.4.zip`. The archive has 37 unique members matching the explicit packaging list, all member bytes match the final staged inputs, required licenses are present, and extracted `main.py` imports successfully.
- ZIP size: 1,487,883 bytes. SHA-256: `5556d312594625fd6ab60e6d9c5778d5ec72b6846af2522bef94b9bc00545f74`. Per-member sizes and SHA-256 values are recorded in [ZIP-INVENTORY-0.3.4.json](ZIP-INVENTORY-0.3.4.json).
- The 37 packaged source inputs in the Linux staging copy matched this checkout; the host copy of the ZIP matched the guest-verified SHA-256. `git diff --check` passed.
- No physical-device/game acceptance, installer integration, GitHub upload, or publication is included in this candidate. No commit was created.

## 中文摘要

Steam 当前启动项为空时，可复用现有 XMX 记录重新写入启动项；恢复时接受空当前值并还原已保存的原始启动项。未知的非空启动项仍被冲突检查拒绝。文件恢复继续先检查所有受管文件，遇到游戏文件或 shim 改动时保留现场。FSR 设置通过同一启动项恢复流程继续操作；Opti 缺少启动项时只提供使用 XMX 开启／恢复操作的指引。
