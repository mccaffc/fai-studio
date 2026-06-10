# FAI Banner Generator — Rebuild Notes (June 2026)

Proposal for the creative director to ratify. Nothing in the canonical brand
docs was touched. This rebuilds the banner generator inside this subproject so
the output is reliably, defensibly well-composed and faithful to
`FAI-Composition-Logic-Supplement.md`.

---

## TL;DR — what to run

All commands launch the FAI deck venv with the cairo dylibs (needed for PNG):

```sh
export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib
PY="$HOME/.cache/fai-deck-venv/bin/python"
```

Generate one best-of-240 banner (default color mode = full 7-fill palette):

```sh
$PY scripts/fai_banner.py --color-mode full --seed 7 --png \
    --out output/banners-rebuilt/demo
```

The three color modes:

```sh
# (a) full     — all 7 ratified FAI fills
$PY scripts/fai_banner.py --color-mode full --png --out output/banners-rebuilt/a

# (b) duotone  — Cod Gray + International Orange + White
$PY scripts/fai_banner.py --color-mode duotone --png --out output/banners-rebuilt/b

# (c) vertical — Cod Gray + <a chosen vertical hex> + White  (parametrized)
$PY scripts/fai_banner.py --color-mode vertical --vertical-hex "#4997D0" \
    --png --out output/banners-rebuilt/c

# (d) extended — all 7 ratified fills + proposal accents
$PY scripts/fai_banner.py --color-mode extended --allow-unratified-hex \
    --extra-hex "#7150D6" --extra-hex "#D63A8C" \
    --extra-hex "#2EA84F" --extra-hex "#3A4A6B" \
    --png --out output/banners-rebuilt/d
```

Top-N to a folder, forced template, reproducible seed:

```sh
$PY scripts/fai_banner.py --color-mode full --keep 6 --template central_burst \
    --seed 1 --png --out output/banners-rebuilt/burst-set
$PY scripts/fai_banner.py --list-templates        # show the 7 weight-map templates
```

Contact / montage sheets (one tool, two subcommands):

```sh
# annotated banner contact sheet (supplement deliverable: total + 8 sub-scores)
$PY scripts/fai_contact.py banners --color-mode full --count 12 --png \
    --out output/contact-banners
# sheet an existing folder of banner SVGs (thumbnails only, no re-scoring)
$PY scripts/fai_contact.py banners --input output/banners-rebuilt --png \
    --out output/banners-rebuilt/_contact-sheet

# tile-library contact sheet (id + dominant_direction labels)
$PY scripts/fai_contact.py tiles --png --out output/contact-tiles
$PY scripts/fai_contact.py tiles --families Circle,Wave,Curve --recolor "#FF4F00" \
    --png --out output/contact-curves
$PY scripts/fai_contact.py tiles --per-family 1 --png --out output/contact-families
```

Reference-banner calibration loop:

```sh
$PY scripts/fai_calibrate.py --compare 12     # ref means/min/max vs generated
```

Library maintenance (idempotent; run after re-importing tiles):

```sh
$PY scripts/fai_sanitize_tiles.py             # strip sci-notation + inline CSS fills
$PY scripts/build_dominant_direction.py       # (re)compute dominant_direction etc.
```

---

## What changed

### 1. `dominant_direction` added to the manifest (goal 1)
`scripts/build_dominant_direction.py` computes a `dominant_direction` for every
tile (`left/right/up/down/center/outward/neutral`) from a fresh raster pass:
foreground centroid offset chooses the axis, `edge_coverage` only *reinforces*
the same axis, and centred tiles are split into `center` vs `outward` by mean
foreground radius. It also writes `raster_fill` (true coverage, solid = 1.0) and
`fg_centroid`, and records a `direction_distribution` + `quarantine` block. All
pre-existing manifest fields are preserved. Current distribution:
`outward 41, left 35, up 21, neutral 18, right 10, center 9, down 6`.

### 2. Full supplement scoring + calibration (goal 2)
`scripts/fai_banner.py` is a clean ~480-line generate-and-score pipeline that
implements **all eight** axes from the supplement, with the supplement's
suggested starting weights:

| axis | weight | what it rewards |
|---|---|---|
| anchor-triangle | 0.10 | 2–3 peak-intensity tiles spread across grid thirds/rows |
| rhythm (shape repetition) | 0.20 | 3–5 unique shapes, ≤2 singletons |
| directional-flow | 0.15 | adjacent `dominant_direction` sympathy (H/V lookup tables) |
| weight-balance | 0.15 | even `visual_weight` across rows and left/right halves |
| negative-space | 0.10 | 4–6 light tiles, clustered not scattered |
| color-temperature | 0.10 | warm/cool *zones*, neutrals bridging (no salt-and-pepper) |
| shape-family-grouping | 0.10 | ~55% same-family adjacencies (loose phrases) |
| hero-tile | 0.10 | one clear focal tile at a power position, contrasting neighbours |

Generation uses the supplement's heuristics: 7 composition **weight-map
templates** (`diagonal_sweep, central_burst, corner_anchor, horizontal_banding,
scattered_focal, asymmetric_left, rising_stagger`), centre-out fill order, and
hero-first colour assignment. Visual weight is *calibrated*: `area × colour
contrast against the cell background`, so a near-invisible light-on-light shape
correctly counts as light. The driver scores `--candidates` (default 240)
candidates and keeps the top `--keep`.

**Calibration loop** (`scripts/fai_calibrate.py`) scores the 57 hand-made
reference banners in `output/banners-clean/` with the *same* axes (it rasterises
each cell region, classifies its geometry, and matches it to the nearest
manifest tile), then prints per-axis ref vs generated stats. Result: generated
banners average **total ≈ 0.88** vs reference **≈ 0.55** after the tuning pass.
The generator does **not** exceed references on every axis in every mode; the
important correction is that full-mode temperature now clears the reference
mean, while rhythm, negative space, hero clarity, and template fidelity carry
real variance and selection pressure.

### 3. Four color modes (goal 3 + June tuning)
`--color-mode {full,duotone,vertical,extended}`, default `full`.
- `full` — all 7 ratified fills, with warm/cool temperature **zoning** aligned to
  the hero column.
- `duotone` — Cod Gray + International Orange + White.
- `vertical` — Cod Gray + `--vertical-hex <hex>` + White. The middle colour is
  **validated to be one of the 7 ratified FAI fills** and rejected otherwise.
- `extended` — the full 7-fill palette plus proposal accents supplied through
  repeatable `--extra-hex`, gated by `--allow-unratified-hex`.

### Tuning pass (June 2026)
The independent review was correct: the rebuilt generator was mechanically
sound, but the fixed 6x3 fill-every-cell model still produced too many
quilt-like top-ranked banners. This pass changed the composition model rather
than only moving score weights:

- Hero supercells: the focal tile can now span 2x2, 2x1, or 1x2 cells. It is
  placed around a power position, rendered large, and scored for span clarity
  and lighter neighbours.
- Empty cells: templates now include `E` cells. These render as pure white
  canvas, are clustered near margins/corners, and are scored as first-class
  negative space.
- Rhythm: the old shape-repetition score was degenerate. It now uses
  distribution entropy, unique-shape range, overuse penalties, and adjacent-run
  penalties, so candidates show meaningful variance.
- Template fidelity: candidates are scored against their selected macro map.
  Heavy/light/empty violations lower the total, and sweep/banding templates get
  gesture-specific checks.
- Directional flow: tile rotation now rotates `dominant_direction` before
  adjacency scoring.
- Temperature: full/extended mode zoning was strengthened; generated full-mode
  temperature now exceeds the reference mean.

Final calibration from:

```sh
$PY scripts/fai_calibrate.py --compare 12
```

| axis | reference mean | generated full mean | generated duotone mean | generated vertical mean |
|---|---:|---:|---:|---:|
| anchor | 0.642 | 0.792 | 0.775 | 0.792 |
| rhythm | 0.161 | 0.871 | 0.890 | 0.890 |
| direction | 0.606 | 0.638 | 0.631 | 0.636 |
| weight | 0.937 | 0.997 | 1.000 | 1.000 |
| negative | 0.362 | 0.816 | 0.833 | 0.829 |
| temperature | 0.468 | 0.554 | 0.428 | 0.413 |
| family | 0.268 | 0.954 | 0.905 | 0.935 |
| hero | 0.477 | 0.864 | 0.846 | 0.825 |
| template | 0.700 | 0.747 | 0.800 | 0.775 |
| total | 0.548 | 0.884 | 0.874 | 0.872 |

Verification sheets are in `output/tuning-verify/`. Proxy checks for top 8 of
240 candidates passed in every color mode: hero supercell 8/8, empty fraction
in 0.15-0.30 for 8/8, rhythm standard deviation 0.258-0.291 across each
240-candidate pool.

Studio:

```sh
$PY scripts/fai_studio.py
# open http://127.0.0.1:8765
```

The studio serves SVG without Cairo. PNG download appears only when `cairosvg`
imports cleanly. Render deploy uses:

```sh
python scripts/fai_studio.py --host 0.0.0.0 --port $PORT
```

### 4. Consolidation (goal 4)
- **One manifest.** `tiles-manifest-v2.json` is the only manifest any live tool
  reads. The legacy `tiles-manifest.json` was moved to `_legacy/`.
  `build_manifest.py`'s default output now points at v2.
- **One contact/montage tool.** `scripts/fai_contact.py` (`tiles` and `banners`
  subcommands) replaces the five overlapping scripts (`contact_all.py`,
  `contact_pick.py`, `family_montage.py`, `sets_montage.py`,
  `generate_contact_sheet.py`), now in `scripts/_retired/`.
- **Studio retired.** The hand-rolled `http.server` (`scripts/banner_studio.py`
  + `studio/{index.html,app.js,styles.css}`) is replaced by the CLI plus the
  static contact-sheet generator. The web files are in `scripts/_retired/` and
  `studio/_retired/`; `render.yaml` no longer deploys a server; `.claude/
  launch.json` now runs the contact-sheet generator. The generator core
  (`generate_banner()` / `render_svg()`) is fully decoupled from I/O, so a thin
  Flask/FastAPI wrapper can restore a hosted UI later with no refactor.
- The ~2900-line old `generate_banner.py` is retired in favour of `fai_banner.py`.

### 5. Fragile tiles fixed, not quarantined (goal 5)
The brief flagged Cascade/Centric path artifacts and Mirror circles. Diagnosis
turned up a broader, more important issue: the **old renderer only extracted the
first `<path>` of each tile and recoloured every fill to one colour**, which
silently broke a large fraction of the library:
- all 11 `Composition/*.svg` (Adobe-Illustrator **CSS-class** fills — no inline
  `fill`, so the old reader drew nothing);
- `Circle/05–08` (built from `<circle>` elements, not `<path>` — invisible);
- multi-element tiles (Lines stripe fields up to 10 paths, Mirror, Cascade —
  only the first element drew);
- 7 **figure-on-ground** tiles (a dark shape + a light cut-out the colour of the
  tile background — flattened by recolour-everything).

Two fixes:
1. **`scripts/fai_tile_render.py`** — a robust extractor used by both the
   generator and the contact tool. It resolves CSS-class fills (honouring
   `display:none`), identifies the background fill, classifies every foreground
   fill as *ink* vs *ground*, and re-emits the foreground remapping ink → the
   cell's foreground colour and ground → the cell's background colour. Every
   element type (`path/circle/ellipse/polygon/polyline/rect/line`) and any
   `transform` is carried through. Figure-on-ground cut-outs now correctly take
   the cell background, so they read as windows rather than disappearing.
2. **`scripts/fai_sanitize_tiles.py`** — a one-time, idempotent library pass
   that rounds away the scientific-notation float dust (every such value in the
   library is `< 1e-3`, i.e. a rounding artefact from Figma boolean ops) and
   inlines the Composition CSS-class fills. Geometry is unchanged (verified
   identical rendered fill fraction to 4 dp). After this pass: 0 sci-notation,
   0 CSS-class tiles, all 140 valid XML. The manifest's previously-wrong
   `path_count` (it claimed `1` everywhere) was also recomputed.

Net result: every renderable tile in the library now draws correctly in all
color modes. Only **one** tile is quarantined — `Lines/Clear.svg`, which
is genuinely missing on disk (logged in the manifest `quarantine` list with a
reason); the generator excludes quarantined / non-renderable tiles.

### 6. Samples + notes (goal 6)
12 tuned sample banners (SVG + PNG, 1920×960) are in
`output/banners-rebuilt/`, plus `_contact-sheet.{svg,png}`.
This file is the notes.

---

## Live scripts (after the rebuild)

| script | role |
|---|---|
| `fai_banner.py` | the generator — CLI + generate-and-score core |
| `fai_tile_render.py` | robust per-tile foreground extraction + recolour |
| `fai_contact.py` | contact/montage sheets (`tiles` / `banners`) |
| `fai_calibrate.py` | reference-banner calibration loop |
| `fai_studio.py` | minimal Flask web studio for creative-director testing |
| `fai_sanitize_tiles.py` | one-time tile-library hygiene pass |
| `build_dominant_direction.py` | enrich v2 manifest with direction/raster_fill/quarantine |
| `svg_raster.py` | cairosvg wrapper + Pillow-free PNG decoder |
| `build_manifest.py` | upstream manifest builder (qlmanage + Pillow) |
| `clean_svgs.py`, `simplify_tiles.py`, `fai_colors.py` | upstream tile pipeline (unchanged) |

Retired (kept for rollback, safe to delete after sign-off): `scripts/_retired/`,
`studio/_retired/`, `_legacy/tiles-manifest.json`.

---

## Known limits / open questions for the CD

- **Mode-specific temperature remains intentional.** Full and extended modes
  have real warm/cool zoning. Duotone and vertical are constrained palettes, so
  their temperature scores can sit below full even when the compositions are
  otherwise strong.
- **Flask is now required for the studio.** Install with `pip install -r
  requirements.txt`; Render does this in `buildCommand`.
- **Scoring weights are still tuning knobs.** The current values are in
  `SCORING_WEIGHTS`, with negative space weighted more heavily than the
  supplement's starter values.
- **Rotation is folded into directional flow.** Rotation is still chosen during
  generation, but the flow score now evaluates each tile's rotated
  `dominant_direction`.
- **Reference matching is approximate.** The calibration loop infers each
  reference cell's tile by nearest area+direction match (references are flattened
  SVGs with no per-cell metadata), so reference sub-scores are indicative, not
  exact — good enough to establish target ranges, as the supplement intends.
- **`build_manifest.py` uses a different stack** (`qlmanage` + Pillow) from the
  venv (cairosvg). It is the upstream builder and wasn't part of this rebuild;
  the enrichment step (`build_dominant_direction.py`) runs in the venv. If the
  tile set changes, run `build_manifest.py` → `fai_sanitize_tiles.py` →
  `build_dominant_direction.py` in that order.
- **No automated PNG-diff test.** End-to-end runs are verified by eye + by the
  calibration numbers. A pixel regression harness would be a reasonable next
  step if this gets heavy reuse.
