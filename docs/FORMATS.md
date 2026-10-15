# Wireloom file formats

Both formats are plain JSON, versioned, and validated on load with readable error messages.

## Conventions

- **Units are holes on a 0.1" (2.54 mm) grid.** Everything is whole numbers.
- **Board coordinates** are front-view: `x` to the right, `y` down, origin at the **front-left** corner.
  Hole labels shown to people are 1-based: board hole `(11, 21)` is **c12 r22**.
- **Module (local) coordinates** are the module seen **parts side up, unrotated**, `x` right, `y` down
  from its top-left. Put the antenna end, if it has one, wherever it really is and say which edge.
- A part on the **back** of the board is seen from underneath, so Wireloom mirrors its pinout
  left↔right automatically. `mirrorPins` flips it once more, for a module whose real pinout is the
  reverse of its library definition.
- **Same-named pins on one module are internally common** (an ESP32's four `GND` pins). A net that
  names `esp:GND` uses whichever of them is nearest the rest of the net.

## Module — `*.module.json`

```json
{
  "format": "wireloom-module",
  "version": 1,
  "id": "nrf24l01",
  "name": "nRF24L01+ (PA+LNA)",
  "category": "Radio",
  "size": { "w": 6, "h": 11 },
  "pins": [
    {"name": "VCC", "x": 1, "y": 9},
    {"name": "GND", "x": 1, "y": 10}
  ],
  "antenna": { "edge": "top", "band": "2.4GHz" },
  "metal": false,
  "offboard": false,
  "color": "#0f2418",
  "note": "ant ▲",
  "verify": "Pin 1 (GND) is the square pad …",
  "verified": false,
  "source": "Where the pinout came from"
}
```

| Field | Required | Meaning |
|---|---|---|
| `format`, `version` | yes | `"wireloom-module"`, `1` |
| `id` | yes | lowercase letters, digits, `. _ -`; unique in a library; the file is `<id>.module.json` |
| `name` | yes | shown in the library |
| `category` | no | groups the library list (`MCU`, `Radio`, `Display`, `Power`, …) |
| `size.w`, `size.h` | yes | footprint in holes (1–200) |
| `pins[]` | yes | `{ name, x, y }` — each a local hole inside the footprint; two pins can't share a hole |
| `antenna` | no | `{ edge: "top"\|"right"\|"bottom"\|"left", band }`. Bands containing `2.4` get spacing and keep-out checks |
| `metal` | no | true for parts that detune antennas nearby (a TFT's frame, a LiPo pouch) |
| `offboard` | no | true for parts not mounted on the board (a battery in the case): drawn dashed, wired as leads |
| `color` | no | `#rrggbb` fill on the board |
| `note` | no | short text drawn on the part |
| `verify` | no | what to check before trusting the pinout — shown in the inspector and build sheet |
| `verified` | no | true once the pinout has been checked against a real board |
| `source` | no | where the pinout came from |

## Project — `*.wireloom`

```json
{
  "format": "wireloom-project",
  "version": 1,
  "name": "GPS Trail Logger",
  "notes": "free text",
  "board": { "cols": 30, "rows": 54 },
  "netClasses": { "uart": { "label": "serial", "color": "#56d4dd" } },
  "rules": { "antennaMinSep": 8, "antennaKeep": 4,
             "router": { "turn": 2, "soft": 3, "cross": 6, "hop": 10, "antennaZone": 8 } },
  "modules": { "gy-neo6mv2-gps": { "…": "a full module definition" } },
  "parts": [
    { "id": "gps", "module": "gy-neo6mv2-gps", "label": "GPS", "short": "GPS",
      "x": 1, "y": 1, "rot": 90, "side": "front", "mirrorPins": false }
  ],
  "nets": [
    { "name": "GPS_RX", "class": "uart", "pins": ["esp:IO9", "gps:TX"] }
  ]
}
```

- **`modules`** — a project embeds a copy of every module it uses, keyed by id, so it opens identically
  on any machine and isn't affected by later library edits.
- **`parts[]`** — `id` is unique within the project and is what nets refer to. `x`, `y` are the
  top-left hole of the part *as placed*; `rot` is 0/90/180/270 clockwise; `side` is `front` or `back`.
- **`nets[]`** — each lists `"partId:pinName"` references. A pin may belong to only one net. Nets are
  joined with a minimum spanning tree, then each joint is routed.
- **`netClasses`** — colour and label per class; any class a net names that isn't listed falls back to
  the built-in defaults.
- **`rules`** — `antennaMinSep` (holes between 2.4 GHz antenna points), `antennaKeep` (keep-out radius,
  holes) and the router's step costs.

Newer files than the app understands are refused with *"made by a newer Wireloom — update the app"*.
