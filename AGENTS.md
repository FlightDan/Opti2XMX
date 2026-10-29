# Opti2XMX development and release rules

## Project and authority

- This is the independent Opti2XMX project. Work from this checkout; never discover inputs in an old workspace, a sibling repository, a research folder, or a developer's home by an implicit path.
- The public repository is https://github.com/FlightDan/Opti2XMX. Preserve its public history. Private historical checkouts and credentials are not publication inputs.
- Preserve existing changes. The user's instructions and authorization take precedence. Do not request approval again for an already authorized action.
- Keep local device access, signing material, historical private diagnostics and development-only inputs in ignored `.local/` storage. Never put credentials in this file, source, tests, logs, Git history or distributions.

## Agent collaboration

- The primary agent owns architecture, integration and final verification. Delegate independent investigation, noisy-context exploration and non-trivial independent review when the benefit exceeds coordination overhead; do small edits and coupled edit/test loops directly.
- Use `gpt-6.1-sol` with `high` reasoning for complex architecture, persistence, concurrency, security and public-interface work. Otherwise use `gpt-6-luna` with `max` reasoning. Specify both when delegating.
- For non-trivial changes: implement, obtain independent review, fix findings, then verify final bytes. Evaluate findings rather than accepting them blindly.
- Before adding complexity for a speculative or very unlikely race/security edge, explain the concrete failure, likelihood and cost and obtain approval. Concrete existing defects may be fixed within authorized scope.

## Product boundaries

- `main.py` is the Decky RPC boundary; frontend state lives in `src/`; Python managers own game/runtime transactions. Preserve RPC and persisted journal compatibility unless the user explicitly approves a migration.
- Never execute upstream setup scripts, arbitrary shell RPC or untrusted archive contents. Validate bundled release pins before extraction, including local cache hits. Local-only source selection must never fall back to the network.
- Opti file changes run as the ordinary prefix owner. Require an idle game/prefix, validate exact file ownership and paths, reject symlinks, retain originals and journals, and refuse to overwrite foreign changes.
- Explicit `per_game.py` restoration owns its recorded prefix DLL and editable diagnostic configuration. It intentionally archives their current contents before restoring the original snapshots, including user-edited configuration; retain that evidence and legacy restore compatibility. This exception does not authorize replacing unmanaged game files or bypassing game-file conflict checks.
- Interrupted install, settings and restore actions must expose recovery. Reads, opening the plugin and polling must not install, download, change settings or retry an operation implicitly.
- Preserve manual choices across native Steam menus and QAM remounts. Share mutation ownership and reject stale async replies. A running-game refusal retains the persisted selection.
- User-provided FSR models stay outside source and packages. Keep only public descriptors and licensed compatibility components. Do not import unpublished G3E/dynamic-power research or core algorithms.

## Build and test

- `package.json` is the plugin version source. Follow the pinned lockfile and CI tool versions; do not reuse a node_modules junction into another checkout.
- Frontend: install frozen dependencies, run `pnpm typecheck`, `pnpm build`, then `node test_frontend.mjs`. The scenario harness consumes the built distribution.
- Backend: run `python3 -B -m unittest discover -v` on Linux as an ordinary user. Windows does not exercise `fcntl`, Unix permissions or symlink behavior; record platform skips explicitly. Use isolated temporary games/prefixes, not the user's games.
- Test each defect with a failing-before/passing-after reproduction. Run relevant game/EXE gating, settings, native menus, install/restore and cache scenarios for behavioral changes.
- Build the standalone archive with `python3 package_plugin.py`; validate exact member names, unique members, sizes, SHA-256, compatibility licenses and source identity. Archive member lists are explicit; never package a directory walk.

## Versions, integration and publication

- Do not replace a published version or attachment. Use a new development revision/build for changed runtime payloads; keep frozen release baselines immutable.
- Boiler consumes pinned plugin artifacts in model packages, not an implicit source-tree link. For an affected integration, regenerate its payload and manifest through its normal preparation flow, verify both Windows and retained-maintenance copies, and record independent component versions.
- Publish only when authorized. Use a clean public-history checkout, inspect the explicit source scope, run final tests, upload the verified asset, then verify the public refs, download hash and CI. Never push private historical Git objects.
- Use standard Git/GitHub credentials or explicitly supplied local tools. No publisher may depend on a deleted development workspace.
- README changes are limited to necessary version strings and existing versioned links. Detailed changes, findings, acceptance limits and release results belong in release/audit records.

## Cleanup and completion

- Rebuildable caches may be cleaned after inventory. Retain rollback journals, user files, model imports, the latest accepted candidate and exact source/hash evidence. Unreadable entries are preserved and reported, not classified as deletable.
- Historical reports remain immutable. Record relocations separately; only active pointers and supported entrypoints change paths.
- Distinguish source tests, package checks and physical-device acceptance. Report each delivery item as complete, not applicable with reason, or blocked with remaining steps. Never call an unperformed game/device installation accepted.
