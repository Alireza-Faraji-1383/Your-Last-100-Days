# Y100D Early Loading

A tiny, instance-level early-window provider for this exact pack:

- Minecraft 1.21.1
- NeoForge 21.1.233
- FML earlydisplay 4.0.42
- Java 21

It wraps NeoForge's stock `DisplayWindow`, inserts one six-frame background at
the start of its existing render-element list, and delegates every lifecycle
method. The stock fox, live startup logs, version, memory bar, and progress bars
are not replaced or removed.

Runtime cost is one 427x1440 PNG upload (about 2.35 MiB decoded), one background
quad, one UI-composite quad, and a transparent clear of the fixed 854x480 UI
buffer at the loader's 20 Hz refresh rate. The texture is released when
NeoForge begins its Mojang handoff. Frame selection is UV-only: no per-frame
texture upload, file access, allocation, or image decode.

The early window remains freely resizable. The pixel-art background uses
centered cover scaling against the real framebuffer, while NeoForge's fixed
`854x480` UI is alpha-composited at centered contain scale. Fullscreen,
maximized, 16:10, 4:3, and ultrawide windows therefore have no red exterior
bars, while the fox, live logs, memory bar, version, and progress bars keep
their stock proportions and positions.

The exact-version runtime framebuffer hook is deliberately fail-open and the
Prism component is pinned to NeoForge 21.1.233. If the responsive compositor is
unavailable, the background and all stock UI continue through the contained
NeoForge-compatible path with dark exterior margins.

## Build and install

Close Prism Launcher, then run `install.ps1`. It builds with Prism's bundled
Microsoft Java 21, installs the JAR as an instance library (not a mod), appends
the local component to `mmc-pack.json`, and selects `y100danimated` in
`config/fml.toml`.

Run `uninstall.ps1` with Prism closed to remove the component and restore
`fmlearlywindow`.
