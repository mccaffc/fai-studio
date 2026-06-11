#!/usr/bin/env python3
"""
fai_banner.py — FAI Bauhaus/Swiss banner generator (rebuild, June 2026).

This is the rebuilt generate-and-score pipeline. It implements the eight
scoring axes specified in FAI-Composition-Logic-Supplement.md faithfully:

    anchor-triangle, shape-repetition (rhythm), directional-flow,
    weight-balance, negative-space, color-temperature, shape-family-grouping,
    hero-tile

plus the supplement's candidate-generation heuristics (template weight maps,
centre-out filling, hero-first colouring) and a reference-banner calibration
hook (see scripts/fai_calibrate.py).

CLI-selectable COLOR MODES:
    full       all 7 ratified FAI fills (default)
    duotone    Cod Gray + International Orange + White
    vertical   Cod Gray + <a chosen vertical hex> + White   (--vertical-hex)
    extended   full palette + proposal accents via repeatable --extra-hex

Tiles are read from output/shapes-clean/<Family>/NN.svg (each tile = one
<rect> background + one <path> foreground on a 0 0 200 200 viewBox). Metadata,
including the new `dominant_direction`, comes from tiles-manifest-v2.json.

Typical use:
    DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib \
      $HOME/.cache/fai-deck-venv/bin/python scripts/fai_banner.py \
        --color-mode full --template diagonal_sweep --seed 7 \
        --png --out output/banners-rebuilt/demo

See BANNER-GENERATOR-REBUILD-NOTES.md for the full command catalogue.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SVG_NS = "http://www.w3.org/2000/svg"
BASE = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = BASE / "tiles-manifest-v2.json"
DEFAULT_TILES_DIR = BASE / "output" / "shapes-clean"
DEFAULT_OUTPUT_DIR = BASE / "output" / "banners-rebuilt"

GRID_COLS = 6
GRID_ROWS = 3
TOTAL_SLOTS = GRID_COLS * GRID_ROWS
TILE_VB = 200          # tile viewBox is 0 0 200 200
CELL = 320             # banner cell size in px (manifest: cell_size_in_banner)
CELL_SCALE = CELL / TILE_VB
ROTATIONS = (0, 90, 180, 270)

# The 7 ratified FAI fills (the ONLY permitted colours).
BRAND = {
    "international_orange": "#FF4F00",
    "cod_gray": "#121212",
    "white": "#FFFFFF",
    "smoke_white": "#F3F3F3",
    "chrome_yellow": "#FFA300",
    "celestial_blue": "#4997D0",
    "timberwolf": "#D9D9D6",
}
HEX = {k: v for k, v in BRAND.items()}

COLOR_TEMPERATURE = {
    "#FF4F00": "warm",
    "#FFA300": "warm",
    "#4997D0": "cool",
    "#D9D9D6": "cool",
    "#121212": "neutral",
    "#FFFFFF": "neutral",
    "#F3F3F3": "neutral",
}

# Colour contrast / "impact" used for anchor + hero detection. Orange and blue
# are the loudest; the grays recede.
COLOR_CONTRAST = {
    "#FF4F00": 1.00,
    "#4997D0": 0.92,
    "#FFA300": 0.85,
    "#121212": 0.78,
    "#D9D9D6": 0.42,
    "#F3F3F3": 0.18,
    "#FFFFFF": 0.12,
}

# Rule-of-thirds power positions on the 6x3 grid, as (col, row).
POWER_POSITIONS = {(1, 0), (4, 0), (3, 1), (0, 2), (5, 2)}

# Scoring weights — tuned June 2026. Negative space now has enough influence
# to select poster-like breathing room instead of fill-every-cell quilts.
SCORING_WEIGHTS = {
    "anchor": 0.10,
    "rhythm": 0.15,
    "direction": 0.15,
    "weight": 0.12,
    "negative": 0.18,
    "temperature": 0.10,
    "family": 0.10,
    "hero": 0.10,
    "template": 0.10,
    "symmetry": 0.14,
}

# Directional-flow compatibility lookup (A left of B). Filled out from the
# supplement's table + symmetric completion.
HORIZONTAL_FLOW = {
    ("right", "right"): 0.9,
    ("left", "left"): 0.9,
    ("right", "left"): 0.5,    # meeting across the seam
    ("left", "right"): 0.2,    # backs to each other / diverging
    ("right", "center"): 0.85,
    ("left", "center"): 0.6,
    ("center", "left"): 0.85,
    ("center", "right"): 0.6,
    ("right", "neutral"): 0.7,
    ("neutral", "left"): 0.7,
    ("left", "neutral"): 0.55,
    ("neutral", "right"): 0.55,
    ("right", "outward"): 0.75,
    ("outward", "left"): 0.75,
    ("center", "center"): 0.7,
    ("outward", "outward"): 0.6,
    ("center", "outward"): 0.45,
    ("outward", "center"): 0.45,
    ("neutral", "neutral"): 0.6,
    ("neutral", "center"): 0.65,
    ("center", "neutral"): 0.65,
    ("neutral", "outward"): 0.55,
    ("outward", "neutral"): 0.55,
}
# Vertical adjacency (A above B) uses up/down with the same shape of table.
VERTICAL_FLOW = {
    ("down", "down"): 0.9,
    ("up", "up"): 0.9,
    ("down", "up"): 0.5,
    ("up", "down"): 0.2,
    ("down", "center"): 0.85,
    ("up", "center"): 0.6,
    ("center", "up"): 0.85,
    ("center", "down"): 0.6,
    ("down", "neutral"): 0.7,
    ("neutral", "up"): 0.7,
    ("up", "neutral"): 0.55,
    ("neutral", "down"): 0.55,
    ("down", "outward"): 0.75,
    ("outward", "up"): 0.75,
    ("center", "center"): 0.7,
    ("outward", "outward"): 0.6,
    ("center", "outward"): 0.45,
    ("outward", "center"): 0.45,
    ("neutral", "neutral"): 0.6,
    ("neutral", "center"): 0.65,
    ("center", "neutral"): 0.65,
    ("neutral", "outward"): 0.55,
    ("outward", "neutral"): 0.55,
}

# Map a direction onto the relevant axis (horizontal table keys are
# left/right; vertical keys are up/down). Cross-axis directions fall back to
# a neutral-equivalent so the lookup always resolves.
H_ALIASES = {"up": "neutral", "down": "neutral"}
V_ALIASES = {"left": "neutral", "right": "neutral"}

# ---------------------------------------------------------------------------
# Composition grammar templates.
# ---------------------------------------------------------------------------
WEIGHT_LEVEL = {"H": 0.85, "M": 0.50, "L": 0.18, "E": 0.0}

TEMPLATES: dict[str, list[list[str]]] = {
    # Loose macro-intent maps. Structure is SAMPLED at generation time, so these
    # are advisory for the fidelity axis, not skeletons to refill.
    "monument": [list("LHHHHL"), list("EMHHME"), list("LLLLLL")],
    "mirror_monument": [list("LHHHHL"), list("EMHHME"), list("LLLLLL")],  # legacy alias
    "frieze_stack": [list("MMMMMM"), list("EEEEEE"), list("MMMMMM")],
    "ring_field": [list("EHHHHE"), list("EHHHHE"), list("LLLLEE")],
    "field_split": [list("LLHHLL"), list("MMHHMM"), list("LLHHLL")],
    "eye_row": [list("EEEEEE"), list("MMMMMM"), list("HHHHHH")],
    "asymmetric_field": [list("HHHMLE"), list("HHHMME"), list("HHHLEE")],
    "mini_frieze": [list("MMM")],
    "mini_panel": [list("HH"), list("MM"), list("HH")],
}

# Banner archetypes (full-canvas grammar layouts). These — and ONLY these — are
# eligible for banner generation; mini_* layouts are deck-art compositions
# available through compose() but never produce partial-fill "banners".
BANNER_TEMPLATES = [
    "monument",
    "frieze_stack",
    "ring_field",
    "field_split",
    "eye_row",
    "asymmetric_field",
]
DECK_LAYOUTS = ["mini_frieze", "mini_panel"]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------
@dataclass
class Tile:
    """A manifest tile enriched with calibrated, render-ready geometry."""

    id: str
    filename: str
    family: str
    direction: str
    area_weight: float          # calibrated 0..1 (raster fill, solid=1.0)
    symmetry: str
    complexity: str
    edge_coverage: dict
    edge_type: dict = field(default_factory=dict)


@dataclass
class Cell:
    col: int
    row: int
    tile: Optional[Tile]
    rotation: int
    fg: str                     # hex
    bg: str                     # hex
    level: str = "M"
    span_w: int = 1
    span_h: int = 1
    empty: bool = False
    covered_by: Optional[tuple[int, int]] = None
    hero: bool = False
    flip_x: bool = False

    @property
    def pos(self) -> tuple[int, int]:
        return (self.col, self.row)

    @property
    def visual_weight(self) -> float:
        if self.empty or self.covered_by is not None or self.tile is None:
            return 0.0
        """Calibrated visual weight = area * colour contrast against bg.

        A dark shape on a light ground carries more weight than a light shape;
        a near-invisible shape (fg≈bg) carries almost none. This is the value
        the supplement's hero/negative-space/anchor thresholds expect.
        """
        contrast = abs(COLOR_CONTRAST[self.fg] - COLOR_CONTRAST[self.bg])
        # Blend pure area (so big shapes still count) with contrast-weighted
        # area (so invisible shapes don't).
        span_boost = min(1.35, 1.0 + 0.12 * (self.span_w * self.span_h - 1))
        return min(1.0, self.tile.area_weight * (0.45 + 0.55 * contrast) * span_boost)


@dataclass
class Banner:
    cells: list[Cell]
    template: str
    color_mode: str
    seed: int
    scores: dict = field(default_factory=dict)
    ground: Optional[str] = "#121212"
    ground_fields: list[tuple[float, float, float, float, str]] = field(default_factory=list)
    cell_px: int = CELL

    @property
    def total(self) -> float:
        return self.scores.get("total", 0.0)

    def by_pos(self) -> dict[tuple[int, int], Cell]:
        return {c.pos: c for c in self.cells}


# ---------------------------------------------------------------------------
# Manifest loading + calibrated tiles
# ---------------------------------------------------------------------------
def load_tiles(manifest_path: Path) -> tuple[list[Tile], dict]:
    manifest = json.loads(manifest_path.read_text())
    raw = manifest["tiles"]

    # Calibrate area weight: use raster_fill (true coverage, solid=1.0) if
    # present, else fall back to the manifest visual_weight rescaled.
    have_raster = any("raster_fill" in t for t in raw)
    tiles: list[Tile] = []
    for t in raw:
        if t.get("renderable") is False:
            continue
        if "dominant_direction" not in t:
            # manifest not yet processed — degrade gracefully
            direction = "neutral"
        else:
            direction = t["dominant_direction"]
        if have_raster and "raster_fill" in t:
            area = float(t["raster_fill"])
        else:
            # legacy weights top out near 0.43; stretch to 0..1.
            area = min(1.0, float(t.get("visual_weight", 0.2)) / 0.43)
        tiles.append(
            Tile(
                id=t["id"],
                filename=t["filename"],
                family=t["shape_family"],
                direction=direction,
                area_weight=area,
                symmetry=t.get("symmetry", "none"),
                complexity=t.get("complexity", "simple"),
                edge_coverage=t.get("edge_coverage", {}),
                edge_type=t.get("edge_type", {}),
            )
        )
    return tiles, manifest


# ---------------------------------------------------------------------------
# Colour modes / palettes
# ---------------------------------------------------------------------------
def _register_extra_hex(hexv: str) -> str:
    v = hexv.upper()
    if not re_hex(v):
        raise ValueError(f"invalid hex colour: {hexv}")
    if v not in COLOR_TEMPERATURE:
        r, g, b = int(v[1:3], 16), int(v[3:5], 16), int(v[5:7], 16)
        import colorsys
        hue = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)[0] * 360
        COLOR_TEMPERATURE[v] = "warm" if (hue <= 95 or hue >= 325) else "cool"
        # Saturated proposal accents should have anchor/hero impact, but not
        # automatically outrank International Orange.
        COLOR_CONTRAST.setdefault(v, 0.88)
    return v


def re_hex(hexv: str) -> bool:
    return isinstance(hexv, str) and len(hexv) == 7 and hexv[0] == "#" and all(c in "0123456789ABCDEFabcdef" for c in hexv[1:])


def build_palette(color_mode: str, vertical_hex: Optional[str], extra_hexes: Optional[list[str]] = None) -> dict:
    """Return the colour set for a mode plus role hints.

    Roles: ground (background fills), accent (loud foreground), bridge
    (neutral connectors). All hexes are uppercase ratified FAI fills, with the
    single exception of the *vertical* mode whose middle colour is supplied by
    the caller (validated to be one of the 7 fills upstream).
    """
    cg, wh, sw, tw = "#121212", "#FFFFFF", "#F3F3F3", "#D9D9D6"
    org, yel, blu = "#FF4F00", "#FFA300", "#4997D0"

    if color_mode == "full":
        return {
            "fills": [cg, wh, sw, tw, org, yel, blu],
            "accents": [org, blu, yel],
            "grounds": [sw, wh, tw, cg],
            "bridges": [tw, sw, wh, cg],
            "hero": org,
        }
    if color_mode == "duotone":
        return {
            "fills": [cg, org, wh],
            "accents": [org],
            "grounds": [wh, cg],
            "bridges": [wh, cg],
            "hero": org,
        }
    if color_mode == "vertical":
        v = (vertical_hex or org).upper()
        # Unratified demo hexes (--allow-unratified-hex) aren't in the lookup
        # tables; register them so scoring works. Hue ≤90° or ≥330° reads warm.
        _register_extra_hex(v)
        return {
            "fills": [cg, v, wh],
            "accents": [v],
            "grounds": [wh, cg],
            "bridges": [wh, cg],
            "hero": v,
        }
    if color_mode == "extended":
        extras = [_register_extra_hex(h) for h in (extra_hexes or [])]
        fills = [cg, wh, sw, tw, org, yel, blu] + extras
        accents = [org, blu, yel] + extras
        # The caller's chosen accent (the studio's ACCENT control / --vertical-hex)
        # is the GUARANTEED hero in extended mode — it must appear in a real run.
        chosen = _register_extra_hex(vertical_hex) if vertical_hex else None
        if chosen and chosen not in accents:
            accents.insert(0, chosen)
        return {
            "fills": fills,
            "accents": accents,
            "grounds": [sw, wh, tw, cg],
            "bridges": [tw, sw, wh, cg],
            "hero": chosen,
        }
    raise ValueError(f"unknown color_mode: {color_mode}")


# ---------------------------------------------------------------------------
# Candidate generation
# ---------------------------------------------------------------------------
def select_shape_palette(tiles: list[Tile], rng: random.Random) -> list[Tile]:
    """Pick 3-5 primary shapes + 1-2 singletons, ensuring >=2 families.

    Follows the supplement's select_shape_palette heuristic.
    """
    by_family: dict[str, list[Tile]] = {}
    for t in tiles:
        by_family.setdefault(t.family, []).append(t)
    families = list(by_family)

    n_primary = rng.randint(3, 5)
    primary: list[Tile] = []
    chosen_families: list[str] = []
    # Bias toward variety: draw primaries from distinct families where possible.
    rng.shuffle(families)
    for fam in families:
        if len(primary) >= n_primary:
            break
        primary.append(rng.choice(by_family[fam]))
        chosen_families.append(fam)
    while len(primary) < n_primary:
        primary.append(rng.choice(tiles))

    # Ensure a family mix (>=2 families).
    if len(set(t.family for t in primary)) < 2 and len(families) >= 2:
        other = [t for t in tiles if t.family not in {p.family for p in primary}]
        if other:
            primary[-1] = rng.choice(other)

    remaining = [t for t in tiles if t.id not in {p.id for p in primary}]
    n_singletons = min(rng.randint(1, 2), len(remaining))
    singletons = rng.sample(remaining, n_singletons) if remaining else []
    return primary + singletons


def tile_for_weight_level(
    level: str,
    primary: list[Tile],
    rng: random.Random,
) -> Tile:
    """Pick a palette tile whose area roughly matches the template level."""
    target = WEIGHT_LEVEL[level]
    # Score each candidate by closeness to the target weight, with jitter so we
    # don't always pick the same tile for a level.
    scored = sorted(
        primary,
        key=lambda t: abs(t.area_weight - target) + rng.uniform(0, 0.18),
    )
    return scored[0]


def rotate_direction(direction: str, rotation: int) -> str:
    if direction not in {"left", "right", "up", "down"}:
        return direction
    order = ["up", "right", "down", "left"]
    return order[(order.index(direction) + (rotation // 90) % 4) % 4]


def span_cells(pos: tuple[int, int], span_w: int, span_h: int) -> set[tuple[int, int]]:
    c0, r0 = pos
    return {(c0 + dc, r0 + dr) for dr in range(span_h) for dc in range(span_w)}


def choose_hero_span(weight_map, hero_pos, rng) -> tuple[int, int, tuple[int, int]]:
    if hero_pos is None:
        return 1, 1, (0, 0)
    candidates: list[tuple[float, int, int, tuple[int, int]]] = []
    for sw, sh, bonus in [(2, 2, 1.0), (2, 1, 0.72), (1, 2, 0.72)]:
        for c0 in range(max(0, hero_pos[0] - sw + 1), min(hero_pos[0], GRID_COLS - sw) + 1):
            for r0 in range(max(0, hero_pos[1] - sh + 1), min(hero_pos[1], GRID_ROWS - sh) + 1):
                cells = span_cells((c0, r0), sw, sh)
                if hero_pos not in cells or any(weight_map[r][c] == "E" for c, r in cells):
                    continue
                levels = [weight_map[r][c] for c, r in cells]
                score = bonus + 0.2 * levels.count("H") + 0.05 * levels.count("M") + rng.uniform(0, 0.08)
                candidates.append((score, sw, sh, (c0, r0)))
    if not candidates:
        return 1, 1, hero_pos
    _, sw, sh, top_left = max(candidates, key=lambda x: x[0])
    return sw, sh, top_left


def generate_candidate(
    tiles: list[Tile],
    template_name: str,
    palette: dict,
    color_mode: str,
    rng: random.Random,
) -> list[Cell]:
    """Build one full 18-cell candidate following the centre-out heuristics."""
    weight_map = TEMPLATES[template_name]
    shape_palette = select_shape_palette(tiles, rng)
    banner_bg = palette.get("banner_bg", "#FFFFFF")

    # --- placement: choose a tile per cell by template weight level ---------
    placement: dict[tuple[int, int], tuple[Tile, int]] = {}
    # Hero first: heaviest cell in a power position if the template has one.
    heavy_cells = [
        (c, r)
        for r in range(GRID_ROWS)
        for c in range(GRID_COLS)
        if weight_map[r][c] == "H"
    ]
    hero_pos = None
    power_heavy = [p for p in heavy_cells if p in POWER_POSITIONS]
    if power_heavy:
        hero_pos = rng.choice(power_heavy)
    elif heavy_cells:
        hero_pos = rng.choice(heavy_cells)

    hero_span_w, hero_span_h, hero_top_left = choose_hero_span(weight_map, hero_pos, rng)
    hero_covered = span_cells(hero_top_left, hero_span_w, hero_span_h) if hero_pos is not None else set()

    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            pos = (c, r)
            level = weight_map[r][c]
            if level == "E" or pos in hero_covered:
                continue
            tile = tile_for_weight_level(level, shape_palette, rng)
            rot = rng.choice(ROTATIONS)
            placement[pos] = (tile, rot)

    if hero_pos is not None:
        heavy_pool = sorted(shape_palette, key=lambda t: t.area_weight, reverse=True)[: max(2, len(shape_palette) // 2)]
        placement[hero_top_left] = (rng.choice(heavy_pool), rng.choice(ROTATIONS))

    # --- colour assignment: hero -> accents -> bridges -> fill --------------
    fg: dict[tuple[int, int], str] = {}
    bg: dict[tuple[int, int], str] = {}

    accents = palette["accents"]
    grounds = palette["grounds"]
    fills = palette["fills"]
    hero_color = palette["hero"] or rng.choice(accents)

    # Decide a warm/cool zoning axis for the full palette (left-warm or
    # right-warm), so temperature clusters instead of salt-and-peppering.
    # Align the warm zone with the hero column so the loudest tile anchors the
    # warm cluster instead of fighting it (this lifted the temperature axis to
    # match the reference banners during calibration).
    if hero_pos is not None:
        warm_left = hero_top_left[0] < 3
    else:
        warm_left = rng.random() < 0.5

    warm_accents = [a for a in accents if COLOR_TEMPERATURE[a] == "warm"] or accents
    cool_accents = [a for a in accents if COLOR_TEMPERATURE[a] == "cool"] or accents

    def zone_pref(col: int) -> str:
        if color_mode not in {"full", "extended"}:
            return "neutral"
        warm_side = col < 3 if warm_left else col >= 3
        return "warm" if warm_side else "cool"

    order = [p for p in placement_order(weight_map, hero_top_left) if p in placement]
    for pos in order:
        c, r = pos
        level = weight_map[r][c]
        zone = zone_pref(c)

        if pos == hero_top_left:
            chosen = hero_color
        elif level == "H":
            # heavy accents respect the temperature zone in full mode
            if color_mode in {"full", "extended"}:
                pool = warm_accents if zone == "warm" else cool_accents
                chosen = rng.choice(pool)
            else:
                chosen = rng.choice(accents)
        elif level == "L":
            # light cells lean neutral/ground for breathing room
            chosen = weighted_color_choice(fills, zone, prefer_neutral=True, rng=rng)
        else:
            chosen = weighted_color_choice(fills, zone, prefer_neutral=False, rng=rng)

        # soft adjacency: avoid identical fg to an already-placed neighbour
        chosen = avoid_neighbor_clash(chosen, pos, fg, fills, rng)
        fg[pos] = chosen

        # background: a ground colour distinct from fg, contrast-aware
        bg[pos] = choose_background(chosen, grounds, rng)

    cells = []
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            pos = (c, r)
            level = weight_map[r][c]
            if level == "E":
                cells.append(Cell(col=c, row=r, tile=None, rotation=0, fg=banner_bg, bg=banner_bg, level="E", empty=True))
            elif pos in hero_covered and pos != hero_top_left:
                cells.append(Cell(col=c, row=r, tile=None, rotation=0, fg=banner_bg, bg=banner_bg, level=level, covered_by=hero_top_left))
            else:
                tile, rot = placement[pos]
                cells.append(
                    Cell(
                        col=c,
                        row=r,
                        tile=tile,
                        rotation=rot,
                        fg=fg[pos],
                        bg=bg[pos],
                        level=level,
                        span_w=hero_span_w if pos == hero_top_left else 1,
                        span_h=hero_span_h if pos == hero_top_left else 1,
                        hero=pos == hero_top_left,
                    )
                )
    return cells


def placement_order(weight_map, hero_pos) -> list[tuple[int, int]]:
    """Centre-out order, hero first (supplement's grid-filling order)."""
    cells = [(c, r) for r in range(GRID_ROWS) for c in range(GRID_COLS)]
    cx, cy = 2.5, 1.0
    cells.sort(key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    if hero_pos and hero_pos in cells:
        cells.remove(hero_pos)
        cells.insert(0, hero_pos)
    return cells


def weighted_color_choice(fills, zone, prefer_neutral, rng) -> str:
    def w(hexv: str) -> float:
        temp = COLOR_TEMPERATURE[hexv]
        base = 1.0
        if prefer_neutral:
            base = 2.2 if temp == "neutral" else 0.9
        if zone != "neutral" and temp == zone:
            base *= 3.6
        elif zone != "neutral" and temp != "neutral" and temp != zone:
            # strongly discourage a cool tile in the warm zone (and vice versa)
            base *= 0.08
        return base

    weights = [w(h) for h in fills]
    return rng.choices(fills, weights=weights, k=1)[0]


def avoid_neighbor_clash(chosen, pos, fg, fills, rng) -> str:
    c, r = pos
    neigh = [(c - 1, r), (c + 1, r), (c, r - 1), (c, r + 1)]
    clash = {fg[n] for n in neigh if n in fg}
    if chosen not in clash:
        return chosen
    alts = [f for f in fills if f not in clash]
    return rng.choice(alts) if alts else chosen


def choose_background(fg, grounds, rng) -> str:
    alts = [g for g in grounds if g != fg]
    if not alts:
        return grounds[0]
    # prefer the ground with the most contrast against the foreground
    alts.sort(key=lambda g: -abs(COLOR_CONTRAST[g] - COLOR_CONTRAST[fg]))
    # mild randomness between the top two
    top = alts[: min(2, len(alts))]
    return rng.choice(top)


# ---------------------------------------------------------------------------
# Grammar candidate generation
# ---------------------------------------------------------------------------
SUPERFORM_FAMILIES = {"lines", "centric", "curve", "circle"}
MINI_FAMILIES = {"angle", "ramp", "square"}


def _rel_lum(hexv: str) -> float:
    r, g, b = (int(hexv.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4  # noqa: E731
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def _contrast(a: str, b: str) -> float:
    l1, l2 = sorted((_rel_lum(a), _rel_lum(b)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


# Minimum shape-on-ground contrast. Encodes ink legality generically (so any
# registered proposal hue works on the grounds where it actually reads — e.g.
# Slate Indigo passes on White but not on Cod Gray, matching its usage rule).
CONTRAST_MIN = 2.4


def ink_legal(ink: str, ground: str) -> bool:
    return ink.upper() != ground.upper() and _contrast(ink, ground) >= CONTRAST_MIN


def primary_ink(ground: str) -> str:
    """The references' workhorse ink: White on dark grounds, Cod Gray on light."""
    return "#FFFFFF" if _rel_lum(ground) < 0.4 else "#121212"


def sample_ground_plan(color_mode: str, rng: random.Random) -> dict:
    """One shared ground — Cod Gray dominant, White sometimes, split rarely."""
    r = rng.random()
    if r < 0.62:
        return {"base": "#121212", "fields": [], "split_col": None}
    if r < 0.84:
        return {"base": "#FFFFFF", "fields": [], "split_col": None}
    split_col = rng.choice([2, 3, 4])
    g1, g2 = rng.choice([("#121212", "#FFFFFF"), ("#FFFFFF", "#121212")])
    frac = split_col / GRID_COLS
    return {"base": g1, "fields": [(frac, 0.0, 1 - frac, 1.0, g2)], "split_col": split_col}


def ground_at(plan: dict, col: int) -> str:
    sc = plan.get("split_col")
    if sc is not None and col >= sc:
        return plan["fields"][0][4]
    return plan["base"]


def run_inks(palette: dict, color_mode: str, rng: random.Random) -> dict:
    """Pick the banner's accent run inks. The caller's chosen accent (palette
    'hero') is GUARANTEED to be the primary accent when provided."""
    accents = palette["accents"]
    chosen = palette.get("hero")
    if color_mode in {"duotone", "vertical"}:
        accent = accents[0]
    elif chosen:
        accent = chosen
    else:
        accent = rng.choice(accents)
    others = [a for a in accents if a != accent]
    use_second = color_mode in {"full", "extended"} and others and rng.random() < 0.7
    second = rng.choice(others) if use_second else accent
    return {"accent": accent, "accent2": second}


def family_tiles(tiles: list[Tile], families: set[str]) -> list[Tile]:
    pool = [t for t in tiles if t.family.lower() in families]
    return pool or tiles


def edge_rich_tiles(tiles: list[Tile], families: set[str]) -> list[Tile]:
    pool = family_tiles(tiles, families)
    rich = [
        t for t in pool
        if sum(1 for v in t.edge_coverage.values() if float(v or 0) > 0.45) >= 1
        or sum(1 for v in t.edge_type.values() if v) >= 1
    ]
    return rich or pool


def grammar_tile_pool(tiles: list[Tile], families: set[str], min_area: float = 0.42, max_area: float = 0.78) -> list[Tile]:
    """Tiles dense enough for canonical ink coverage without becoming slabs."""
    pool = edge_rich_tiles(tiles, families) if families & SUPERFORM_FAMILIES else family_tiles(tiles, families)
    bounded = [t for t in pool if min_area <= t.area_weight <= max_area]
    if bounded:
        return bounded
    dense = [t for t in pool if t.area_weight >= min_area]
    return dense or pool


def add_cell(cells: list[Cell], col: int, row: int, tile: Tile, rot: int, ink: str, ground: str,
             level: str = "M", hero: bool = False, flip_x: bool = False) -> None:
    cells.append(Cell(col=col, row=row, tile=tile, rotation=rot % 360, fg=ink, bg=ground, level=level, hero=hero, flip_x=flip_x))


def add_frieze(cells: list[Cell], cols: range, row: int, tile: Tile, rhythm: str, ink: str, ground: str) -> None:
    for i, col in enumerate(cols):
        rot = 0
        flip = False
        if rhythm == "alternating_rotation":
            rot = 180 if i % 2 else 0
        elif rhythm == "mirror_pair":
            flip = bool(i % 2)
        add_cell(cells, col, row, tile, rot, ink, ground, level="M", flip_x=flip)


def add_superform(cells: list[Cell], region: tuple[int, int, int, int], tile: Tile, ink: str, ground: str,
                  rng: random.Random, mirror: bool = False) -> None:
    c0, r0, w, h = region
    rotations = [0, 90, 180, 270]
    for rr in range(h):
        for cc in range(w):
            col, row = c0 + cc, r0 + rr
            # Quarter-turn rhythm makes edge-touching arc/line tiles read as a connected field.
            rot = rotations[(cc + rr) % 4]
            flip = mirror and col >= GRID_COLS / 2
            add_cell(cells, col, row, tile, rot, ink, ground, level="H", hero=(cc == w // 2 and rr == h // 2), flip_x=flip)


def add_punctuation(cells: list[Cell], occupied: set[tuple[int, int]], tiles: list[Tile], n: int, ink: str, ground: str,
                    rng: random.Random, cols=GRID_COLS, rows=GRID_ROWS) -> None:
    pool = sorted(tiles, key=lambda t: t.area_weight)[: max(4, len(tiles) // 4)]
    positions = [(c, r) for c, r in POWER_POSITIONS if c < cols and r < rows and (c, r) not in occupied]
    rng.shuffle(positions)
    for col, row in positions[:n]:
        add_cell(cells, col, row, rng.choice(pool), rng.choice(ROTATIONS), ink, ground, level="L")
        occupied.add((col, row))


def generate_candidate(
    tiles: list[Tile],
    template_name: str,
    palette: dict,
    color_mode: str,
    rng: random.Random,
) -> list[Cell]:
    """Build a grammar-valid candidate. STRUCTURE IS SAMPLED per candidate —
    region sizes/positions, row choices, extents, rhythms, grounds, and ink
    placement all vary — so candidates explore a wide compositional space
    instead of refilling one frozen skeleton."""
    if template_name == "field_split":
        split_col = rng.choice([2, 3, 4])
        g1, g2 = rng.choice([("#121212", "#FFFFFF"), ("#FFFFFF", "#121212")])
        plan = {"base": g1, "fields": [(split_col / GRID_COLS, 0.0, 1 - split_col / GRID_COLS, 1.0, g2)],
                "split_col": split_col}
    elif template_name in {"mini_frieze", "mini_panel"}:
        plan = {"base": "#121212", "fields": [], "split_col": None}
    else:
        plan = sample_ground_plan(color_mode, rng)
        plan["split_col"] = None
        plan["fields"] = []
    inks = run_inks(palette, color_mode, rng)
    cells: list[Cell] = []
    occupied: set[tuple[int, int]] = set()

    FRIEZE_FAMS = {"float", "joint", "open", "circle", "wave"}
    ANGULAR_FAMS = {"angle", "ramp", "square", "rectangle"}

    def g(col: int) -> str:
        return ground_at(plan, col)

    def run_ink(cols, prefer: str) -> Optional[str]:
        """Ink for a run spanning `cols`: must be legal on every ground crossed."""
        grounds = {g(c) for c in cols}
        order = {
            "accent": [inks["accent"], inks["accent2"], primary_ink(next(iter(grounds)))],
            "primary": [primary_ink(next(iter(grounds))), inks["accent"], inks["accent2"]],
            "accent2": [inks["accent2"], inks["accent"], primary_ink(next(iter(grounds)))],
        }[prefer]
        for ink in order:
            if all(ink_legal(ink, gr) for gr in grounds):
                return ink
        return None

    def frieze(cols, row, pool_fams, prefer, min_a=0.36, max_a=0.72, rhythm=None):
        ink = run_ink(cols, prefer)
        if ink is None:
            return
        tile = rng.choice(grammar_tile_pool(tiles, pool_fams, min_a, max_a))
        rhy = rhythm or rng.choice(["identical", "alternating_rotation", "mirror_pair"])
        # per-cell ground so split plans stay legal
        for i, col in enumerate(cols):
            rot = 180 if (rhy == "alternating_rotation" and i % 2) else 0
            flip = bool(i % 2) if rhy == "mirror_pair" else False
            add_cell(cells, col, row, tile, rot, ink, g(col), level="M", flip_x=flip)

    def superform(region, prefer="primary", mirror=True):
        c0, r0, w, h = region
        cols = range(c0, c0 + w)
        ink = run_ink(cols, prefer)
        if ink is None:
            return
        tile = rng.choice(grammar_tile_pool(tiles, SUPERFORM_FAMILIES, 0.46, 0.74))
        rotations = [0, 90, 180, 270]
        for rr in range(h):
            for cc in range(w):
                col, row = c0 + cc, r0 + rr
                rot = rotations[(cc + rr) % 4]
                flip = mirror and cc >= w / 2
                add_cell(cells, col, row, tile, rot, ink, g(col), level="H",
                         hero=(cc == w // 2 and rr == h // 2), flip_x=flip)

    def mark():
        occupied.update((c.col, c.row) for c in cells)

    def flank_pair(c0, w, rows_free):
        """Treat the zones left/right of a centered region: mirrored friezes,
        independent friezes, or deliberate emptiness — sampled per row."""
        left, right = range(0, c0), range(c0 + w, GRID_COLS)
        if not left or not right:
            return
        mirror_sides = rng.random() < 0.6
        for row in rows_free:
            r = rng.random()
            if r < 0.42:
                continue  # negative space
            prefer = "accent" if rng.random() < 0.45 else "primary"
            fams = rng.choice([FRIEZE_FAMS, ANGULAR_FAMS, {"lines", "centric"}])
            if mirror_sides:
                tile = rng.choice(grammar_tile_pool(tiles, fams, 0.36, 0.70))
                ink_l = run_ink(left, prefer)
                ink_r = run_ink(right, prefer)
                for i, col in enumerate(left):
                    add_cell(cells, col, row, tile, 0, ink_l or primary_ink(g(col)), g(col), flip_x=bool(i % 2))
                for i, col in enumerate(right):
                    add_cell(cells, col, row, tile, 0, ink_r or primary_ink(g(col)), g(col), flip_x=not bool(i % 2))
            else:
                frieze(left, row, fams, prefer)
                frieze(right, row, rng.choice([FRIEZE_FAMS, ANGULAR_FAMS]), "primary")

    if template_name in {"monument", "mirror_monument"}:
        w = rng.choice([2, 2, 3])
        h = rng.choice([2, 3])
        c0 = rng.choice([c for c in range(0, GRID_COLS - w + 1)][1:-1] or [2])
        r0 = 0 if h == 3 else rng.choice([0, 1])
        superform((c0, r0, w, h), prefer="accent" if rng.random() < 0.3 else "primary", mirror=True)
        rows_free = [r for r in range(GRID_ROWS)]
        flank_pair(c0, w, rows_free)
    elif template_name == "frieze_stack":
        accent_row = rng.randrange(GRID_ROWS)
        extents = [(0, 6), (1, 5), (0, 4), (2, 6), (0, 3), (3, 6)]
        made = 0
        for row in range(GRID_ROWS):
            if row != accent_row and rng.random() < 0.22 and made >= 1:
                continue
            e0, e1 = rng.choice(extents)
            fams = rng.choice([FRIEZE_FAMS, ANGULAR_FAMS, {"lines", "centric"}, {"circle", "curve"}])
            frieze(range(e0, e1), row, fams, "accent" if row == accent_row else
                   ("accent2" if rng.random() < 0.2 else "primary"))
            made += 1
    elif template_name == "ring_field":
        w = rng.choice([3, 4])
        r0 = rng.choice([0, 1])
        c0 = rng.randint(0, GRID_COLS - w)
        superform((c0, r0, w, 2), prefer="primary")
        other_row = 2 if r0 == 0 else 0
        if rng.random() < 0.8:
            e0, e1 = rng.choice([(0, 6), (0, 4), (2, 6), (1, 5)])
            frieze(range(e0, e1), other_row, FRIEZE_FAMS, "accent")
    elif template_name == "field_split":
        sc = plan["split_col"]
        left, right = range(0, sc), range(sc, GRID_COLS)
        big, small = (left, right) if rng.random() < 0.5 else (right, left)
        if len(big) >= 2:
            superform((big[0], 0, min(len(big), 3), rng.choice([2, 3])),
                      prefer="primary", mirror=True)
        for row in range(GRID_ROWS):
            if rng.random() < 0.55:
                frieze(small, row, rng.choice([FRIEZE_FAMS, ANGULAR_FAMS]),
                       "accent" if rng.random() < 0.5 else "primary")
    elif template_name == "eye_row":
        row = rng.randrange(GRID_ROWS)
        e0, e1 = rng.choice([(0, 6), (1, 5)])
        frieze(range(e0, e1), row, {"open", "float", "joint", "circle"}, "primary",
               rhythm="mirror_pair")
        others = [r for r in range(GRID_ROWS) if r != row]
        rng.shuffle(others)
        frieze(range(*rng.choice([(0, 6), (1, 5), (0, 4), (2, 6)])), others[0],
               ANGULAR_FAMS, "accent", rhythm=rng.choice(["identical", "alternating_rotation"]))
        if rng.random() < 0.8:  # third row keeps the composition full-canvas
            frieze(range(*rng.choice([(0, 6), (1, 5), (2, 6)])), others[1],
                   rng.choice([FRIEZE_FAMS, {"lines", "centric"}]), "primary")
    elif template_name == "asymmetric_field":
        w, h = 3, rng.choice([2, 3])
        on_left = rng.random() < 0.5
        c0 = 0 if on_left else GRID_COLS - w
        superform((c0, 0 if h == 3 else rng.choice([0, 1]), w, h),
                  prefer="accent" if rng.random() < 0.35 else "primary", mirror=rng.random() < 0.5)
        opp = range(w, GRID_COLS) if on_left else range(0, GRID_COLS - w)
        for row in rng.sample(range(GRID_ROWS), k=rng.choice([1, 2])):
            frieze(opp, row, rng.choice([FRIEZE_FAMS, ANGULAR_FAMS, {"lines", "centric"}]),
                   "accent" if rng.random() < 0.5 else "primary")
    elif template_name == "mini_frieze":
        tile = rng.choice(family_tiles(tiles, MINI_FAMILIES))
        rhy = rng.choice(["identical", "alternating_rotation", "mirror_pair"])
        for i, col in enumerate(range(0, 3)):
            rot = 180 if (rhy == "alternating_rotation" and i % 2) else 0
            add_cell(cells, col, 0, tile, rot, inks["accent"], plan["base"], level="M",
                     flip_x=bool(i % 2) if rhy == "mirror_pair" else False)
    elif template_name == "mini_panel":
        superform((0, 0, 2, 3), prefer="primary", mirror=True)
    else:
        superform((1, 0, 4, 2), prefer="primary", mirror=True)

    mark()
    if template_name not in {"mini_frieze", "mini_panel"}:
        punct_ink = inks["accent2"] if ink_legal(inks["accent2"], plan["base"]) else None
        if punct_ink:
            add_punctuation(cells, occupied, tiles, rng.randint(0, 2), punct_ink, plan["base"], rng)
    cells_plan = plan
    generate_candidate.last_plan = cells_plan  # consumed by callers to set Banner ground
    return cells


def grammar_stats(banner: Banner) -> dict:
    """Structural QA metrics for the grammar-first generator."""
    active = active_cells(banner.cells)
    ink_area = sum(c.tile.area_weight for c in active if c.tile) / TOTAL_SLOTS
    inked_cells = len({c.pos for c in active})
    # primary = the workhorse ink for each cell's LOCAL ground (White on dark,
    # Cod Gray on light) — generalises the old white-dominance rule to white-
    # ground and split-ground banners.
    primary_cells = sum(1 for c in active if c.fg.upper() == primary_ink(c.bg).upper())
    accent_cells = sum(1 for c in active if c.fg.upper() not in {"#FFFFFF", "#121212"})
    # contrast legality replaces the hard-coded ratified-only whitelist, so any
    # registered proposal hue is judged by whether it actually reads.
    contrast_bad = sum(1 for c in active if not ink_legal(c.fg, c.bg))
    by_run = Counter((c.row, c.fg) for c in active)
    accent_run = max((n for (_row, fg), n in by_run.items() if fg.upper() not in {"#FFFFFF", "#121212"}), default=0)
    hero_hex = (banner.scores or {}).get("chosen_accent") or getattr(banner, "chosen_accent", None)
    chosen_cells = sum(1 for c in active if hero_hex and c.fg.upper() == hero_hex.upper())
    cols = sorted({cc for c in active for cc in range(c.col, c.col + getattr(c, "span_w", 1))})
    rows = sorted({c.row for c in active})
    return {
        "coverage_fraction": round(ink_area, 4),
        "inked_cell_fraction": round(inked_cells / TOTAL_SLOTS, 4),
        "inked_cells": inked_cells,
        "white_fraction": round(primary_cells / max(1, inked_cells), 4),
        "accent_cells": accent_cells,
        "max_accent_run": accent_run,
        "chosen_accent_cells": chosen_cells,
        "col_span": (max(cols) - min(cols) + 1) if cols else 0,
        "row_span": (max(rows) - min(rows) + 1) if rows else 0,
        "contrast_bad_inks": contrast_bad,
        "same_ground_runs": contrast_bad,
        "cod_ground_bad_inks": contrast_bad,
    }


def grammar_passes(banner: Banner, chosen_accent: Optional[str] = None) -> bool:
    s = grammar_stats(banner)
    full_canvas = s["col_span"] >= 5 and s["row_span"] == GRID_ROWS
    chosen_ok = True
    if chosen_accent:
        active = active_cells(banner.cells)
        chosen_ok = sum(1 for c in active if c.fg.upper() == chosen_accent.upper()) >= 3
    return (
        0.30 <= s["coverage_fraction"] <= 0.58
        and s["contrast_bad_inks"] == 0
        and s["max_accent_run"] >= 3
        and s["white_fraction"] >= 0.50
        and full_canvas
        and chosen_ok
    )


# ---------------------------------------------------------------------------
# Scoring — the eight supplement axes
# ---------------------------------------------------------------------------
def get_adjacent_pairs(cells_by_pos):
    pairs = []
    for (c, r), cell in cells_by_pos.items():
        if cell.empty or cell.covered_by is not None:
            continue
        if (c + 1, r) in cells_by_pos:
            nb = cells_by_pos[(c + 1, r)]
            if not nb.empty and nb.covered_by is None:
                pairs.append((cell, nb, "h"))
        if (c, r + 1) in cells_by_pos:
            nb = cells_by_pos[(c, r + 1)]
            if not nb.empty and nb.covered_by is None:
                pairs.append((cell, nb, "v"))
    return pairs


def active_cells(cells) -> list[Cell]:
    return [c for c in cells if not c.empty and c.covered_by is None and c.tile is not None]


def score_anchor_triangle(cells_by_pos) -> float:
    ranked = sorted(
        cells_by_pos.values(),
        key=lambda c: c.visual_weight * COLOR_CONTRAST[c.fg],
        reverse=True,
    )
    anchors = ranked[:3]
    if len(anchors) < 3:
        return 0.5
    cols = [a.col for a in anchors]
    rows = [a.row for a in anchors]
    thirds = [0 if c < 2 else (1 if c < 4 else 2) for c in cols]

    score = 1.0
    # all anchors in the same column-third → bad
    if len(set(thirds)) == 1:
        score -= 0.5
    elif len(set(thirds)) == 2:
        score -= 0.2
    # all on the same row → bad
    if len(set(rows)) == 1:
        score -= 0.4
    elif len(set(rows)) == 2:
        score -= 0.1
    # two anchors adjacent → mild penalty
    for i in range(3):
        for j in range(i + 1, 3):
            a, b = anchors[i], anchors[j]
            if abs(a.col - b.col) + abs(a.row - b.row) <= 1:
                score -= 0.15
    return max(0.0, score)


def score_rhythm(cells) -> float:
    cells = active_cells(cells)
    counts = Counter(c.tile.id for c in cells)
    n_unique = len(counts)
    n_singletons = sum(1 for v in counts.values() if v == 1)
    if not cells:
        return 0.0
    if 3 <= n_unique <= 5:
        unique_score = 1.0
    else:
        unique_score = max(0.0, 1.0 - abs(n_unique - 4) * 0.22)
    total = len(cells)
    import math
    entropy = 0.0
    for v in counts.values():
        p = v / total
        entropy -= p * math.log(p)
    max_entropy = math.log(max(1, n_unique))
    entropy_score = min(1.0, entropy / max_entropy) if max_entropy else 0.0
    overuse_penalty = sum(max(0, v - 5) for v in counts.values()) * 0.12
    singleton_penalty = max(0.0, (n_singletons - 2) * 0.2)
    by_pos = {(c.col, c.row): c for c in cells}
    run_penalty = 0.0
    for r in range(GRID_ROWS):
        run_id = None
        run = 0
        for c in range(GRID_COLS):
            cell = by_pos.get((c, r))
            tid = cell.tile.id if cell and cell.tile else None
            run = run + 1 if tid == run_id and tid is not None else 1
            run_id = tid
            if run > 2:
                run_penalty += 0.18
    for c in range(GRID_COLS):
        run_id = None
        run = 0
        for r in range(GRID_ROWS):
            cell = by_pos.get((c, r))
            tid = cell.tile.id if cell and cell.tile else None
            run = run + 1 if tid == run_id and tid is not None else 1
            run_id = tid
            if run > 2:
                run_penalty += 0.18
    return max(0.0, 0.55 * unique_score + 0.45 * entropy_score - singleton_penalty - overuse_penalty - run_penalty)


def score_direction(cells_by_pos) -> float:
    pairs = get_adjacent_pairs(cells_by_pos)
    if not pairs:
        return 0.6
    total = 0.0
    for a, b, axis in pairs:
        if axis == "h":
            da0 = rotate_direction(a.tile.direction, a.rotation)
            db0 = rotate_direction(b.tile.direction, b.rotation)
            da = H_ALIASES.get(da0, da0)
            db = H_ALIASES.get(db0, db0)
            total += HORIZONTAL_FLOW.get((da, db), 0.55)
        else:
            da0 = rotate_direction(a.tile.direction, a.rotation)
            db0 = rotate_direction(b.tile.direction, b.rotation)
            da = V_ALIASES.get(da0, da0)
            db = V_ALIASES.get(db0, db0)
            total += VERTICAL_FLOW.get((da, db), 0.55)
    return total / len(pairs)


def score_weight_balance(cells) -> float:
    row_w = [0.0, 0.0, 0.0]
    left_w = right_w = 0.0
    for c in active_cells(cells):
        row_w[c.row] += c.visual_weight
        if c.col < 3:
            left_w += c.visual_weight
        else:
            right_w += c.visual_weight
    max_row, min_row = max(row_w), min(row_w)
    row_ratio = min_row / max_row if max_row > 0 else 1.0
    row_score = min(1.0, row_ratio / 0.6)
    total = left_w + right_w
    if total > 0:
        lr_ratio = min(left_w, right_w) / max(left_w, right_w)
        lr_score = min(1.0, lr_ratio / 0.6)
    else:
        lr_score = 1.0
    return (row_score + lr_score) / 2


def score_negative_space(cells_by_pos) -> float:
    openish = [
        pos
        for pos, c in cells_by_pos.items()
        if c.empty or (c.covered_by is None and c.visual_weight < 0.28)
    ]
    empties = [pos for pos, c in cells_by_pos.items() if c.empty]
    n = len(openish)
    empty_ratio = len(empties) / TOTAL_SLOTS
    if 0.15 <= empty_ratio <= 0.30:
        count_score = 1.0
    elif 0.10 <= empty_ratio <= 0.35:
        count_score = 0.75
    else:
        count_score = max(0.0, 1.0 - abs(empty_ratio - 0.22) * 5.0)
    if len(openish) >= 2:
        dists = [abs(a[0] - b[0]) + abs(a[1] - b[1]) for i, a in enumerate(openish) for b in openish[i + 1 :]]
        avg = sum(dists) / len(dists)
        cluster_score = max(0.0, 1.0 - avg / 3.2)
    else:
        cluster_score = 0.2
    edge_touch = sum(1 for c, r in openish if c in {0, GRID_COLS - 1} or r in {0, GRID_ROWS - 1})
    edge_score = min(1.0, edge_touch / max(1, len(openish)) / 0.75)
    adjacency = 0
    for p in openish:
        adjacency += sum(1 for n in get_neighbors(p) if n in openish)
    contiguity = min(1.0, adjacency / max(1, len(openish) * 1.6))
    return 0.35 * count_score + 0.25 * cluster_score + 0.25 * edge_score + 0.15 * contiguity


def _avg_internal_distance(positions) -> float:
    if len(positions) < 2:
        return 0.0
    dists = [
        abs(a[0] - b[0]) + abs(a[1] - b[1])
        for i, a in enumerate(positions)
        for b in positions[i + 1 :]
    ]
    return sum(dists) / len(dists)


def score_temperature(cells_by_pos) -> float:
    warm = [pos for pos, c in cells_by_pos.items() if COLOR_TEMPERATURE[c.fg] == "warm"]
    cool = [pos for pos, c in cells_by_pos.items() if COLOR_TEMPERATURE[c.fg] == "cool"]
    # If a mode has effectively no warm/cool split (duotone/vertical neutral),
    # don't punish it — return a neutral-good score.
    if len(warm) + len(cool) <= 1:
        return 0.8
    warm_cohesion = max(0.0, 1.0 - _avg_internal_distance(warm) / 4.0) if len(warm) >= 2 else 0.6
    cool_cohesion = max(0.0, 1.0 - _avg_internal_distance(cool) / 4.0) if len(cool) >= 2 else 0.6
    left_warm = sum(1 for c, _ in warm if c < 3)
    right_warm = len(warm) - left_warm
    left_cool = sum(1 for c, _ in cool if c < 3)
    right_cool = len(cool) - left_cool
    split_a = left_warm + right_cool
    split_b = right_warm + left_cool
    split_score = max(split_a, split_b) / max(1, len(warm) + len(cool))
    return 0.42 * warm_cohesion + 0.42 * cool_cohesion + 0.16 * split_score


def score_family_grouping(cells_by_pos) -> float:
    pairs = get_adjacent_pairs(cells_by_pos)
    if not pairs:
        return 0.5
    same = sum(1 for a, b, _ in pairs if a.tile.family == b.tile.family)
    ratio = same / len(pairs)
    # bell curve centred on 0.55
    return max(0.0, 1.0 - ((ratio - 0.55) ** 2) * 10)


def get_neighbors(pos):
    c, r = pos
    return [(c - 1, r), (c + 1, r), (c, r - 1), (c, r + 1)]


def score_hero(cells_by_pos, hero_hex: str) -> float:
    active = {p: c for p, c in cells_by_pos.items() if not c.empty and c.covered_by is None}
    if not active:
        return 0.0
    hero_pos = max(active.keys(), key=lambda p: (active[p].hero, active[p].fg == hero_hex, active[p].visual_weight))
    hero = cells_by_pos[hero_pos]
    occupied = span_cells(hero_pos, hero.span_w, hero.span_h)
    pos_score = 1.0 if (hero_pos in POWER_POSITIONS or occupied & POWER_POSITIONS) else 0.5
    span_score = 1.0 if hero.span_w * hero.span_h >= 4 else 0.78 if hero.span_w * hero.span_h == 2 else 0.25
    contrasts = []
    for n in get_neighbors(hero_pos):
        if n in cells_by_pos:
            nb = cells_by_pos[n]
            if nb.empty or nb.covered_by is not None:
                continue
            weight_diff = abs(hero.visual_weight - nb.visual_weight)
            color_diff = 1.0 if nb.fg != hero.fg else 0.0
            contrasts.append((min(1.0, weight_diff) + color_diff) / 2)
    neighbor_score = sum(contrasts) / len(contrasts) if contrasts else 0.5
    # bonus for a single unambiguous hero (no other cell within 90% of its weight*contrast)
    hero_intensity = hero.visual_weight * COLOR_CONTRAST[hero.fg]
    rivals = sum(
        1
        for p, c in active.items()
        if p != hero_pos and c.visual_weight * COLOR_CONTRAST[c.fg] > 0.9 * hero_intensity
    )
    clarity = 1.0 if rivals == 0 else max(0.4, 1.0 - rivals * 0.2)
    return 0.25 * pos_score + 0.25 * span_score + 0.25 * neighbor_score + 0.25 * clarity


def score_template_fidelity(banner: Banner) -> float:
    weight_map = TEMPLATES.get(banner.template)
    if not weight_map:
        return 0.7
    score = 0.0
    count = 0
    for c in banner.cells:
        if c.covered_by is not None:
            continue
        expected = weight_map[c.row][c.col]
        if expected == "E":
            score += 1.0 if c.empty else 0.0
        elif c.empty:
            score += 0.0
        else:
            target = WEIGHT_LEVEL[expected]
            tol = {"H": 0.38, "M": 0.32, "L": 0.22}[expected]
            score += max(0.0, 1.0 - abs(c.visual_weight - target) / tol)
        count += 1

    # Macro bonuses for the templates whose identity depends on a clear gesture.
    by_pos = banner.by_pos()
    if banner.template in {"diagonal_sweep", "rising_stagger"}:
        heavy = [(p, c.visual_weight) for p, c in by_pos.items() if not c.empty and c.covered_by is None and c.visual_weight >= 0.45]
        if heavy:
            diag = sum(w for (col, row), w in heavy if abs((GRID_ROWS - 1 - row) - col * (GRID_ROWS - 1) / (GRID_COLS - 1)) <= 1.05)
            total = sum(w for _, w in heavy)
            score += 1.0 if diag / total >= 0.58 else 0.35
            count += 1
    if banner.template == "horizontal_banding":
        row_totals = [sum(c.visual_weight for c in banner.cells if c.row == r) for r in range(GRID_ROWS)]
        score += 1.0 if row_totals[0] > row_totals[2] > row_totals[1] else 0.35
        count += 1
    return score / count if count else 0.0


def score_symmetry(cells) -> float:
    active = active_cells(cells)
    if not active:
        return 0.0
    by_pos = {(c.col, c.row): c for c in active}
    max_col = max(c.col for c in active)
    pair_scores = []
    for cell in active:
        mirror = by_pos.get((max_col - cell.col, cell.row))
        if not mirror:
            pair_scores.append(0.0)
            continue
        same_run = 1.0 if mirror.fg == cell.fg else 0.4
        same_family = 1.0 if mirror.tile and cell.tile and mirror.tile.family == cell.tile.family else 0.5
        pair_scores.append(0.55 * same_run + 0.45 * same_family)
    bilateral = sum(pair_scores) / len(pair_scores)
    translational = 0.0
    rows = sorted({c.row for c in active})
    for row in rows:
        row_cells = [c for c in active if c.row == row]
        if len(row_cells) >= 3:
            same_tile = Counter(c.tile.id for c in row_cells).most_common(1)[0][1] / len(row_cells)
            same_ink = Counter(c.fg for c in row_cells).most_common(1)[0][1] / len(row_cells)
            translational = max(translational, 0.5 * same_tile + 0.5 * same_ink)
    return min(1.0, 0.65 * bilateral + 0.35 * translational)


def score_banner(banner: Banner, palette: dict, weights: dict) -> dict:
    cells = banner.cells
    by_pos = banner.by_pos()
    sub = {
        "anchor": score_anchor_triangle(by_pos),
        "rhythm": score_rhythm(cells),
        "direction": score_direction(by_pos),
        "weight": score_weight_balance(cells),
        "negative": score_negative_space(by_pos),
        "temperature": score_temperature(by_pos),
        "family": score_family_grouping(by_pos),
        "hero": score_hero(by_pos, palette["hero"]),
        "template": score_template_fidelity(banner),
        "symmetry": score_symmetry(cells),
    }
    total = sum(weights[k] * sub[k] for k in weights)
    sub["total"] = round(total, 4)
    for k in list(sub):
        sub[k] = round(sub[k], 4)
    return sub


# ---------------------------------------------------------------------------
# Generate-and-score driver
# ---------------------------------------------------------------------------
def generate_banner(
    tiles: list[Tile],
    color_mode: str = "full",
    vertical_hex: Optional[str] = None,
    template: Optional[str] = None,
    seed: Optional[int] = None,
    n_candidates: int = 240,
    weights: Optional[dict] = None,
    extra_hexes: Optional[list[str]] = None,
) -> Banner:
    banners = generate_many(tiles, color_mode, vertical_hex, template, seed,
                            n_candidates, keep=1, weights=weights, extra_hexes=extra_hexes)
    best = banners[0]
    best.scores["candidates"] = n_candidates
    return best


def generate_many(
    tiles: list[Tile],
    color_mode: str,
    vertical_hex: Optional[str],
    template: Optional[str],
    seed: Optional[int],
    n_candidates: int,
    keep: int,
    weights: Optional[dict] = None,
    extra_hexes: Optional[list[str]] = None,
) -> list[Banner]:
    """Score n_candidates and return the top `keep`, DIVERSITY-SELECTED: the
    keeps must differ structurally (template, occupancy, tiles, inks), not just
    be the best clone and its siblings."""
    weights = weights or SCORING_WEIGHTS
    base_seed = seed if seed is not None else random.randint(0, 2**31 - 1)
    palette = build_palette(color_mode, vertical_hex, extra_hexes)
    chosen = palette.get("hero")
    alias = {"mirror_monument": "monument"}
    if template in DECK_LAYOUTS:
        raise ValueError(f"{template} is a deck-art layout — use compose(), not banner generation")
    if template:
        template_pool = [alias.get(template, template)]
    else:
        template_pool = list(BANNER_TEMPLATES)

    scored: list[Banner] = []
    for i in range(n_candidates):
        cand_rng = random.Random(base_seed * 100003 + i)
        tmpl = cand_rng.choice(template_pool)
        cells = generate_candidate(tiles, tmpl, palette, color_mode, cand_rng)
        plan = getattr(generate_candidate, "last_plan", {"base": "#121212", "fields": []})
        banner = Banner(cells=cells, template=tmpl, color_mode=color_mode, seed=base_seed,
                        ground=plan["base"])
        try:
            banner.ground_fields = list(plan.get("fields") or [])
        except Exception:
            pass
        banner.scores = score_banner(banner, palette, weights)
        banner.scores.update(grammar_stats(banner))
        banner.scores["candidate_index"] = i
        banner.scores["base_seed"] = base_seed
        if chosen:
            banner.scores["chosen_accent"] = chosen
            banner.scores["chosen_accent_cells"] = sum(
                1 for c in banner.cells if c.tile and c.fg.upper() == chosen.upper())
        scored.append(banner)
    passing = [b for b in scored if grammar_passes(b, chosen_accent=chosen)]
    ranked = sorted(passing or scored, key=lambda b: b.total, reverse=True)

    def sig(b: Banner):
        act = [c for c in b.cells if c.tile is not None]
        occ = frozenset((c.col, c.row) for c in act)
        fams = frozenset(c.tile.family for c in act)
        inks = frozenset(c.fg.upper() for c in act)
        return (b.template, b.ground, occ, fams, inks)

    def dist(a, b) -> float:
        d = 0.0
        d += 6.0 if a[0] != b[0] else 0.0          # different archetype
        d += 3.0 if a[1] != b[1] else 0.0          # different ground
        d += 0.6 * len(a[2] ^ b[2])                # occupancy difference
        d += 2.0 if a[3] != b[3] else 0.0          # tile families
        d += 2.0 if a[4] != b[4] else 0.0          # ink set
        return d

    kept: list[Banner] = []
    kept_sigs = []
    for threshold in (6.0, 3.0, 0.0):
        for b in ranked:
            if len(kept) >= keep:
                break
            if b in kept:
                continue
            s = sig(b)
            if all(dist(s, ks) >= threshold for ks in kept_sigs):
                kept.append(b)
                kept_sigs.append(s)
        if len(kept) >= keep:
            break
    return kept[:keep]


# ---------------------------------------------------------------------------
# SVG assembly
# ---------------------------------------------------------------------------
from fai_tile_render import render_tile_group  # noqa: E402


def compose(cells=(GRID_COLS, GRID_ROWS), ground="#121212", inks=None, layout="mirror_monument", seed=None, cell_px=CELL) -> str:
    """Reusable grammar API for banner, deck strip, and panel compositions."""
    cols, rows = cells
    rng = random.Random(seed if seed is not None else random.randint(0, 2**31 - 1))
    tiles, _ = load_tiles(DEFAULT_MANIFEST)
    inks = inks or {"primary": "#FFFFFF", "accent": "#FF4F00", "accent2": "#FFA300"}
    if isinstance(inks, dict):
        primary = inks.get("primary", "#FFFFFF")
        accent = inks.get("accent", primary)
    else:
        primary = inks[0] if inks else "#FFFFFF"
        accent = inks[1] if len(inks) > 1 else primary
    w, h = cols * cell_px, rows * cell_px
    parts = [
        "<?xml version='1.0' encoding='UTF-8'?>",
        f'<svg xmlns="{SVG_NS}" version="1.1" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
    ]
    if ground is not None:
        parts.append(f'<rect width="{w}" height="{h}" fill="{ground}"/>')

    def emit(col, row, tile, ink, rot=0, flip=False):
        x, y = col * cell_px, row * cell_px
        bg = ground or "#FFFFFF"
        fg_markup = render_tile_group(DEFAULT_TILES_DIR / tile.filename, ink, bg)
        scale = cell_px / TILE_VB
        transform = f"translate({x + cell_px if flip else x:.3f},{y:.3f}) scale({-scale if flip else scale:.5f},{scale:.5f})"
        if rot:
            transform += f" rotate({rot},100,100)"
        parts.append(f'<g transform="{transform}">{fg_markup}</g>')

    if layout == "mini_frieze" or rows == 1:
        tile = rng.choice(family_tiles(tiles, MINI_FAMILIES))
        rhythm = rng.choice(["identical", "alternating_rotation", "mirror_pair"])
        for col in range(cols):
            emit(col, 0, tile, accent, 180 if rhythm == "alternating_rotation" and col % 2 else 0, rhythm == "mirror_pair" and col % 2)
    else:
        tile = rng.choice(edge_rich_tiles(tiles, SUPERFORM_FAMILIES))
        for row in range(rows):
            for col in range(cols):
                emit(col, row, tile, primary, [0, 90, 180, 270][(col + row) % 4], flip=(layout == "mini_panel" and col >= cols / 2))
        if cols * rows >= 6:
            dot = min(tiles, key=lambda t: t.area_weight)
            emit(cols - 1, rows - 1, dot, accent, rng.choice(ROTATIONS))
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def render_svg(banner: Banner, tiles_dir: Path, dimensions=(1920, 960)) -> str:
    w, h = dimensions
    parts = [
        "<?xml version='1.0' encoding='UTF-8'?>",
        f'<svg xmlns="{SVG_NS}" version="1.1" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
    ]
    if banner.ground is not None:
        parts.append(f'<rect width="{w}" height="{h}" fill="{banner.ground}"/>')
    for x, y, fw, fh, fill in banner.ground_fields:
        parts.append(f'<rect x="{x*w:.3f}" y="{y*h:.3f}" width="{fw*w:.3f}" height="{fh*h:.3f}" fill="{fill}"/>')
    # scale: the 6x3 grid is 6*CELL x 3*CELL; scale to the requested size.
    grid_w, grid_h = GRID_COLS * CELL, GRID_ROWS * CELL
    sx, sy = w / grid_w, h / grid_h
    for cell in sorted(banner.cells, key=lambda c: (c.row, c.col)):
        if cell.empty or cell.covered_by is not None or cell.tile is None:
            continue
        x = cell.col * CELL * sx
        y = cell.row * CELL * sy
        cw = CELL * sx * cell.span_w
        ch = CELL * sy * cell.span_h
        # Recoloured foreground (handles every tile construction: multi-element,
        # circles/ellipses/polygons, figure-on-ground cut-outs, CSS-class fills).
        try:
            fg_markup = render_tile_group(tiles_dir / cell.tile.filename, cell.fg, cell.bg)
        except Exception:
            fg_markup = ""
        if not fg_markup.strip():
            continue
        scale = cw / TILE_VB
        if cell.flip_x:
            transform = f"translate({x + cw:.3f},{y:.3f}) scale({-scale:.5f},{scale:.5f})"
        else:
            transform = f"translate({x:.3f},{y:.3f}) scale({scale:.5f})"
        if cell.rotation:
            transform += f" rotate({cell.rotation},100,100)"
        parts.append(f'<g transform="{transform}">{fg_markup}</g>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def write_png(svg_text: str, png_path: Path, dimensions=(1920, 960)) -> None:
    import cairosvg

    cairosvg.svg2png(
        bytestring=svg_text.encode("utf-8"),
        write_to=str(png_path),
        output_width=dimensions[0],
        output_height=dimensions[1],
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def score_line(banner: Banner) -> str:
    s = banner.scores
    keys = ["anchor", "rhythm", "direction", "weight", "negative", "temperature", "family", "hero", "template", "symmetry"]
    labels = {"template": "tmp", "temperature": "tem"}
    parts = " ".join(f"{labels.get(k, k[:3])}={s[k]:.2f}" for k in keys)
    return f"total={s['total']:.3f} [{banner.template}] {parts}"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="FAI banner generator (rebuild)")
    p.add_argument("--color-mode", choices=["full", "duotone", "vertical", "extended"], default="full")
    p.add_argument("--vertical-hex", default=None, help="middle colour for --color-mode vertical (one of the 7 FAI fills)")
    p.add_argument("--extra-hex", action="append", default=[], help="extra accent hex for --color-mode extended (repeatable; requires --allow-unratified-hex)")
    p.add_argument("--allow-unratified-hex", action="store_true",
                   help="permit a --vertical-hex outside the 7 ratified fills "
                        "(PROPOSAL WORK ONLY — e.g. demoing candidate pillar hues)")
    p.add_argument("--template", choices=BANNER_TEMPLATES + ["mirror_monument"], default=None, help="force a banner archetype (default: best across all)")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--candidates", type=int, default=240, help="candidates scored per banner")
    p.add_argument("--keep", type=int, default=1, help="how many top banners to write")
    p.add_argument("--dimensions", type=int, nargs=2, default=[1920, 960])
    p.add_argument("--out", type=Path, default=None, help="output path stem (no extension) or directory if --keep>1")
    p.add_argument("--png", action="store_true", help="also render PNG (needs cairosvg dylibs)")
    p.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    p.add_argument("--tiles-dir", type=Path, default=DEFAULT_TILES_DIR)
    p.add_argument("--list-templates", action="store_true")
    args = p.parse_args(argv)

    if args.list_templates:
        for name, wm in ((k, TEMPLATES[k]) for k in BANNER_TEMPLATES):
            print(name)
            for row in wm:
                print("   " + " ".join(row))
        return 0

    if args.color_mode == "vertical":
        if not args.vertical_hex:
            print("error: --color-mode vertical requires --vertical-hex", file=sys.stderr)
            return 2
        vh = args.vertical_hex.upper()
        if vh not in {c.upper() for c in BRAND.values()}:
            if args.allow_unratified_hex:
                print(f"note: --vertical-hex {vh} is UNRATIFIED (proposal demo only)", file=sys.stderr)
            else:
                print(f"error: --vertical-hex {vh} is not one of the 7 ratified FAI fills "
                      f"(use --allow-unratified-hex for proposal demos)", file=sys.stderr)
                return 2
    if args.color_mode == "extended" and args.extra_hex and not args.allow_unratified_hex:
        print("error: --extra-hex requires --allow-unratified-hex (proposal demos only)", file=sys.stderr)
        return 2

    tiles, _manifest = load_tiles(args.manifest)
    dims = tuple(args.dimensions)

    banners = generate_many(
        tiles,
        color_mode=args.color_mode,
        vertical_hex=args.vertical_hex,
        template=args.template,
        seed=args.seed,
        n_candidates=args.candidates,
        keep=args.keep,
        extra_hexes=args.extra_hex,
    )

    out = args.out or (DEFAULT_OUTPUT_DIR / f"banner-{args.color_mode}")
    out = Path(out)
    if args.keep > 1:
        out.mkdir(parents=True, exist_ok=True)
        stems = [out / f"{i+1:02d}-{b.template}" for i, b in enumerate(banners)]
    else:
        out.parent.mkdir(parents=True, exist_ok=True)
        stems = [out]

    for banner, stem in zip(banners, stems):
        svg = render_svg(banner, args.tiles_dir, dims)
        svg_path = stem.with_suffix(".svg")
        svg_path.write_text(svg)
        print(f"{svg_path}  {score_line(banner)}")
        if args.png:
            write_png(svg, stem.with_suffix(".png"), dims)
            print(f"{stem.with_suffix('.png')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
