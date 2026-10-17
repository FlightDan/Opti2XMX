# Opti2XMX 0.2.6

- Show the reason XMX or installation is unavailable. Put executable selection before the switches and retain the selected executable after managed installation.
- Offer a backed-up repair install for leftover OptiScaler configuration without its dxgi proxy, instead of sending it to migration which cannot handle a missing proxy. Preserve existing configuration, XeSS files and legacy .b backups for rollback/uninstall.
- A failed XMX journal no longer disables fresh installation. A removed Opti journal neither authorizes replacing a foreign proxy nor carries a disabled injection flag into a new installation.
- Reject injector conflicts before download and recheck under the prefix lock before writing. Complete existing installations retain the migration path.

Validation: TypeScript typecheck, production bundle, bilingual frontend interactions and 169 Linux fixture tests passed. Independent review completed and the reinstall-after-disabled-uninstall finding fixed. Fixtures cover interrupted copy rollback, exact restoration, foreign proxy conflicts after download and multiple executables.

Device diagnosis on 0.2.5: Control Ultimate Edition had three candidate executables and no initialized Proton prefix in either Steam library. Original Death Stranding had an INI and XeSS libraries but no dxgi proxy or managed Opti record. The frontend failed to display the backend reasons. Control still requires one normal Proton launch and exit before installation; a missing prefix is not bypassed. Game performance and XMX operation in these two games are not certified by the fixture tests.

The XMX runtime and OptiScaler versions are unchanged. Project installer and maintenance delivery are tracked separately from this standalone plugin.
