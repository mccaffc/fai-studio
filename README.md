# FAI Banner Generator

Automated banner generation for the Foundation for American Innovation. Creates
on-brand Bauhaus/Swiss vector banner compositions from a modular library of
geometric tiles, using a generate-and-score pipeline faithful to
`FAI-Composition-Logic-Supplement.md`.

> **Rebuilt June 2026.** See `BANNER-GENERATOR-REBUILD-NOTES.md` for the full
> change log, command catalogue, and known limits. The old interactive
> `http.server` "studio" has been retired (files in `scripts/_retired/` and
> `studio/_retired/`) in favour of the CLI + static contact sheets below.

## What it does

Generates 6×3-grid banners (1920×960) from cleaned geometric tiles. It:

- **Generates** many candidate compositions per banner (data only, no render),
- **Scores** each on the supplement's eight aesthetic axes (anchor-triangle,
  rhythm, directional-flow, weight-balance, negative-space, color-temperature,
  shape-family-grouping, hero-tile),
- **Keeps** the top-scoring candidates and renders them to SVG (+ optional PNG).

## Quick start

```sh
export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib
PY="$HOME/.cache/fai-deck-venv/bin/python"

# one best-of-240 banner, full 7-fill palette
$PY scripts/fai_banner.py --color-mode full --seed 7 --png \
    --out output/banners-rebuilt/demo
```

### Color modes

```sh
$PY scripts/fai_banner.py --color-mode full      ...   # all 7 ratified FAI fills
$PY scripts/fai_banner.py --color-mode duotone   ...   # Cod Gray + Orange + White
$PY scripts/fai_banner.py --color-mode vertical --vertical-hex "#4997D0" ...
                                                       # Cod Gray + <vertical> + White
```

### Contact sheets

```sh
$PY scripts/fai_contact.py banners --color-mode full --count 12 --png \
    --out output/contact-banners        # annotated with per-banner scores
$PY scripts/fai_contact.py tiles --png --out output/contact-tiles   # tile library
```

### Calibration & maintenance

```sh
$PY scripts/fai_calibrate.py --compare 12     # references vs generated, per axis
$PY scripts/fai_sanitize_tiles.py             # tile-library hygiene (idempotent)
$PY scripts/build_dominant_direction.py       # (re)enrich the v2 manifest
```

## Project structure

```
scripts/
  fai_banner.py              # generator: CLI + generate-and-score core
  fai_tile_render.py         # robust per-tile foreground extraction + recolour
  fai_contact.py             # contact/montage sheets (tiles | banners)
  fai_calibrate.py           # reference-banner calibration loop
  fai_sanitize_tiles.py      # one-time tile-library hygiene pass
  build_dominant_direction.py# enrich v2 manifest (direction, raster_fill, quarantine)
  svg_raster.py              # cairosvg wrapper + Pillow-free PNG decoder
  build_manifest.py          # upstream manifest builder (qlmanage + Pillow)
  clean_svgs.py / simplify_tiles.py / fai_colors.py   # upstream tile pipeline
  _retired/                  # superseded scripts (rollback only)

output/
  shapes-clean/<Family>/NN.svg  # the tile library (140 tiles, 17 families)
  banners-clean/                # 57 hand-made reference banners (calibration)
  banners-rebuilt/              # generated samples (this rebuild)

tiles-manifest-v2.json       # the single canonical tile manifest
_legacy/                     # retired v1 manifest (rollback only)
```

## Brand colors (the only 7 permitted fills)

| Color | Hex | | Color | Hex |
|---|---|---|---|---|
| International Orange | `#FF4F00` | | Cod Gray | `#121212` |
| Chrome Yellow | `#FFA300` | | White | `#FFFFFF` |
| Celestial Blue | `#4997D0` | | Smoke White | `#F3F3F3` |
| Timberwolf | `#D9D9D6` | | | |

No gradients, shadows, opacity, or strokes — solid flat fills only. The FAI
double-chevron logomark is never generated or redrawn by this tool.

## Dependencies

`cairosvg` (PNG render; needs the Homebrew cairo dylibs via
`DYLD_FALLBACK_LIBRARY_PATH`) plus the Python stdlib. The upstream
`build_manifest.py` additionally uses `lxml` + `Pillow` + macOS `qlmanage`.
```
