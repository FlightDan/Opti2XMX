# Opti2XMX 0.3.6

- Fix FSR 4.1.2 Lite XMX image corruption with the current 20261119 XMX runtime. Its patched Mesa 26.3.1 driver handles sampler descriptor tables using the runtime compiler. The legacy 20261005 runtime retains its per-game compiler correction.
- Add the managed --launcher-skip option for Cyberpunk 2077 and a Repair action for existing XMX installations. Repair tells you to launch and exit the game once if its Proton prefix still needs initialization.
- Improve Opti reinstall and prefix checks so an uninitialized Proton prefix can be repaired before the XMX transaction changes game files.

If you set up FSR with an earlier plugin version, exit the game, turn XMX off and back on in Opti2XMX, then select FSR again. This refreshes the per-game launcher and compiler cache. Start the game from Steam.

The Decky ZIP uses the same separately downloaded XMX runtime. Import the original, pinned FSR model ZIP from a local file in the plugin.

## Verification

- On an ONEXPLAYER 3 with SteamOS and Intel Arc B390, Cyberpunk 2077 rendered normally after switching to the runtime compiler and rebuilding the per-game cache. The in-game overlay confirmed FSR 4.1.2 output. The README screenshots show gameplay.
- Linux regression checks cover the modern and legacy compiler paths, the FSR launch guard, runtime validation, and restore.
- This standalone Decky release verifies the reported graphics corruption on the tested configuration. The screenshots are gameplay captures.
