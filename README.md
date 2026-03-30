# FAI Banner Studio

Automated banner generation system for the Foundation for American Innovation. Creates on-brand vector banner compositions from a modular library of geometric tiles.

## What It Does

Banner Studio generates 6x3 grid banner compositions (1920x960px) from simplified geometric vector tiles. The system:

- **Generates** SVG banners by selecting tiles, placing them on a grid, applying rotation patterns, and assigning colors
- **Scores** candidates based on continuity (edge matching), symmetry, rhythm, and visual balance
- **Previews** real-time renders before saving
- **Exports** final banners as SVG + JSON metadata

The generator is driven by **topic descriptions** (e.g., "AI demand surge, energy buildout") which auto-select tile families and color moods.

## Quick Start

```bash
pip install -r requirements.txt
python scripts/banner_studio.py
```

Opens at `http://127.0.0.1:8765`.

**Options:**

```bash
python scripts/banner_studio.py --port 8787 --no-browser
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11+ (`http.server`) |
| Generator | lxml, custom scoring algorithms |
| Frontend | Vanilla JS, CSS3 |
| Fonts | IBM Plex Sans / Mono / Serif / Condensed |
| Deploy | Render.com |

## Project Structure

```
scripts/
  banner_studio.py          # HTTP server
  generate_banner.py        # Core generator (tile selection, placement, scoring)
  build_manifest.py         # Build tile metadata manifest
  clean_svgs.py             # SVG normalization
  simplify_tiles.py         # Reduce tile complexity
  generate_contact_sheet.py # Visual tile reference sheets
  fai_colors.py             # Brand color definitions

studio/
  index.html                # UI
  app.js                    # Frontend logic
  styles.css                # Styling

output/
  shapes-simplified/        # Processed tile SVGs
  banners-generated/        # Output banners (SVG + JSON)
  banner-requests/          # Saved specs
  contact-sheets/           # Tile reference sheets

tiles-manifest-v2.json      # Master tile metadata
render.yaml                 # Render.com deploy config
```

## Key Features

### Topic-Driven Generation
Type a description like "AI demand surge, energy buildout" and the engine maps keywords to tile families and color preferences via pre-configured topic profiles.

### Color Modes
- **Auto** - Full 7-color palette, engine picks best composition
- **Duotone Presets** - Restrict to exactly 2 colors (e.g., Cod Gray on International Orange)
- **Manual** - Pick families and color bias yourself

### Composition Control
- **Templates**: pinwheel, spiral, mirror, symmetric, flow, river, checkerboard, auto
- **Energy levels**: Low (sparse), Medium (balanced), High (dense)
- **Family selection**: Primary + accent tile families
- **Tile locking**: Include/exclude specific tiles
- **Seed**: Reproducible random generation
- **Tuning**: Continuity, symmetry, and rhythm strength (0-1)

## Brand Colors

| Color | Hex |
|-------|-----|
| International Orange | `#FF4F00` |
| Celestial Blue | `#4997D0` |
| Chrome Yellow | `#FFA300` |
| Cod Gray | `#121212` |
| White | `#FFFFFF` |
| Smoke White | `#F3F3F3` |
| Timberwolf | `#D9D9D6` |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/options` | GET | Available templates, families, colors, defaults |
| `/api/preview` | POST | Generate banner without saving |
| `/api/generate` | POST | Generate + save SVG + JSON |
| `/api/save-spec` | POST | Save form state as reusable spec |
| `/api/topic-preview` | POST | Apply topic inference + preview |

## Deployment

Push to Render.com — config is in `render.yaml`:

```yaml
startCommand: python3 scripts/banner_studio.py --host 0.0.0.0 --port $PORT --no-browser
```

## Dependencies

- **lxml** - XML/SVG parsing and generation
- Python stdlib (json, argparse, threading, http.server, pathlib, dataclasses)
