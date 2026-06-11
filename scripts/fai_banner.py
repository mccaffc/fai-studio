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
    "mirror_monument": [list("LHHHHL"), list("EMHHME"), list("LLLLLL")],
    "frieze_stack": [list("MMMMMM"), list("EEEEEE"), list("MMMMMM")],
    "ring_field": [list("EHHHHE"), list("EHHHHE"), list("LLLLEE")],
    "field_split": [list("LLHHLL"), list("MMHHMM"), list("LLHHLL")],
    "eye_row": [list("EEEEEE"), list("MMMMMM"), list("HHHHHH")],
    "mini_frieze": [list("MMM")],
    "mini_panel": [list("HH"), list("MM"), list("HH")],
}


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
        return {
            "fills": fills,
            "accents": accents,
            "grounds": [sw, wh, tw, cg],
            "bridges": [tw, sw, wh, cg],
            "hero": None,
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


def grammar_ground(palette: dict, color_mode: str) -> str:
    if color_mode in {"full", "extended"} and random.random() < 0.12:
        return "#FFFFFF"
    return "#121212"


def run_inks(palette: dict, color_mode: str, rng: random.Random) -> dict:
    accent = palette["accents"][0] if color_mode in {"duotone", "vertical"} else rng.choice(palette["accents"])
    if color_mode == "full":
        second = rng.choice([h for h in palette["accents"] if h != accent] or [accent])
    elif color_mode == "extended":
        second = rng.choice([h for h in palette["accents"] if h != accent] or [accent])
    else:
        second = accent
    return {"primary": "#FFFFFF", "accent": accent, "accent2": second}


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
    """Build a grammar-valid banner candidate: shared ground, run inks, macro-forms."""
    ground = "#121212"
    inks = run_inks(palette, color_mode, rng)
    cells: list[Cell] = []
    occupied: set[tuple[int, int]] = set()
    super_tile = rng.choice(grammar_tile_pool(tiles, SUPERFORM_FAMILIES, 0.46, 0.74))
    frieze_tile = rng.choice(grammar_tile_pool(tiles, {"pod", "eye", "lines", "circle", "centric"}, 0.40, 0.70))
    solid_tile = rng.choice(grammar_tile_pool(tiles, {"angle", "ramp", "square", "circle", "lines"}, 0.50, 0.78))
    rhythm = rng.choice(["identical", "alternating_rotation", "mirror_pair"])

    def mark():
        occupied.update((c.col, c.row) for c in cells)

    if template_name == "mirror_monument":
        add_superform(cells, (2, 0, 2, 2), super_tile, inks["primary"], ground, rng, mirror=True)
        side = rng.choice(grammar_tile_pool(tiles, {"angle", "ramp", "square", "lines"}, 0.40, 0.70))
        add_frieze(cells, range(0, 2), 0, side, "mirror_pair", inks["primary"], ground)
        add_frieze(cells, range(4, 6), 0, side, "mirror_pair", inks["primary"], ground)
        add_frieze(cells, range(0, 2), 2, frieze_tile, "mirror_pair", inks["accent"], ground)
        add_frieze(cells, range(4, 6), 2, frieze_tile, "mirror_pair", inks["accent"], ground)
    elif template_name == "frieze_stack":
        add_frieze(cells, range(0, 6), 0, frieze_tile, rhythm, inks["primary"], ground)
        mid = rng.choice(grammar_tile_pool(tiles, {"pod", "eye", "circle", "lines"}, 0.36, 0.62))
        add_frieze(cells, range(1, 5), 1, mid, "mirror_pair", inks["primary"], ground)
        t2 = rng.choice(grammar_tile_pool(tiles, {"angle", "ramp", "square", "pod"}, 0.42, 0.74))
        add_frieze(cells, range(1, 5), 2, t2, "alternating_rotation", inks["accent"], ground)
    elif template_name == "ring_field":
        add_superform(cells, (1, 0, 4, 2), super_tile, inks["primary"], ground, rng)
        add_frieze(cells, range(0, 4), 2, frieze_tile, "alternating_rotation", inks["accent"], ground)
    elif template_name == "field_split":
        add_superform(cells, (2, 0, 2, 3), super_tile, inks["primary"], ground, rng, mirror=True)
        wing = rng.choice(grammar_tile_pool(tiles, {"angle", "ramp", "square"}, 0.38, 0.68))
        add_frieze(cells, range(0, 2), 0, wing, "identical", inks["primary"], ground)
        add_frieze(cells, range(4, 6), 0, wing, "mirror_pair", inks["primary"], ground)
        add_frieze(cells, range(0, 2), 1, wing, "identical", inks["accent"], ground)
        add_frieze(cells, range(4, 6), 1, wing, "mirror_pair", inks["accent"], ground)
    elif template_name == "eye_row":
        add_frieze(cells, range(0, 6), 1, frieze_tile, "mirror_pair", inks["primary"], ground)
        add_frieze(cells, range(1, 5), 2, solid_tile, "identical", inks["accent"], ground)
    elif template_name == "mini_frieze":
        add_frieze(cells, range(0, 3), 0, rng.choice(family_tiles(tiles, MINI_FAMILIES)), rhythm, inks["accent"], ground)
    elif template_name == "mini_panel":
        add_superform(cells, (0, 0, 2, 3), super_tile, inks["primary"], ground, rng, mirror=True)
    else:
        add_superform(cells, (1, 0, 4, 2), super_tile, inks["primary"], ground, rng, mirror=True)

    mark()
    if template_name not in {"mini_frieze", "mini_panel"}:
        add_punctuation(cells, occupied, tiles, rng.randint(0, 2), inks["accent2"], ground, rng)
    return cells


def grammar_stats(banner: Banner) -> dict:
    """Structural QA metrics for the grammar-first generator."""
    active = active_cells(banner.cells)
    ink_area = sum(c.tile.area_weight for c in active if c.tile) / TOTAL_SLOTS
    inked_cells = len({c.pos for c in active})
    white_cells = sum(1 for c in active if c.fg.upper() == "#FFFFFF")
    accent_cells = sum(1 for c in active if c.fg.upper() not in {"#FFFFFF", "#121212"})
    same_ground = sum(1 for c in active if c.fg.upper() == c.bg.upper())
    cod_bad = sum(
        1
        for c in active
        if c.bg.upper() == "#121212" and c.fg.upper() not in {"#FFFFFF", "#FF4F00", "#FFA300", "#4997D0"}
    )
    by_run = Counter((c.row, c.fg) for c in active)
    accent_run = max((n for (_row, fg), n in by_run.items() if fg.upper() not in {"#FFFFFF", "#121212"}), default=0)
    return {
        "coverage_fraction": round(ink_area, 4),
        "inked_cell_fraction": round(inked_cells / TOTAL_SLOTS, 4),
        "inked_cells": inked_cells,
        "white_fraction": round(white_cells / max(1, inked_cells), 4),
        "accent_cells": accent_cells,
        "max_accent_run": accent_run,
        "same_ground_runs": same_ground,
        "cod_ground_bad_inks": cod_bad,
    }


def grammar_passes(banner: Banner) -> bool:
    s = grammar_stats(banner)
    return (
        0.35 <= s["coverage_fraction"] <= 0.55
        and s["same_ground_runs"] == 0
        and s["cod_ground_bad_inks"] == 0
        and s["max_accent_run"] >= 4
        and s["white_fraction"] >= 0.60
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
    weights = weights or SCORING_WEIGHTS
    base_seed = seed if seed is not None else random.randint(0, 2**31 - 1)
    rng = random.Random(base_seed)
    palette = build_palette(color_mode, vertical_hex, extra_hexes)
    template_pool = [template] if template else list(TEMPLATES)

    best: Optional[Banner] = None
    fallback: Optional[Banner] = None
    for i in range(n_candidates):
        cand_rng = random.Random(base_seed * 100003 + i)
        tmpl = cand_rng.choice(template_pool)
        cells = generate_candidate(tiles, tmpl, palette, color_mode, cand_rng)
        banner = Banner(cells=cells, template=tmpl, color_mode=color_mode, seed=base_seed, ground="#121212")
        banner.scores = score_banner(banner, palette, weights)
        banner.scores.update(grammar_stats(banner))
        if fallback is None or banner.total > fallback.total:
            fallback = banner
        if not grammar_passes(banner):
            continue
        if best is None or banner.total > best.total:
            best = banner
    best = best or fallback
    best.scores["candidates"] = n_candidates
    best.scores["base_seed"] = base_seed
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
    """Score n_candidates and return the top `keep`, de-duplicated by layout."""
    weights = weights or SCORING_WEIGHTS
    base_seed = seed if seed is not None else random.randint(0, 2**31 - 1)
    rng = random.Random(base_seed)
    palette = build_palette(color_mode, vertical_hex, extra_hexes)
    template_pool = [template] if template else list(TEMPLATES)

    scored: list[Banner] = []
    for i in range(n_candidates):
        cand_rng = random.Random(base_seed * 100003 + i)
        tmpl = cand_rng.choice(template_pool)
        cells = generate_candidate(tiles, tmpl, palette, color_mode, cand_rng)
        banner = Banner(cells=cells, template=tmpl, color_mode=color_mode, seed=base_seed, ground="#121212")
        banner.scores = score_banner(banner, palette, weights)
        banner.scores.update(grammar_stats(banner))
        banner.scores["candidate_index"] = i
        banner.scores["base_seed"] = base_seed
        scored.append(banner)
    passing = [b for b in scored if grammar_passes(b)]
    ranked = passing or scored
    ranked.sort(key=lambda b: b.total, reverse=True)
    return ranked[:keep]


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
    p.add_argument("--template", choices=sorted(TEMPLATES), default=None, help="force a composition template (default: best across all)")
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
        for name, wm in TEMPLATES.items():
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
