# FAI Banner Composition Logic — Supplementary Brief

**Companion to:** FAI-Illustration-Pipeline-Handoff.md
**Purpose:** Defines the aesthetic principles and scoring system the banner generator must use to produce authentic Bauhaus/Swiss internationalist compositions rather than random tile arrangements.

---

## The Core Problem

Placing 18 tiles on a 6×3 grid with valid colors is trivially easy. Making the result look *designed* — like something a trained mid-century graphic designer would compose — is the actual challenge. Random placement with color adjacency constraints will produce arrangements that feel like a quilt, not a poster.

The solution is a **generate-and-score** approach: produce many candidate compositions quickly, score each on multiple aesthetic axes, and keep the highest-scoring results. This mirrors how a designer actually works — sketching many options, then selecting and refining the best.

---

## Required Tile Manifest Metadata

Before any composition logic can work, each tile in `tiles-manifest.json` needs these properties. Some can be computed automatically from the SVG geometry; others require a one-time manual pass or a heuristic classification.

```json
{
  "id": "semicircle-left",
  "file": "semicircle-left.svg",

  "visual_weight": 0.5,
  "shape_family": "curve",
  "dominant_direction": "left",

  "edge_activity": {
    "top": true,
    "right": false,
    "bottom": true,
    "left": true
  },

  "symmetry": "vertical",
  "complexity": "simple"
}
```

### Property definitions

**`visual_weight`** (float, 0.0–1.0)
The proportion of the tile's area that is filled by the foreground shape. A solid square = 1.0. A small circle centered in the square ≈ 0.3. A semicircle ≈ 0.5. Can be computed automatically by rasterizing the tile at a small resolution (e.g., 100×100) and counting filled vs. empty pixels.

**`shape_family`** (enum)
- `"curve"` — circles, semicircles, arcs, pods, lozenges, ovals, waves, eye/vesica piscis
- `"rectilinear"` — vertical bar clusters, stripe fields, rectangular blocks, hard-edge geometric
- `"mixed"` — combines both (e.g., bars with a curved cap)

**`dominant_direction`** (enum)
The direction the shape's visual energy "pushes" toward:
- `"left"` / `"right"` / `"up"` / `"down"` — asymmetric shapes that imply movement
- `"center"` — centripetal shapes (concentric circles, targets, inward-pointing forms)
- `"outward"` — centrifugal shapes (radiating arcs, expanding rings)
- `"neutral"` — no directional bias (solid fills, perfectly centered symmetric shapes)

**`edge_activity`** (object, four booleans)
For each edge of the square (top, right, bottom, left): does the foreground shape touch or bleed to that edge? A full circle has all four edges active. A semicircle on the left has left/top/bottom active but right inactive. This drives adjacency flow decisions — shapes that bleed to a shared edge create visual continuity; shapes that don't create a gap or breathing room.

**`symmetry`** (enum)
- `"none"` — asymmetric
- `"vertical"` — symmetric across the vertical axis
- `"horizontal"` — symmetric across the horizontal axis
- `"both"` — symmetric on both axes (circles, squares, concentric rings)
- `"rotational"` — rotational symmetry but not reflective

**`complexity`** (enum)
- `"simple"` — 1–2 shapes/paths (a single circle, one arc)
- `"moderate"` — 3–5 shapes (bar cluster, concentric rings)
- `"complex"` — 6+ shapes (dense multi-element compositions)

---

## Composition Strategy: Generate → Score → Select

### Overview

```
for i in range(NUM_CANDIDATES):       # e.g., 200
    composition = generate_candidate()
    score = score_composition(composition)
    candidates.append((composition, score))

candidates.sort(by score, descending)
return candidates[:NUM_OUTPUTS]        # e.g., top 10
```

Candidate generation should be fast (no rendering, just data). Scoring is where all the aesthetic logic lives. This decoupling means you can tune the scoring weights without changing the generation logic.

### Step 1: Generate a candidate

1. **Select the shape palette.** Pick 3–5 unique tile shapes for this composition (not all 30+). Bias toward tiles from the same or complementary `shape_family` values. Each selected shape will be used 2–5 times. Optionally add 1–2 "singleton" shapes for punctuation.

2. **Place anchor tiles.** Choose 2–3 grid positions as compositional anchors (see Anchor Placement below). Assign high-weight tiles and high-contrast colors (International Orange, Celestial Blue) to these positions.

3. **Fill remaining positions.** Distribute the remaining shape palette across the grid, respecting the color energy level constraints from the main handoff brief.

4. **Assign colors.** Apply the volume-knob color distribution rules, then refine with the color temperature zoning logic below.

### Step 2: Score the candidate

Compute a weighted sum of the following sub-scores, each normalized to 0.0–1.0:

```
total_score = (
    W_ANCHOR    * anchor_triangle_score     +
    W_RHYTHM    * shape_repetition_score     +
    W_DIRECTION * directional_flow_score     +
    W_WEIGHT    * weight_balance_score       +
    W_NEGATIVE  * negative_space_score       +
    W_TEMP      * color_temperature_score    +
    W_FAMILY    * shape_family_grouping_score +
    W_HERO      * hero_tile_score
)
```

Suggested starting weights (tune empirically):

```python
SCORING_WEIGHTS = {
    "W_ANCHOR":    0.10,
    "W_RHYTHM":    0.20,
    "W_DIRECTION": 0.15,
    "W_WEIGHT":    0.15,
    "W_NEGATIVE":  0.10,
    "W_TEMP":      0.10,
    "W_FAMILY":    0.10,
    "W_HERO":      0.10,
}
```

---

## Scoring Functions — Detailed Specifications

### 1. Anchor Triangle Score

**Principle:** Every strong composition has 2–3 points of peak visual intensity that form a triangle across the canvas, preventing the eye from settling in one zone.

**Implementation:**
- Identify the 2–3 tiles with the highest `visual_weight × color_contrast` product (where `color_contrast` is higher for orange/blue, lower for gray/timberwolf).
- Compute the triangle they form on the 6×3 grid.
- Score based on how well-distributed the triangle is:
  - Ideal: vertices in different thirds of the grid (columns 1–2, 3–4, 5–6) AND on different rows.
  - Penalize: all anchors on the same row, all in the same column-third, or two anchors in adjacent cells.

```
Compositional "power positions" on the 6×3 grid (0-indexed):

    0   1   2   3   4   5
  ┌───┬───┬───┬───┬───┬───┐
0 │   │ ★ │   │   │ ★ │   │
  ├───┼───┼───┼───┼───┼───┤
1 │   │   │   │ ★ │   │   │
  ├───┼───┼───┼───┼───┼───┤
2 │ ★ │   │   │   │   │ ★ │
  └───┴───┴───┴───┴───┴───┘

★ = strong anchor positions (rule-of-thirds intersections)
```

### 2. Shape Repetition Score

**Principle:** Bauhaus compositions read as rhythmic because elements repeat with variation. Using too many unique shapes creates noise; too few creates monotony.

**Implementation:**
- Count unique tile shapes used in the 18-slot grid.
- Ideal range: 3–5 unique shapes for 18 slots.
- Each shape should appear 2–5 times.
- At most 2 shapes should be singletons (appear exactly once).

```python
def shape_repetition_score(composition):
    shape_counts = Counter(tile.shape_id for tile in composition)
    n_unique = len(shape_counts)
    n_singletons = sum(1 for c in shape_counts.values() if c == 1)

    # Ideal: 3-5 unique shapes
    unique_score = 1.0 if 3 <= n_unique <= 5 else max(0, 1.0 - abs(n_unique - 4) * 0.15)

    # Penalize excessive singletons
    singleton_penalty = max(0, (n_singletons - 2) * 0.2)

    return max(0, unique_score - singleton_penalty)
```

### 3. Directional Flow Score

**Principle:** Adjacent tiles should have directional sympathy — their implied movement should create flow, not collision.

**Good adjacency pairings:**
- Two shapes pointing the same direction → parallel flow (score: 0.8)
- Shape pointing right next to shape pointing left (meeting) → tension, but intentional if facing across the shared edge (score: 0.5 if facing, 0.2 if backs to each other)
- Directional shape next to neutral → clean transition (score: 0.7)
- Centripetal next to directional → directional "feeds into" the center (score: 0.9 if pointing toward centripetal)
- Two neutrals adjacent → fine but uninteresting (score: 0.6)

**Implementation:**
- For each pair of horizontally or vertically adjacent tiles, look up `dominant_direction` values.
- Compute pairwise flow scores using a lookup table.
- Average all pairwise scores.

```python
# Directional flow compatibility — horizontal adjacency (A left of B)
HORIZONTAL_FLOW = {
    ("right", "right"):    0.9,   # parallel flow
    ("right", "left"):     0.5,   # meeting
    ("left",  "right"):    0.2,   # diverging
    ("left",  "left"):     0.9,   # parallel flow
    ("right", "neutral"):  0.7,
    ("neutral", "left"):   0.7,
    ("right", "center"):   0.85,  # feeding into focus
    ("neutral", "neutral"): 0.6,
    # ... fill out remaining combinations
}
# Mirror logic for vertical adjacency using up/down
```

### 4. Weight Balance Score

**Principle:** Visual weight should distribute across the grid without making any row or half feel disproportionately heavy.

**Implementation:**
- Compute total `visual_weight` per row (3 rows of 6 tiles each).
- Compute total `visual_weight` per half (left 3 columns vs. right 3 columns).
- Score based on evenness:

```python
def weight_balance_score(composition):
    row_weights = [0.0] * 3
    left_weight, right_weight = 0.0, 0.0

    for pos, tile in composition.items():
        row = pos[1]  # 0, 1, 2
        col = pos[0]  # 0-5
        row_weights[row] += tile.visual_weight
        if col < 3:
            left_weight += tile.visual_weight
        else:
            right_weight += tile.visual_weight

    # Row balance: max row shouldn't exceed min row by more than 40%
    max_row = max(row_weights)
    min_row = min(row_weights)
    row_ratio = min_row / max_row if max_row > 0 else 1.0
    row_score = min(1.0, row_ratio / 0.6)

    # Left/right balance
    total = left_weight + right_weight
    if total > 0:
        lr_ratio = min(left_weight, right_weight) / max(left_weight, right_weight)
        lr_score = min(1.0, lr_ratio / 0.6)
    else:
        lr_score = 1.0

    return (row_score + lr_score) / 2
```

### 5. Negative Space Score

**Principle:** 20–30% of tile positions should be visually "light" (low fill), and these should cluster to form breathing room rather than scattering randomly.

**Implementation:**
- Classify each tile position as "light" if `visual_weight < 0.35`.
- Count light tiles: ideal is 4–6 out of 18 (22–33%).
- Measure clustering: average pairwise Manhattan distance between light positions. Lower = more clustered = better.

```python
def negative_space_score(composition):
    light_positions = [
        pos for pos, tile in composition.items()
        if tile.visual_weight < 0.35
    ]
    n_light = len(light_positions)

    # Count score: ideal 4-6 out of 18
    if 4 <= n_light <= 6:
        count_score = 1.0
    elif 3 <= n_light <= 7:
        count_score = 0.7
    else:
        count_score = max(0, 0.4 - abs(n_light - 5) * 0.1)

    # Clustering score
    if len(light_positions) >= 2:
        distances = []
        for i, a in enumerate(light_positions):
            for b in light_positions[i+1:]:
                distances.append(abs(a[0]-b[0]) + abs(a[1]-b[1]))
        avg_dist = sum(distances) / len(distances)
        cluster_score = max(0, 1.0 - (avg_dist / 4.0))
    else:
        cluster_score = 0.5

    return (count_score + cluster_score) / 2
```

### 6. Color Temperature Score

**Principle:** Compositions should have warm and cool *zones* with neutrals bridging them, not salt-and-pepper alternation.

**Color temperature classification:**
```python
COLOR_TEMPERATURE = {
    "#FF4F00": "warm",      # International Orange
    "#FFA300": "warm",      # Chrome Yellow
    "#4997D0": "cool",      # Celestial Blue
    "#D9D9D6": "cool",      # Timberwolf
    "#121212": "neutral",   # Cod Gray
    "#FFFFFF": "neutral",   # White
    "#F3F3F3": "neutral",   # Smoke White
}
```

**Implementation:**
- Classify each tile's assigned color as warm, cool, or neutral.
- Measure spatial coherence: warm tiles should be closer to other warm tiles, cool closer to other cool.
- Penalize salt-and-pepper alternation (neutral tiles between warm and cool zones are fine and desirable).

```python
def color_temperature_score(composition):
    warm_positions = [pos for pos, tile in composition.items()
                      if COLOR_TEMPERATURE[tile.color] == "warm"]
    cool_positions = [pos for pos, tile in composition.items()
                      if COLOR_TEMPERATURE[tile.color] == "cool"]

    def avg_internal_distance(positions):
        if len(positions) < 2:
            return 0
        dists = []
        for i, a in enumerate(positions):
            for b in positions[i+1:]:
                dists.append(abs(a[0]-b[0]) + abs(a[1]-b[1]))
        return sum(dists) / len(dists)

    warm_cohesion = max(0, 1.0 - avg_internal_distance(warm_positions) / 4.0)
    cool_cohesion = max(0, 1.0 - avg_internal_distance(cool_positions) / 4.0)

    return (warm_cohesion + cool_cohesion) / 2
```

### 7. Shape Family Grouping Score

**Principle:** Curvilinear and rectilinear shapes should appear in loose clusters ("phrases"), not random alternation.

**Implementation:**
- For each tile, note its `shape_family` (curve / rectilinear / mixed).
- Count how many adjacent-tile pairs share the same family.
- Ideal: ~50–65% of adjacencies are same-family (grouping without total segregation).
- Below 35% = too scattered. Above 80% = two families completely separated, reading as two disconnected compositions.

```python
def shape_family_grouping_score(composition):
    adjacencies = get_all_adjacent_pairs(composition)
    same_family = sum(
        1 for a, b in adjacencies
        if a.shape_family == b.shape_family
    )
    ratio = same_family / len(adjacencies)

    # Bell curve centered on 0.55
    return max(0, 1.0 - ((ratio - 0.55) ** 2) * 10)
```

### 8. Hero Tile Score

**Principle:** Every composition should have one clear focal point — the tile the eye goes to first.

**Implementation:**
- The "hero" is the tile with the highest `visual_weight` in International Orange (or strongest warm color present).
- Score on: (a) exactly one clear hero? (b) at a compositionally strong position? (c) immediate neighbors lower in weight and/or contrasting color?

```python
POWER_POSITIONS = {(1,0), (4,0), (3,1), (0,2), (5,2)}

def hero_tile_score(composition):
    hero_pos = max(
        composition.keys(),
        key=lambda p: (
            composition[p].color == "#FF4F00",
            composition[p].visual_weight
        )
    )
    hero = composition[hero_pos]

    # Position quality
    pos_score = 1.0 if hero_pos in POWER_POSITIONS else 0.5

    # Contrast with neighbors
    neighbors = get_neighbors(hero_pos)
    contrast_scores = []
    for n_pos in neighbors:
        if n_pos in composition:
            neighbor = composition[n_pos]
            weight_diff = abs(hero.visual_weight - neighbor.visual_weight)
            color_diff = 1.0 if neighbor.color != hero.color else 0.0
            contrast_scores.append((weight_diff + color_diff) / 2)

    neighbor_score = (sum(contrast_scores) / len(contrast_scores)
                      if contrast_scores else 0.5)

    return (pos_score + neighbor_score) / 2
```

---

## Candidate Generation Heuristics

These heuristics guide initial candidate generation so most candidates are at least *plausible* before scoring.

### Shape palette selection

```python
def select_shape_palette(tiles_manifest, target_count=18):
    # Pick 3-5 "primary" shapes — each appears 3-5 times
    primary_shapes = random.sample(tiles_manifest, k=random.randint(3, 5))

    # Ensure mix of shape families
    families_present = set(s["shape_family"] for s in primary_shapes)
    if len(families_present) < 2:
        other_family = [t for t in tiles_manifest
                        if t["shape_family"] not in families_present]
        if other_family:
            primary_shapes[-1] = random.choice(other_family)

    # 1-2 "singleton" shapes for punctuation
    remaining = [t for t in tiles_manifest if t not in primary_shapes]
    singletons = random.sample(remaining, k=min(2, len(remaining)))

    return primary_shapes, singletons
```

### Grid filling order

Don't fill left-to-right, top-to-bottom. Instead:

1. Place the hero tile first (pick from `POWER_POSITIONS`).
2. Place 1–2 additional anchors at other power positions.
3. Fill the hero's row outward from the hero position.
4. Fill remaining rows from center outward.

This center-out approach naturally creates compositions that radiate from the focal point rather than drifting.

### Color assignment order

1. Assign hero tile's color first (almost always International Orange).
2. Assign anchor tile colors (high-contrast: Celestial Blue, Chrome Yellow).
3. Assign neutral bridge tiles between warm and cool zones.
4. Fill remaining from permitted palette, checking adjacency constraints.

---

## Edge Activity and Visual Continuity

This governs how tiles *connect* at shared edges — critical for compositions reading as cohesive fields rather than patchwork.

### The principle

When tile A's right edge has `edge_activity: true` (shape bleeds to the right boundary) and tile B (immediately right of A) has `edge_activity: true` on its left edge, the two shapes visually merge at the seam. This is desirable when:
- Both share the same color → shapes fuse into a larger form (very Swiss)
- Different colors → a hard color boundary reads as a deliberate cut

Undesirable when:
- Both have `edge_activity: false` on the shared edge → a gap of background separates them; fine for breathing room but bad if it happens everywhere

### Implementation

Track `edge_activity` for all four sides. When placing tile B right of tile A:
- Both active on shared side: assign same color for "fusion" (~30%) or contrasting for "cut" (~70%)
- One active, one not: no special rule; transition naturally reads as shape-meeting-ground
- Neither active: fine for negative space, but penalize if >25% of all shared edges are both-inactive

```python
def edge_continuity_bonus(tile_a, tile_b, shared_axis):
    if shared_axis == "horizontal":
        a_active = tile_a.edge_activity["right"]
        b_active = tile_b.edge_activity["left"]
    elif shared_axis == "vertical":
        a_active = tile_a.edge_activity["bottom"]
        b_active = tile_b.edge_activity["top"]

    if a_active and b_active:
        return 0.8  # strong visual continuity
    elif a_active or b_active:
        return 0.5  # natural transition
    else:
        return 0.2  # gap — okay in moderation
```

---

## Composition Templates (Optional Bootstrapping)

If pure generative scoring still produces too many mediocre results, pre-define 5–8 **composition templates** — abstract weight maps defining macro-structure without specifying tiles or colors. H = heavy, M = medium, L = light.

**"Diagonal sweep"**
```
L  L  M  H  M  L
L  M  H  M  L  L
M  H  M  L  L  L
```

**"Central burst"**
```
L  M  M  M  M  L
M  H  H  H  H  M
L  M  M  M  M  L
```

**"Corner anchor"**
```
H  H  M  L  L  L
H  M  L  L  L  M
M  L  L  L  M  H
```

**"Horizontal banding"**
```
H  H  H  H  H  H
L  L  L  L  L  L
M  M  M  M  M  M
```

**"Scattered focal"**
```
L  M  L  L  H  L
M  L  L  M  L  M
L  L  H  L  M  L
```

The generator randomly selects a template, then fills: heavy positions get high-weight tiles in accent colors, light positions get low-weight tiles in neutrals. Guarantees macro-structure while preserving variation.

---

## Tuning and Validation

### Visual validation against reference banners

After Phase 0 splits existing hand-made banners into `banners-raw/`, analyze them with the same scoring functions. Their scores establish the **target score range**. If generated banners consistently score below references on a particular axis, that axis needs recalibration.

```python
def validate_scoring(reference_banners, generated_banners):
    for axis in SCORING_AXES:
        ref_scores = [score(b, axis) for b in reference_banners]
        gen_scores = [score(b, axis) for b in generated_banners]
        print(f"{axis}: ref mean={mean(ref_scores):.2f}, "
              f"gen mean={mean(gen_scores):.2f}")
```

### Weight tuning

Start with suggested weights. Generate 200 candidates, score them, visually review top 20 and bottom 20. If top 20 look good, weights work. If good compositions appear mid-ranking, a scoring axis is miscalibrated. Iterate.

### Contact sheet annotation

The contact sheet should display each banner's total score and sub-scores alongside its thumbnail. Patterns become obvious: "all the ugly ones have low directional flow" tells you exactly what to fix.

---

*This document supplements the main handoff brief. The scoring system should be implemented in `scripts/generate_banner.py` as part of Phase 3.*
