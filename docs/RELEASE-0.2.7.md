# Opti2XMX 0.2.7

Fix OptiScaler and XMX runtime downloads failing with `CERTIFICATE_VERIFY_FAILED`
inside Decky's bundled Python on SteamOS. HTTPS now explicitly loads an available
standard Linux system CA bundle. Certificate and hostname verification remain
required; invalid CA bundles or server certificates still fail without retrying
an unverified connection.

The reported Cyberpunk 2077 repair failed before any download bytes arrived. Its
game folder retained OptiScaler.ini and libxess.dll but had no dxgi.dll. The same
official OptiScaler 0.9.4 archive downloaded and extracted successfully with the
device's system Python, isolating the failure to Decky's trust-store discovery.

Validation: 46 focused Windows tests (2 platform skips); all 174 isolated Linux
tests passed on the handheld; independent TLS review found no blocking issue.
Actual Decky verification: the repaired plugin downloaded all 55,016,448 bytes
from the official OptiScaler 0.9.4 release with an empty cache, repaired Cyberpunk
2077 using its backup transaction, and confirmed Steam launch options by readback.
Status is active, injection enabled, incomplete=false, and no pending operation.
Original files and plugin binaries remain backed up. No game-rendering acceptance
is claimed. Installer/maintenance delivery is tracked separately.

OptiScaler remains 0.9.4; the existing published XMX runtime is unchanged.
