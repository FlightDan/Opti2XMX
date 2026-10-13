# Decky Store submission / Decky 商店提交

Checked against official documentation on 2026-10-13. This repository is an independent preview; it has not been accepted into the Store. / 本文于 2026-10-13 核对官方要求；本仓库为独立预览版，尚未获商店收录。

## Current blockers / 当前待解决项

1. **AI authorship policy.** The current [new-plugin PR template](https://github.com/SteamDeckHomebrew/decky-plugin-database/blob/main/.github/PULL_REQUEST_TEMPLATE/plugin_addition.md) requires a declaration that generative AI did not write most submitted code. The [submission wiki](https://wiki.deckbrew.xyz/en/plugin-dev/submitting-plugins) has broader restrictive wording. Opti2XMX was developed with AI assistance. A maintainer must assess authorship honestly and seek clarification if necessary; do not check this declaration without evidence. / 当前模板要求声明大部分代码不是生成式 AI 编写，Wiki 的表述更严格。本项目有 AI 辅助开发记录，需如实核实；不能为提交而虚假勾选。
2. **Runtime provisioning and provenance.** XMX still requires separately prepared Intel/ANV/compiler components. Document a reproducible setup, corresponding source/build changes and redistribution permissions before store review. / XMX 尚需独立配置运行库；需补齐可复现安装、对应源码及分发许可。
3. **Hardware and channel testing.** Record SteamOS Stable and Beta tests and obtain an independent tester's report. The Python frontend/backend alone is not the whole dependency story: the XMX route loads native libraries with dynamic dependencies, so plan for Preview testing and confirm classification with maintainers. AMD Steam Deck cannot test Intel XMX execution; Intel tests and Steam Deck non-XMX behavior need separate evidence. / 需 Stable、Beta 实测及第三方报告；XMX 外部动态库还涉及 Preview 测试要求，Intel 功能和 AMD Steam Deck 上的行为应分别验证。
4. **Feature differentiation.** Explain how per-game XMX management, independent injection and recovery differ from existing frame-generation plugins. / 说明与已有帧生成插件的差异。

## Submission route / 提交流程

After resolving the policy and testing blockers / 解决上述问题后：

1. Publish reviewed source and a fixed version/commit in a public repository. / 公开源码并固定版本和提交。
2. Fork [decky-plugin-database](https://github.com/SteamDeckHomebrew/decky-plugin-database). Add this repository as `plugins/Opti2XMX`, pointing to the reviewed commit. / Fork 官方数据库，将本仓库作为 submodule 添加到该路径。
3. Push the submodule change and open a PR using **Plugin addition**, completing the backend checklist accurately. Do not check third-party testing until an actual report exists. / 使用新插件模板提交 PR，如实填写检查表。
4. Address build and review feedback; test the actual store-built artifact. Only the Decky maintainers can approve and merge it into the Store. / 处理构建与审核反馈，验证商店构建产物，等待维护者批准。

Example commands after forking / Fork 后的示例命令：

```sh
git clone https://github.com/FlightDan/decky-plugin-database.git
cd decky-plugin-database
git switch -c add/opti2xmx
git submodule add https://github.com/FlightDan/Opti2XMX.git plugins/Opti2XMX
git -C plugins/Opti2XMX checkout <reviewed-commit>
git add .gitmodules plugins/Opti2XMX
git commit -m "Add Opti2XMX 0.2.1"
git push -u origin add/opti2xmx
```

Community testing of two other plugin PRs is optional in the current template but may affect priority. No test reports or store PR have been submitted on your behalf. / 当前模板将测试另外两个插件列为可选社区贡献，可能影响审核优先级；本次没有代发测试报告或商店 PR。

References / 参考：[database README](https://github.com/SteamDeckHomebrew/decky-plugin-database#submit-your-plugin), [submission rules](https://wiki.deckbrew.xyz/en/plugin-dev/submitting-plugins), [review and testing](https://wiki.deckbrew.xyz/en/plugin-dev/review-and-testing), [new-plugin template](https://github.com/SteamDeckHomebrew/decky-plugin-database/blob/main/.github/PULL_REQUEST_TEMPLATE/plugin_addition.md).
