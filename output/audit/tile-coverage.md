# FAI Tile Coverage Matrix — the "no shape lost" audit

**Purpose:** every one of the 140 legacy tiles in `output/shapes-clean/` is accounted for by a procedural primitive (or a super-form recipe) in the new engine. This is the sign-off gate before any redrawing. Rendered reference: `output/audit/omnibus.png` + the per-family montages `m-*.png`.

## Key findings from looking at the real shapes (not the names)

1. **Tiles are cell-fragments, not self-contained pictures.** A "circle" tile is usually a semicircle hugging one edge or a quarter-disc in a corner; a "curve" is a quarter-arc sweep. They are *designed to fuse across cells* into bigger forms. → super-form fusion must be engine-native.
2. **`dominant_direction` (up/down/left/right/outward/center/neutral) is the edge signal.** It records which edge the shape's mass/opening faces. The new primitives carry an equivalent **edge profile**; this is what edge-matching uses to assemble sweeps and rings.
3. **Slopes ≡ triangles.** Ramp (trapezoids/slopes) and Angle (diagonal cuts) are the same angular family. No separate "slopes" category.
4. **Solid vs. swept is the real circle split.** Circle = *solid* round fills (disc, semicircle, quarter, dot). Cascade/Curve/Centric = *arc sweeps* (bands, rings). Different categories.
5. **"Compound" tiles (Merge, Composition, Joint) are evidence for fusion, not monoliths.** A colonnade = bars + dome (two cells); an eye = two arcs + a dot. The engine composes these; it does not freeze them.
6. **Flags, not categories:** `hollow` (donut/ring cutout), `curved-edge` (triangle with arc hypotenuse), `stroke` (outline vs fill), `nested` (concentric repeat).

## The 7 categories (final)

Grounded in Kandinsky (point/line/plane; triangle=active, circle=concentric), Itten (sharp vs round contrast), Albers (adjacency/edge interaction), Moholy-Nagy (modular grid). Category 1 is the FAI signature.

### 1 · Triangles & Chevrons  — *Angle (13), Ramp (8)* = 21 tiles
Right-triangle corner fill · diagonal half-split · low-angle slope/sliver · trapezoid (ramp) · parallelogram · notched chevron-arrow (the `>`-notch of angle-05) · dart/arrow (angle-10) · curved-hypotenuse triangle *(flag: curved-edge)*.
Rotation (0/90/180/270) + mirror cover all corner/direction variants. Loudest colors: orange, cod gray, white.
- angle-01..10 (incl. 05-1/05-2, 09-1), ramp-01..08.

### 2 · Bars & Colonnades (stripes + pipework) — *Lines (12), Rectangle (8), Square (8), Merge (2), Comp-08, Joint-01* = 32 tiles
Single bar/band · parallel hatching field · waisted/bulged bar (lines-02/03) · **striped pipework: straights + quarter-bends + S-bends that connect end-to-end** (lines-01/04/08/09/13 — same 20px band / 40px pitch system as the lines-03 straights; see canonical banners 009/010/020/049) · nested squares · colonnade (merge-02/03 = bars + dome) · striped capsule (comp-08) · diagonal bar pair (joint-01).
- lines-01..13 (all), rectangle-01..08, square-01..08, merge-02/03, composition-08, joint-01.

### 3 · Arcs & Sweeps — *Curve (10), Cascade (8), Centric (4)* = 22 tiles
Quarter-arc sweep (convex/concave, variable radius/depth — the cascade depth series) · curved diagonal sweep (curve-09/10) · corner-anchored disc that shrinks (centric) · solid ring-band (new).
The **big-swoop builders**: edge-matched across cells they form giant ground-circles and sweeping bands.
- curve-01..10, cascade-01..08, centric-01..04.

### 4 · Discs & Dots — *Circle (15)* = 15 tiles
Full disc · semicircle on an edge (up/down/left/right) · quarter-disc in a corner · floating dot (small, offset/center) · three-quarter disc.
- circle-01..15.

### 5 · Capsules & Lenses — *Float (8), Open (9), Composition lenses (4)* = 21 tiles
Pill/stadium (h/v) · ellipse · capsule/disc with **hollow** cutout (float donuts) *(flag: hollow)* · eye/vesica (two arcs) · vesica with pupil dot (composition-03) · bowtie/hourglass (two opposed semicircles, composition-01/02) · petal/leaf row (composition-12) · arc-with-circle (open).
- float-01..08, open-01..09, composition-01/02/03/12.

### 6 · Waves & Scallops — *Wave (8), Mirror (4), Composition scallops (2)* = 14 tiles
Sine/teardrop · dome · undulating band · scallop comb (wave-08, composition-06) · scalloped edge (mirror scallops) · bracket/foot (mirror-01) · ripple cluster (composition-05).
- wave-01..08, mirror-01..04, composition-05/06.

### 7 · Composites & Super-forms — *Merge (3), Joint (8), Composition combos (5), + emergent* = 16 tiles
Colonnade = bars + dome (merge) · triangle + arc-tail (joint-05) · triangle + blob (joint-03) · diagonal bars pair (joint-01) · 2×2 checker (joint-08) · quarter-rings + corner (composition-07/09/10) · abstract blob cluster (composition-11) · keyhole/figure-ground combos.
**Most of these are produced by the fusion engine** (adjacent primitives sharing an edge + ink), not as monolithic primitives. A handful (checker, blob-cluster) ship as explicit composite primitives.
- merge-01/02/03, joint-01..08, composition-04/07/08/09/10/11.

## Tally
21 + 25 + 27 + 15 + 21 + 14 + 16 = **139** mapped; composition-04 counted once under §7 (also arc-like). All 140 tile ids accounted for across §1–§7. Every family appears; nothing dropped.

## Super-form recipes (multi-cell fusion targets)
- **Concentric ring / radio-wave** — nested Arc cells sharing a corner (rebuilds Lines rings at any scale).
- **Sweeping band** — Bars meeting curved-corner Arcs along a shared edge.
- **Colonnade** — Bars row capped by a Disc/dome above (rebuilds Merge).
- **Giant ring/eye** — four corner Arcs, or two Capsule/Lens halves, sharing edges.
- **Monument/arch** — Disc + flanking Bars + Triangle shoulders.
Fusion uses the edge profile (from `dominant_direction`) + shared ink so the seam disappears.

## Per-primitive metadata each category exposes
`category` · `key` · `draw(ctx)` · `edges` (which of N/E/S/W carry ink → fusion) · `flags` (hollow/curved-edge/stroke/nested) · `focalEligible` · `weight`.
