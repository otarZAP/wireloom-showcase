# Changelog

## 0.1.0 — 2026-10-15

First version.

- Module-level perfboard editor: place parts from a library, drag, rotate, flip to the other face,
  mirror a pinout; undo/redo for everything.
- Real pin positions for every module; back-side parts mirror automatically.
- Connect / Disconnect tools for wiring pins; nets panel to rename, recolour and delete nets.
- Grid router: every connection routed hole-to-hole (turns, crossings, module bodies, antenna zones and
  pin hops all costed); straight-line preview while dragging.
- Views: Both (x-ray), Front, Back · solder (mirrored), with rulers and hover pin info.
- Checks: 2.4 GHz antenna spacing, metal near antennas, two pins in one hole, parts that don't fit,
  unrouted connections, unverified pinouts.
- Outputs: tick-off wire list with hole numbers and lengths, cut list, CSV, SVG, printable build sheet.
- Formats: `.wireloom` projects (self-contained) and `.module.json` modules, validated on load.
- Library of 11 common breakout modules (all marked unverified until checked on hardware);
  import your own from a template.
- Example project: a handheld GPS trail logger.
- Windows desktop app: native open/save, recent files, `.wireloom` file association, unsaved-changes
  guard, automatic updates from GitHub Releases.
