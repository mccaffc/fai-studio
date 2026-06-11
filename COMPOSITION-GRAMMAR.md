# FAI Composition Grammar

Creative direction, June 2026:

> The current generator composes per-cell (each cell gets independent bg+fg+tile+rotation) and then scores candidates. The canonical banners work on different principles, and per-cell generation CANNOT express them — scoring can't fix a generative space that doesn't contain the good compositions. The canonical principles:
> 1. ONE shared ground per banner (usually Cod Gray #121212; sometimes White or a half/half field split on a column line). Shapes sit ON the ground. No per-cell backgrounds, ever.
> 2. SUPER-FORMS: large multi-cell structures — concentric ring/arc fields (Lines/Centric families) tiled 2×2..3×3 with rotations chosen so arcs CONNECT exactly across seams (use edge_type/edge_coverage to solve connections as a CONSTRAINT, not a score); big U-forms/monuments built from 2-4 fused cells. A banner reads as 2–4 big forms.
> 3. MIRROR SYMMETRY BY CONSTRUCTION: compose a half (or quadrant), reflect across the vertical center (SVG transform scale(-1,1) on the tile group; reflection of official tiles is permitted like rotation). Many references are bilaterally symmetric or contain mirrored pairs.
> 4. FRIEZE ROWS: a full row (or row segment) of ONE tile repeated with a rhythm rule — identical / alternating rotation (0,180,0,180) / mirrored pairs (A, flip(A), A, flip(A)). Pods, eyes, scallops.
> 5. EDGE-FUSION: adjacent cells in the same form share the same ink so shapes flow continuously; never two inks inside one continuous form.
> 6. COLOR ECONOMY BY RUN: ground constant; WHITE is the primary shape ink; at most 2 accent hues per banner; color assigned per LAYER/RUN (a frieze is one ink; a super-form is one ink), never per cell. Punctuation: 1–3 small solo accent shapes (dot / half-circle) at rule-of-thirds power positions.

## Implementation Notes

`scripts/fai_banner.py` now treats generation as a grammar-first candidate source. Scoring is still used as the selector, but candidates are assembled from shared-ground layers:

- `superform(region, family, connection-solved rotations, ink)`: chooses edge-rich Lines, Centric, Curve, or Circle tiles and repeats them through a multi-cell region with a deterministic quarter-turn rhythm.
- `frieze(row, tile, rhythm_rule, ink)`: repeats one tile with `identical`, `alternating_rotation`, or `mirror_pair` rhythm.
- `mirror(layout)`: uses `Cell.flip_x` and SVG `scale(-1,1)` transforms for mirrored pairs.
- `punctuation(n <= 3, power positions, accent ink)`: places small accent shapes on open power positions.

Grammar template names exposed in the CLI and Studio are `mirror_monument`, `frieze_stack`, `ring_field`, `field_split`, and `eye_row`. Small-surface library layouts are `mini_frieze` and `mini_panel`.

Color is run-based. Duotone is Cod Gray ground plus White primary shapes plus International Orange accents. Full and extended keep the ratified/proposal meanings but assign hue by layer/run rather than by cell.

## Reusable API

```python
from scripts.fai_banner import compose

svg = compose(
    cells=(3, 1),
    ground=None,
    inks={"primary": "#FFFFFF", "accent": "#FF4F00"},
    layout="mini_frieze",
    seed=11,
    cell_px=180,
)
```

This returns a transparent-ground 3x1 orange accent cluster suitable for placing beside a deck title.

```python
from scripts.fai_banner import compose

svg = compose(
    cells=(2, 3),
    ground="#121212",
    inks={"primary": "#FFFFFF", "accent": "#FF4F00"},
    layout="mini_panel",
    seed=22,
    cell_px=220,
)
```

This returns a 2x3 Cod Gray vertical panel with mirrored/super-form construction.
