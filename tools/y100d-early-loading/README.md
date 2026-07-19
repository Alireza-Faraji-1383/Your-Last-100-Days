# Y100D Early Loading

A tiny NeoForge early-window service for Your Last 100 Days:

- Minecraft 1.21.1
- NeoForge with FML earlydisplay 4.0.42
- Java 21

The ready-to-ship file is:

`mods/y100d-early-loading-1.0.0+mc1.21.1-neoforge.jar`

NeoForge discovers its `ImmediateWindowProvider` directly from `mods/` before
the early window is created. No Prism component, installer, mixin framework,
FancyMenu, Drippy, Konkrete, or Melody is required. The six-frame pixel-art
atlas and the five Windows icon sizes are embedded in the JAR, so players do
not need a separate image file.

The provider wraps NeoForge's stock `DisplayWindow`. The fox, live startup
logs, version, memory bar, and all progress bars remain present. Runtime cost
is one 427x1440 texture upload (about 2.35 MiB decoded), one background quad,
one UI-composite quad, and UV-only animation at NeoForge's 20 Hz refresh rate.
There is no per-frame file access, image decode, texture upload, or allocation.
The small icon PNGs are decoded only twice during startup: once for NeoForge's
early window and once after Minecraft replaces the window icon during handoff.

The background uses centered cover scaling against the real framebuffer. The
stock 854x480 UI is alpha-composited at centered contain scale, keeping its
proportions across fullscreen, 16:10, 4:3, and ultrawide windows.

## CurseForge release

For a public CurseForge modpack, publish the prebuilt JAR once as the pack's
small companion Mod project, tagged for NeoForge 1.21.1, then add that project
to the profile through **Add More Content**. CurseForge will place it in
`mods/` and reference it from the generated manifest.

Use the repository's square `icon.png` as the project avatar for both the
modpack and its companion Mod project.

The exported overrides must include `config/fml.toml`; it selects
`earlyWindowProvider = "y100danimated"`. The custom menu also needs
`kubejs/config/defaultoptions.txt` and
`resourcepacks/Y100D_Vanilla_Menu_1.21.1.zip`. KubeJS creates a clean
`options.txt` from that template on the first launch, without shipping the
author's personal keybind, graphics, audio, or fullscreen settings.

Do not export this `tools/` directory. CurseForge requires public packs to be
exported by its app, and the app should generate `manifest.json` itself.

## Developer build

`build.ps1` is only for changing the provider later. It uses Java 21 and the
local NeoForge/FML 4.0.42 compile dependencies, then replaces the prebuilt JAR
in `mods/`. Players never need to run it.
