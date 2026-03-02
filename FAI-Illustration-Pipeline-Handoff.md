# FAI Illustration System Automation — Claude Code Handoff Brief

**Project Owner:** Chris McCaffery, Creative Director, Foundation for American Innovation
**Date:** March 2, 2026

---

## What This Project Is

FAI has a modular illustration system built from geometric vector shapes arranged on a grid. Currently these exist as a semi-organized Figma library. The goal is to **standardize the atomic vector tiles, define a composition grammar, and build a Python-based generator** that can automatically assemble on-brand banner compositions from the cleaned tile set.

---

## Current State (What Exists)

Everything lives in **three compound SVG files** exported from Figma, bundled in a single input folder. Each file contains many individual items arranged on a large canvas. Nothing is pre-separated.

### Source Files (in `input/`)

| File | Contents | Expected structure |
|---|---|---|
| `tiles.svg` | ~30–50 individual 1×1 shape tiles | Each tile is a top-level `<g>` group (or a frame-equivalent with a `<rect>` clip) arranged on a grid or scattered on the Figma canvas. Tiles are square and roughly the same size, but positions and construction methods vary. |
| `banners.svg` | ~50+ assembled 6×3 banner compositions | Each banner is a top-level `<g>` group containing 18 tile instances arranged in a 2:1 landscape layout. Banners are laid out in rows/columns or stacked vertically on the canvas. |
| `illustrations.svg` | ~18 freestyle 1×1 compositions | Each illustration is a top-level `<g>` group in a square format, figure-on-ground style. Used for social posts, podcast thumbnails, avatars. |

### What's messy about them

- **Tiles:** Inconsistent construction — some are simple `<path>` elements, some are formed by a shape intersecting a square clipping mask, some have unexpanded boolean operations. Colors are inconsistently applied (some off-brand fills, some correct).
- **Banners:** Some use clipping paths at the banner level. Tile instances within banners may be `<use>` references, inlined groups, or flattened paths. Naming and ordering is inconsistent.
- **Illustrations:** Similar construction issues to tiles. These are out of scope for the generator but should still be split and cleaned for the asset library.

### Key challenge

The first task before any cleanup or generation can happen is **splitting each compound SVG into individual files** — one SVG per tile, one per banner, one per illustration. The splitting logic needs to be smart about detecting the boundaries between items based on top-level grouping, spatial clustering, or both.

---

## Brand Color Tokens (non-negotiable)

These are the ONLY fill colors permitted in any tile or composition:

```
BRAND_COLORS = {
    "international_orange": "#FF4F00",
    "cod_gray":             "#121212",
    "white":                "#FFFFFF",
    "smoke_white":          "#F3F3F3",
    "chrome_yellow":        "#FFA300",
    "celestial_blue":       "#4997D0",
    "timberwolf":           "#D9D9D6",
}
```

No gradients, no shadows, no opacity variations, no strokes (fills only). Every shape is a solid flat fill in one of these seven colors. The design language is Swiss internationalist — hard edges, geometric precision.

---

## Phase 0: Split Compound SVGs into Individual Files

### Input
Three SVG files in `input/`:
- `tiles.svg`
- `banners.svg`
- `illustrations.svg`

### Splitting strategy

Figma exports each frame or top-level component as a `<g>` element (group) within the root `<svg>`. The script should:

1. **Parse the root SVG** and identify all top-level `<g>` children of the root `<svg>` element. In Figma exports, each frame typically becomes a direct child group, often with an `id` attribute derived from the Figma layer name.

2. **Determine bounding boxes.** For each top-level group, compute the aggregate bounding box of all its child elements. This is how we know the position and size of each item on the canvas.

3. **Classify by aspect ratio and size** (as a sanity check):
   - From `tiles.svg`: expect roughly square bounding boxes, similar sizes → individual tiles
   - From `banners.svg`: expect ~2:1 landscape bounding boxes → individual banners
   - From `illustrations.svg`: expect roughly square bounding boxes → individual illustrations

4. **Extract each group into its own SVG file:**
   - Create a new SVG document with a `viewBox` tightly cropped to the group's bounding box
   - Translate all coordinates so the group is positioned at origin (0,0)
   - Carry over any `<defs>` (gradients, clips, patterns) that are referenced by elements within the group — but NOT defs used only by other groups
   - Preserve the Figma layer name (from the `id` attribute) as the output filename, sanitized: lowercased, spaces → hyphens, stripped of special characters (e.g., `"Pod Horizontal 02"` → `pod-horizontal-02.svg`)

5. **Handle edge cases:**
   - If a group contains a `<clipPath>` or `<mask>` that clips it to a rectangle, note this in the manifest but preserve it for now (Phase 1 will deal with cleanup)
   - If Figma has nested the items deeper than one level (e.g., `<svg> → <g id="page"> → <g id="tile-1">`), detect the nesting and walk down to the item-level groups
   - If any group has no `id` or a generic `id`, assign a sequential name: `tile-001.svg`, `banner-001.svg`, etc.
   - Some Figma exports include a background `<rect>` as the first child of the root — detect and skip it

### Output

```
tiles-raw/          ← individual tile SVGs split from tiles.svg
  ├── circle-full.svg
  ├── semicircle-left.svg
  ├── pod-horizontal-02.svg
  └── ... (30–50 files)

banners-raw/        ← individual banner SVGs split from banners.svg
  ├── banner-001.svg
  ├── banner-002.svg
  └── ... (50+ files)

illustrations-raw/  ← individual illustration SVGs split from illustrations.svg
  ├── illustration-001.svg
  ├── illustration-002.svg
  └── ... (~18 files)

split-report.md     ← summary: how many items found per file, any warnings
```

### Split report should include
- Number of groups found and extracted from each source file
- For each extracted item: filename, source group id, bounding box dimensions, aspect ratio
- Warnings for: items with unexpected aspect ratios, items that reference defs from other groups, items with no id, deeply nested structures that required traversal

---

## Phase 1: SVG Tile Cleanup & Audit

### Input
The `tiles-raw/` directory produced by Phase 0 — one SVG per tile, messy but separated. Also run against `illustrations-raw/` using the same logic (illustrations need cleanup too, even though they aren't used in the generator yet).

### What the script should do

1. **Parse each SVG** and report:
   - All unique fill colors found (flag any not in the brand palette)
   - Presence of `<clipPath>`, `<mask>`, or CSS `clip-path` properties
   - Presence of `<linearGradient>`, `<radialGradient>`, or opacity/filter attributes
   - Presence of stroke attributes (should be fills only)
   - ViewBox dimensions (should be square, e.g., `0 0 500 500`)
   - Number of path elements

2. **Auto-fix where possible:**
   - Snap off-brand fill colors to the nearest brand color (by perceptual distance — use CIELAB ΔE, not just Euclidean RGB)
   - Remove stroke attributes, converting thin strokes to filled paths if feasible
   - Normalize viewBox to a standard size (e.g., `0 0 500 500`)
   - Strip metadata, comments, Figma-specific attributes

3. **Generate an audit report** (markdown or HTML) showing:
   - Thumbnail of each tile (inline SVG or PNG render)
   - Status: CLEAN / NEEDS_MANUAL_FIX / AUTO_FIXED
   - What was fixed or what needs manual attention

### Output
A `tiles-clean/` directory with standardized SVGs and the audit report.

---

## Phase 2: Composition Grammar

### Grid specification
- Canvas: 6 columns × 3 rows = 18 tile slots
- Each slot is 1×1 (square)
- Final output aspect ratio: 2:1 (e.g., 3000×1500, 1200×600)
- Tiles are placed edge-to-edge, no gaps, no overlap

### Color distribution rules (the "volume knob")

Define energy levels that constrain color usage:

| Energy Level | Description | Constraints |
|---|---|---|
| `low` | Monochrome + accent | Max 3 colors total. Must include Cod Gray or White as dominant (≥12 of 18 tiles). Exactly 1–2 tiles in International Orange. No Yellow, Blue, or Teal. |
| `medium` | Balanced brand | 4–5 colors. Orange in 2–4 tiles. No single color in more than 6 tiles. |
| `high` | Full palette | All 6–7 colors represented. Orange in 3–5 tiles. At least 1 tile each of Blue, Yellow. More even distribution. |

### Adjacency rules (soft constraints, not hard)
- No two horizontally or vertically adjacent tiles should have the same fill color
- Prefer alternating warm/cool across rows
- These can be treated as scoring preferences in the generator rather than strict rejections

### Tile categorization
Each tile should be tagged with metadata:
- `edge_type`: which edges have shapes that bleed to the boundary vs. have internal negative space (matters for visual flow between adjacent tiles)
- `visual_weight`: light / medium / heavy (how much of the 1×1 square is filled)
- `shape_family`: circle, arc, bar, wave, pod, eye, geometric, organic

---

## Phase 3: Banner Generator

### Core logic

```
generate_banner(
    tiles_dir: str,           # path to clean SVG tiles
    energy: str = "medium",   # "low" | "medium" | "high"
    seed: int = None,         # for reproducibility
    output_format: str = "svg", # "svg" | "png" | "pdf"
    dimensions: tuple = (3000, 1500),
    color_bias: str = None,   # optional: bias toward a specific brand color
) -> str                      # path to output file
```

### Assembly approach
1. Filter tiles by compatibility with the energy level's color constraints
2. For each of 18 grid positions, select a tile (weighted by visual_weight distribution and edge compatibility with neighbors)
3. Assign a fill color from the energy level's permitted palette, respecting adjacency rules
4. Composite the 18 tiles into a single SVG by placing them with `<use>` or inlined `<g>` elements at computed x/y offsets
5. Optionally re-color each tile's fills by replacing the source fill with the assigned grid color (tiles should be designed so they work as single-color shapes on a contrasting background — the generator picks both the shape and its color)

### Recoloring strategy
Each tile SVG should use a single foreground fill color. The generator overrides this fill at placement time. This means:
- Tile SVGs should use a placeholder fill (e.g., `#000000`)
- Generator replaces all `fill` attributes with the assigned brand color
- Background color for each tile slot is determined by the tile behind it or by the grid's background layer

**Important nuance:** Some tiles are "figure on ground" (shape + background are both visible) and some are "full bleed" (shape fills the entire square). The generator needs to handle both — figure-on-ground tiles need both a foreground and background color assignment.

### Batch generation
```
generate_batch(
    n: int = 20,
    tiles_dir: str,
    output_dir: str,
    energy_mix: dict = {"low": 0.3, "medium": 0.5, "high": 0.2},
)
```

### Contact sheet
After batch generation, produce an HTML contact sheet showing all generated banners at thumbnail scale with their filename, energy level, and seed number for reproducibility.

---

## Phase 4 (Future): Web UI

Not in scope for now, but the architecture should anticipate a simple web frontend where a user can:
- Select energy level
- Click "generate" and see a preview
- Lock specific tile positions or colors
- Export SVG/PNG/PDF

Keep the generator logic cleanly separated from I/O so it can be wrapped in a Flask/FastAPI endpoint later.

---

## Technical Notes

- **Python 3.10+** preferred
- Key libraries: `lxml` (preferred over `xml.etree` — better XPath support, needed for complex SVG traversal in Phase 0), `cairosvg` or `svglib` for PNG/PDF export, `colormath` for CIELAB distance calculations
- No external API dependencies — this should run fully offline
- SVG output should be valid SVG 1.1 with no Figma-specific namespaces
- Keep the tile metadata in a simple JSON sidecar file (`tiles-manifest.json`) rather than embedding it in the SVGs
- **Phase 0 parsing note:** Figma SVG exports use the SVG namespace (`http://www.w3.org/2000/svg`) — all element lookups need to be namespace-aware. Figma also adds its own namespace for metadata. Strip Figma-specific attributes/namespaces during splitting.

---

## File Structure

```
fai-illustration-system/
├── HANDOFF.md                  ← this file
├── brand-colors.json           ← canonical color definitions
├── input/                      ← THE STARTING POINT — 3 compound SVGs from Figma
│   ├── tiles.svg               ← all ~30–50 tiles on one canvas
│   ├── banners.svg             ← all ~50+ banners on one canvas
│   └── illustrations.svg       ← all ~18 illustrations on one canvas
├── tiles-raw/                  ← Phase 0 output: split individual tile SVGs
├── banners-raw/                ← Phase 0 output: split individual banner SVGs (reference)
├── illustrations-raw/          ← Phase 0 output: split individual illustration SVGs
├── tiles-clean/                ← Phase 1 output: audited & auto-fixed tiles
├── illustrations-clean/        ← Phase 1 output: audited & auto-fixed illustrations
├── tiles-manifest.json         ← tile metadata (edge_type, weight, family)
├── scripts/
│   ├── split_svgs.py           ← Phase 0: split compound SVGs into individuals
│   ├── audit_tiles.py          ← Phase 1: cleanup & audit
│   ├── generate_banner.py      ← Phase 3: banner generation
│   └── generate_contact_sheet.py
├── output/
│   ├── banners/
│   └── contact-sheets/
├── reports/
│   ├── split-report.md         ← Phase 0 report
│   └── audit-report.html       ← Phase 1 report
└── tests/
```

---

## Success Criteria

0. Compound SVGs are correctly split into individual files with no lost elements and no cross-contaminated defs
1. Every tile SVG passes validation: square viewBox, brand-only colors, no clips/masks/gradients
2. Generator can produce 50 unique banners in under 60 seconds
3. Generated banners are visually consistent with the existing hand-made library (banners-raw/ serves as reference)
4. Color distribution rules are respected (verifiable by parsing the output SVG)
5. Contact sheet makes it easy to review and curate the output
