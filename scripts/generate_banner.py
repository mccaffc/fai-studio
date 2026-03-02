#!/usr/bin/env python3
"""
Phase 3: FAI Banner Generator (v3)

Generates on-brand 6×3 grid banner compositions from simplified shape tiles.

Composition philosophy (v3):
  - Pick 1–3 shape families per banner (not all 17) — creates coherent motif
  - Systematic rotation patterns (pinwheel, spiral, mirror, flow) — tilework feel
  - Family repetition IS the composition; color variation provides interest
  - Flat SVG output: <g transform="translate scale [rotate]"> instead of nested <svg>

Templates:
  pinwheel   — one or two families, 4-rotation pinwheel tiling
  spiral     — one or two families, rotation advances each column
  mirror     — one or two families, reflected across vertical centre
  flow       — one family, alternating 0°/180° creates flowing linked shapes
  focal      — two or three families, heavier tiles cluster at centre
  scatter    — two or three families, free rotation, light & varied

Usage:
    python generate_banner.py --energy medium --seed 42
    python generate_banner.py --batch 50
    python generate_banner.py --energy high --template pinwheel --seed 7
    python generate_banner.py --continuity-strength 0.8 --template flow
"""

import argparse
import copy
import json
import math
import random
import sys
from collections import Counter
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS, WARM_COLORS, COOL_COLORS, NEUTRAL_COLORS, HEX_TO_NAME

# ── Constants ─────────────────────────────────────────────
SVG_NS = "http://www.w3.org/2000/svg"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST   = BASE_DIR / "tiles-manifest-v2.json"
DEFAULT_TILES_DIR  = BASE_DIR / "output" / "shapes-simplified"
DEFAULT_OUTPUT_DIR = BASE_DIR / "output" / "banners-generated"

GRID_COLS   = 6
GRID_ROWS   = 3
TOTAL_SLOTS = GRID_COLS * GRID_ROWS   # 18
TILE_VB_W   = 200
TILE_VB_H   = 200
CELL_W      = 320   # 1920 / 6  — exact integer
CELL_H      = 320   # 960 / 3   — exact integer
CELL_SCALE  = CELL_W / TILE_VB_W   # 1.6

ROTATIONS = [0, 90, 180, 270]

# ── Rotation edge source mapping ──────────────────────────
# After rotation R, new edge P comes from original edge SOURCE[R][P].
EDGE_ROTATION_SOURCE = {
    0:   {"top": "top",    "right": "right",  "bottom": "bottom", "left": "left"},
    90:  {"top": "right",  "right": "bottom", "bottom": "left",   "left": "top"},
    180: {"top": "bottom", "right": "left",   "bottom": "top",    "left": "right"},
    270: {"top": "left",   "right": "top",    "bottom": "right",  "left": "bottom"},
}


def rotate_edges(edge_type: dict, coverage: dict, rotation: int) -> tuple[dict, dict]:
    src = EDGE_ROTATION_SOURCE[rotation]
    new_type = {e: edge_type[src[e]] for e in ("top", "right", "bottom", "left")}
    new_cov  = {e: coverage[src[e]]  for e in ("top", "right", "bottom", "left")}
    return new_type, new_cov


# ── Rotation patterns ─────────────────────────────────────
# Each function (row, col) → rotation index into ROTATIONS [0–3]
ROTATION_PATTERN_FNS: dict[str, Optional[callable]] = {
    "pinwheel":  lambda r, c: (r * 2 + c) % 4,
    "spiral":    lambda r, c: c % 4,
    "mirror":    lambda r, c: c % 4 if c < GRID_COLS // 2 else (GRID_COLS - 1 - c) % 4,
    "flow":      lambda r, c: (r + c) % 2 * 2,   # alternates 0° / 180°
    "diagonal":  lambda r, c: (r + c) % 4,
    "checker90": lambda r, c: (r + c) % 2 * 2,
    "free":      None,
}

# ── Template configuration ────────────────────────────────
TEMPLATES = ["pinwheel", "spiral", "mirror", "flow", "focal", "scatter"]

TEMPLATE_CONFIG: dict[str, dict] = {
    "pinwheel":  {"primary_fam": (1, 2), "accent_fam": (0, 1), "rotation": "pinwheel",  "motif": True},
    "spiral":    {"primary_fam": (1, 2), "accent_fam": (0, 1), "rotation": "spiral",    "motif": True},
    "mirror":    {"primary_fam": (1, 2), "accent_fam": (0, 1), "rotation": "mirror",    "motif": True},
    "flow":      {"primary_fam": (1, 1), "accent_fam": (0, 2), "rotation": "flow",      "motif": True},
    "focal":     {"primary_fam": (2, 3), "accent_fam": (1, 2), "rotation": "free",      "motif": False},
    "scatter":   {"primary_fam": (2, 4), "accent_fam": (0, 2), "rotation": "free",      "motif": False},
}

TEMPLATE_ENERGY_WEIGHTS: dict[str, dict[str, int]] = {
    "low":    {"flow": 4, "mirror": 3, "pinwheel": 2, "spiral": 2, "focal": 1, "scatter": 0},
    "medium": {"pinwheel": 3, "flow": 3, "spiral": 3, "mirror": 2, "focal": 2, "scatter": 1},
    "high":   {"pinwheel": 3, "spiral": 3, "scatter": 3, "diagonal": 0, "focal": 2, "mirror": 2, "flow": 1},
}

# Families whose tiles are especially good for motif repetition (flowing shapes)
FLOW_FAMILIES = {"wave", "curve", "lines", "cascade", "ramp", "angle"}
# Families with strong geometric shapes good for pinwheel/spiral
GEOMETRIC_FAMILIES = {"square", "rectangle", "circle", "mirror", "float", "composition"}

ALL_COLOR_TOKENS   = list(BRAND_COLORS.keys())
COLOR_TOKEN_TO_HEX = BRAND_COLORS.copy()
TILE_FG_HEX        = "#121212"


# ── Data Classes ──────────────────────────────────────────
@dataclass
class RotatedTile:
    tile: dict
    rotation: int
    edges: dict
    coverage: dict


@dataclass
class CellAssignment:
    col: int
    row: int
    tile_id: str
    tile_filename: str
    rotation: int
    fg_color: str
    bg_color: str
    fg_name: str
    bg_name: str


@dataclass
class BannerResult:
    output_path: Optional[str]
    seed: int
    energy: str
    template: str
    primary_families: list
    accent_families: list
    rotation_pattern: str
    continuity_strength: float
    dimensions: tuple
    color_bias: Optional[str]
    cells: list
    generated_at: str


# ── Manifest ──────────────────────────────────────────────
def load_manifest(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


# ── Rotated Tile Pool ─────────────────────────────────────
def build_rotated_pool(tiles: list[dict]) -> list[RotatedTile]:
    """All (tile, rotation) candidates, de-duplicating symmetric rotations."""
    pool = []
    for tile in tiles:
        if tile.get("shape_family") == "lines" and "clear" in tile.get("id", ""):
            continue
        sym = tile.get("symmetry", "none")
        edge_type = tile.get("edge_type", {k: False for k in ("top", "right", "bottom", "left")})
        edge_cov  = tile.get("edge_coverage", {k: 0.0  for k in ("top", "right", "bottom", "left")})

        if sym == "both":
            rots = [0]
        elif sym in ("horizontal", "vertical"):
            rots = [0, 90]
        elif sym == "rotational":
            rots = [0, 90]
        else:
            rots = ROTATIONS

        for r in rots:
            re_type, re_cov = rotate_edges(edge_type, edge_cov, r)
            pool.append(RotatedTile(tile=tile, rotation=r, edges=re_type, coverage=re_cov))
    return pool


# ── Family focus selection ────────────────────────────────
def pick_family_focus(
    tiles: list[dict],
    template: str,
    rng: random.Random,
) -> tuple[list[str], list[str]]:
    """
    Select primary and accent shape families for this banner.

    For motif templates (pinwheel, spiral, mirror, flow):
      - 1–2 primary families — nearly all tiles come from these
      - 0–1 accent families — occasional contrast tile

    For spatial templates (focal, scatter):
      - 2–4 primary families — broader variety
    """
    cfg = TEMPLATE_CONFIG[template]
    n_primary_lo, n_primary_hi = cfg["primary_fam"]
    n_accent_lo,  n_accent_hi  = cfg["accent_fam"]
    is_motif = cfg["motif"]

    # Build family pool
    family_tiles: dict[str, list] = {}
    for t in tiles:
        f = t.get("shape_family", "")
        if not f or (f == "lines" and "clear" in t.get("id", "")):
            continue
        family_tiles.setdefault(f, []).append(t)

    families = list(family_tiles.keys())
    # Weight by family size, bias toward flow/geometric families for motif templates
    weights = []
    for f in families:
        w = len(family_tiles[f])
        if is_motif:
            if f in FLOW_FAMILIES:
                w *= 2
            elif f in GEOMETRIC_FAMILIES:
                w *= 1.5
        weights.append(w)

    # Pick primary families
    n_primary = rng.randint(n_primary_lo, n_primary_hi)
    primary = []
    pool = list(zip(families, weights))
    while len(primary) < n_primary and pool:
        chosen = rng.choices([f for f, _ in pool], weights=[w for _, w in pool], k=1)[0]
        if chosen not in primary:
            primary.append(chosen)
        pool = [(f, w) for f, w in pool if f != chosen or len(primary) >= n_primary]
        if chosen in primary and len(primary) < n_primary:
            pool = [(f, w) for f, w in pool if f != chosen]

    # Pick accent families (different from primary)
    n_accent = rng.randint(n_accent_lo, n_accent_hi)
    accent_pool = [(f, len(family_tiles[f])) for f in families if f not in primary]
    accent = []
    for _ in range(n_accent):
        if not accent_pool:
            break
        chosen = rng.choices([f for f, _ in accent_pool], weights=[w for _, w in accent_pool], k=1)[0]
        accent.append(chosen)
        accent_pool = [(f, w) for f, w in accent_pool if f != chosen]

    return primary, accent


# ── Tile placement (family-focused, pattern-driven) ───────
def score_candidate(
    cand: RotatedTile,
    placed: dict,
    row: int, col: int,
    primary_families: list[str],
    accent_families: list[str],
    target_rotation: Optional[int],
    rotation_counts: dict,
    pos_weight: float = 1.0,
) -> float:
    score = 1.0
    family = cand.tile.get("shape_family", "")

    # ─ Family focus scoring (the key driver) ─
    if family in primary_families:
        score += 8.0
    elif family in accent_families:
        score += 2.0
    else:
        score -= 15.0   # Effectively excluded

    # ─ Rotation scoring ─
    if target_rotation is not None:
        # Pattern rotation: strong preference for exact match
        if cand.rotation == target_rotation:
            score += 5.0
        else:
            score -= 3.0
    else:
        # Free rotation: mild preference for less-used rotations
        cnt = rotation_counts.get(cand.rotation, 0)
        score += max(0.0, 2.0 - cnt * 0.5)

    # ─ Edge matching with neighbours (lighter weight than v2 — pattern dominates) ─
    if col > 0 and (row, col - 1) in placed:
        left = placed[(row, col - 1)]
        if cand.edges["left"] and left.edges["right"]:
            score += 1.5 * (cand.coverage["left"] + left.coverage["right"]) / 2
        elif not cand.edges["left"] and not left.edges["right"]:
            score += 0.3
        else:
            score -= 0.3

    if row > 0 and (row - 1, col) in placed:
        top = placed[(row - 1, col)]
        if cand.edges["top"] and top.edges["bottom"]:
            score += 1.5 * (cand.coverage["top"] + top.coverage["bottom"]) / 2
        elif not cand.edges["top"] and not top.edges["bottom"]:
            score += 0.3
        else:
            score -= 0.3

    # ─ Position weight (only meaningful for focal template) ─
    tile_weight = cand.tile.get("visual_weight", 0.1)
    score += pos_weight * tile_weight

    return max(0.01, score)


def make_position_weights(template: str) -> list[float]:
    """Position weights for focal template (heavier tiles preferred at centre)."""
    weights = [1.0] * TOTAL_SLOTS
    if template == "focal":
        for pos in range(TOTAL_SLOTS):
            r, c = pos // GRID_COLS, pos % GRID_COLS
            dist = math.sqrt((c - 2.5) ** 2 + (r - 1.0) ** 2)
            weights[pos] = max(0.3, 2.5 - dist * 0.55)
    return weights


def scored_tile_placement(
    rotated_pool: list[RotatedTile],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
    top_k: int = 12,
) -> list[dict]:
    """
    Place 18 tiles using family focus + rotation pattern.
    Returns list of {row, col, tile, rotation, edges, coverage}.
    """
    cfg = TEMPLATE_CONFIG[template]
    rot_fn = ROTATION_PATTERN_FNS.get(cfg["rotation"])
    pos_weights = make_position_weights(template)

    placed: dict[tuple, RotatedTile] = {}
    rotation_counts: dict[int, int] = {}
    result = []

    for pos in range(TOTAL_SLOTS):   # row-major
        row, col = pos // GRID_COLS, pos % GRID_COLS
        pw = pos_weights[pos]

        # Determine target rotation from pattern
        target_rotation = ROTATIONS[rot_fn(row, col)] if rot_fn is not None else None

        scores = [
            score_candidate(c, placed, row, col, primary_families, accent_families,
                            target_rotation, rotation_counts, pw)
            for c in rotated_pool
        ]

        # Weighted random from top-k
        indexed = sorted(enumerate(scores), key=lambda x: -x[1])[:top_k]
        top_i = [i for i, _ in indexed]
        top_s = [s for _, s in indexed]
        chosen_idx = rng.choices(top_i, weights=top_s, k=1)[0]
        chosen = rotated_pool[chosen_idx]

        placed[(row, col)] = chosen
        rotation_counts[chosen.rotation] = rotation_counts.get(chosen.rotation, 0) + 1

        result.append({
            "row": row, "col": col,
            "tile": chosen.tile,
            "rotation": chosen.rotation,
            "edges": chosen.edges,
            "coverage": chosen.coverage,
        })

    return result


# ── Color Pool ────────────────────────────────────────────
def build_color_pool(
    energy: str,
    manifest: dict,
    rng: random.Random,
    color_bias: Optional[str] = None,
) -> list[dict]:
    spec = manifest["energy_levels"][energy]
    if energy == "low":
        return _build_low_palette(spec, rng, color_bias)
    elif energy == "medium":
        return _build_medium_palette(spec, rng, color_bias)
    else:
        return _build_high_palette(spec, rng, color_bias)


def _build_low_palette(spec, rng, bias):
    dominant = rng.choice(spec["required_dominant"])
    bg_pool = ["white", "smoke_white"] if dominant == "cod_gray" else ["cod_gray"]
    bg_dom = rng.choice(bg_pool)
    n_accent = rng.randint(*spec["accent_tile_range"])
    cells = [{"fg": dominant, "bg": bg_dom}] * (TOTAL_SLOTS - n_accent)
    cells += [{"fg": "international_orange", "bg": dominant}] * n_accent
    rng.shuffle(cells)
    return cells


def _build_medium_palette(spec, rng, bias):
    num_colors = rng.randint(*spec["color_count_range"])
    required = ["international_orange", "cod_gray"]
    pool = [c for c in ALL_COLOR_TOKENS if c not in required]
    rng.shuffle(pool)
    chosen = required + pool[:num_colors - len(required)]
    if bias and bias not in chosen:
        chosen[-1] = bias
    return _distribute_colors(chosen, TOTAL_SLOTS, spec["max_single_color_tiles"], spec["orange_tile_range"], rng)


def _build_high_palette(spec, rng, bias):
    num_colors = rng.randint(*spec["color_count_range"])
    required = ["international_orange", "celestial_blue", "chrome_yellow"]
    pool = [c for c in ALL_COLOR_TOKENS if c not in required]
    rng.shuffle(pool)
    chosen = required + pool[:num_colors - len(required)]
    if bias and bias not in chosen:
        chosen[-1] = bias
    return _distribute_colors(chosen, TOTAL_SLOTS, 5, spec["orange_tile_range"], rng, min_per_color=1)


def _distribute_colors(colors, total, max_per_color, orange_range, rng, min_per_color=0):
    counts = {c: min_per_color for c in colors}
    remaining = total - sum(counts.values())
    if "international_orange" in counts:
        tgt = rng.randint(*orange_range)
        add = max(0, tgt - counts["international_orange"])
        counts["international_orange"] += add
        remaining -= add
    while remaining > 0:
        cands = [c for c in colors if counts[c] < max_per_color] or list(colors)
        c = rng.choice(cands)
        counts[c] += 1
        remaining -= 1
    cells = []
    for fg_name, cnt in counts.items():
        for _ in range(cnt):
            cells.append({"fg": fg_name, "bg": _pick_contrasting_bg(fg_name, colors, rng)})
    rng.shuffle(cells)
    return cells


def _pick_contrasting_bg(fg_name, available, rng):
    fg_hex = COLOR_TOKEN_TO_HEX[fg_name]
    if fg_hex in WARM_COLORS or fg_name in ("international_orange", "chrome_yellow"):
        preferred = ["cod_gray", "white", "smoke_white"]
    elif fg_hex in COOL_COLORS:
        preferred = ["cod_gray", "white", "smoke_white", "international_orange"]
    elif fg_name == "cod_gray":
        preferred = ["white", "smoke_white", "international_orange"]
    elif fg_name in ("white", "smoke_white", "timberwolf"):
        preferred = ["cod_gray", "international_orange", "celestial_blue"]
    else:
        preferred = [c for c in available if c != fg_name]
    candidates = [c for c in preferred if c != fg_name] or \
                 [c for c in available if c != fg_name] or ["cod_gray"]
    return rng.choice(candidates)


# ── Adjacency Constraint ──────────────────────────────────
def apply_adjacency_constraints(
    cells: list[dict],
    rng: random.Random,
    max_iter: int = 150,
) -> list[dict]:
    """Reorder cells to minimise same-fg adjacent pairs. Sets _row/_col."""
    grid = [list(cells[r * GRID_COLS:(r + 1) * GRID_COLS]) for r in range(GRID_ROWS)]
    for _ in range(max_iter):
        if _count_violations(grid) == 0:
            break
        for r in range(GRID_ROWS):
            for c in range(GRID_COLS):
                if _has_conflict(grid, r, c):
                    v_before = _count_violations(grid)
                    sr, sc = rng.randint(0, GRID_ROWS - 1), rng.randint(0, GRID_COLS - 1)
                    if (sr, sc) != (r, c):
                        grid[r][c], grid[sr][sc] = grid[sr][sc], grid[r][c]
                        if _count_violations(grid) >= v_before:
                            grid[r][c], grid[sr][sc] = grid[sr][sc], grid[r][c]
    result = []
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            item = dict(grid[r][c])
            item["_row"] = r
            item["_col"] = c
            result.append(item)
    return result


def _count_violations(grid):
    return sum(1 for r in range(GRID_ROWS) for c in range(GRID_COLS) if _has_conflict(grid, r, c))


def _has_conflict(grid, r, c):
    fg = grid[r][c]["fg"]
    return (c + 1 < GRID_COLS and grid[r][c + 1]["fg"] == fg) or \
           (r + 1 < GRID_ROWS and grid[r + 1][c]["fg"] == fg)


# ── Color Continuity ──────────────────────────────────────
def build_continuity_pairs(
    placement: list[dict],
    continuity_strength: float,
    rng: random.Random,
) -> list[tuple]:
    """Pairs of adjacent cells where both tiles touch the shared edge."""
    grid = {(p["row"], p["col"]): p for p in placement}
    pairs = []
    for p in placement:
        r, c = p["row"], p["col"]
        if c + 1 < GRID_COLS and (r, c + 1) in grid:
            nb = grid[(r, c + 1)]
            if p["edges"]["right"] and nb["edges"]["left"]:
                if rng.random() < continuity_strength:
                    pairs.append(((r, c), (r, c + 1)))
        if r + 1 < GRID_ROWS and (r + 1, c) in grid:
            nb = grid[(r + 1, c)]
            if p["edges"]["bottom"] and nb["edges"]["top"]:
                if rng.random() < continuity_strength:
                    pairs.append(((r, c), (r + 1, c)))
    return pairs


def apply_color_continuity(
    color_cells: list[dict],
    continuity_pairs: list[tuple],
    rng: random.Random,
) -> list[dict]:
    """Force same fg for edge-matched pairs. Must be called after adjacency solver."""
    pos_map = {(c["_row"], c["_col"]): c for c in color_cells}
    for (r1, c1), (r2, c2) in continuity_pairs:
        ca = pos_map.get((r1, c1))
        cb = pos_map.get((r2, c2))
        if ca is None or cb is None:
            continue
        shared_fg = ca["fg"]
        if cb["fg"] != shared_fg:
            cb["fg"] = shared_fg
            if cb["bg"] == shared_fg:
                cb["bg"] = _pick_contrasting_bg(shared_fg, ALL_COLOR_TOKENS, rng)
    return color_cells


# ── Flat SVG Assembly ─────────────────────────────────────
def parse_tile_svg(path: Path) -> etree._Element:
    return etree.parse(str(path), etree.XMLParser(remove_comments=True)).getroot()


def assemble_banner_svg(
    cells: list[CellAssignment],
    tiles_dir: Path,
    dimensions: tuple[int, int],
) -> etree._Element:
    """
    Compose a flat banner SVG (no nested <svg> elements):

      For each cell:
        <rect x y width height fill=bg/>          ← solid background
        <g transform="translate(x,y) scale(1.6) [rotate(N,100,100)]">
          <path d="..." fill=fg/>                  ← tile shape
        </g>

    The scale(1.6) maps tile viewBox [0,200] → cell [0,320].
    Rotation is around tile centre (100,100) in tile space.
    """
    banner_w, banner_h = dimensions

    root = etree.Element("svg", attrib={
        "xmlns":   SVG_NS,
        "version": "1.1",
        "width":   str(banner_w),
        "height":  str(banner_h),
        "viewBox": f"0 0 {banner_w} {banner_h}",
    })

    tile_cache: dict[str, Optional[etree._Element]] = {}

    for cell in sorted(cells, key=lambda c: c.row * GRID_COLS + c.col):
        x = cell.col * CELL_W
        y = cell.row * CELL_H

        # Background
        etree.SubElement(root, "rect", attrib={
            "x": str(x), "y": str(y),
            "width": str(CELL_W), "height": str(CELL_H),
            "fill": cell.bg_color,
        })

        # Foreground path
        cache_key = cell.tile_filename
        if cache_key not in tile_cache:
            try:
                tile_cache[cache_key] = parse_tile_svg(tiles_dir / cell.tile_filename)
            except Exception:
                tile_cache[cache_key] = None

        tile_root = tile_cache[cache_key]
        if tile_root is None:
            continue

        path_elem = tile_root.find(f"{{{SVG_NS}}}path")
        if path_elem is None:
            continue   # empty tile (Clear)

        # Build flat transform: translate → scale → [rotate in tile space]
        scale = CELL_SCALE   # 1.6
        if cell.rotation != 0:
            transform = f"translate({x},{y}) scale({scale}) rotate({cell.rotation},100,100)"
        else:
            transform = f"translate({x},{y}) scale({scale})"

        g = etree.SubElement(root, "g", attrib={"transform": transform})
        path_copy = copy.deepcopy(path_elem)
        path_copy.set("fill", cell.fg_color)
        g.append(path_copy)

    return root


# ── Core Generator ────────────────────────────────────────
def generate_banner(
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    energy: str = "medium",
    seed: Optional[int] = None,
    dimensions: tuple[int, int] = (1920, 960),
    color_bias: Optional[str] = None,
    continuity_strength: float = 0.7,
    template: Optional[str] = None,
) -> tuple[BannerResult, etree._Element]:
    manifest = load_manifest(manifest_path)

    if seed is None:
        seed = random.randint(0, 2 ** 31 - 1)
    rng = random.Random(seed)

    # 1. Choose template
    if template:
        chosen_template = template
    else:
        weights_map = TEMPLATE_ENERGY_WEIGHTS[energy]
        tmps  = [t for t in TEMPLATES if t in weights_map]
        wts   = [weights_map[t] for t in tmps]
        chosen_template = rng.choices(tmps, weights=wts, k=1)[0]

    rotation_pattern = TEMPLATE_CONFIG[chosen_template]["rotation"]

    # 2. Build rotated pool
    rotated_pool = build_rotated_pool(manifest["tiles"])

    # 3. Pick family focus
    primary_families, accent_families = pick_family_focus(manifest["tiles"], chosen_template, rng)

    # 4. Place tiles
    placement = scored_tile_placement(rotated_pool, chosen_template, primary_families, accent_families, rng)
    placement_sorted = sorted(placement, key=lambda p: p["row"] * GRID_COLS + p["col"])
    placement_map    = {(p["row"], p["col"]): p for p in placement_sorted}

    # 5. Build color pool and run adjacency solver
    color_cells = build_color_pool(energy, manifest, rng, color_bias)
    color_cells = apply_adjacency_constraints(color_cells, rng)

    # 6. Apply continuity (after positions are fixed)
    cont_pairs = build_continuity_pairs(placement_sorted, continuity_strength, rng)
    if cont_pairs:
        color_cells = apply_color_continuity(color_cells, cont_pairs, rng)

    # 7. Build CellAssignment list
    cells = []
    for item in color_cells:
        r, c = item["_row"], item["_col"]
        p = placement_map[(r, c)]
        fg_name, bg_name = item["fg"], item["bg"]
        cells.append(CellAssignment(
            col=c, row=r,
            tile_id=p["tile"]["id"],
            tile_filename=p["tile"]["filename"],
            rotation=p["rotation"],
            fg_color=COLOR_TOKEN_TO_HEX[fg_name],
            bg_color=COLOR_TOKEN_TO_HEX[bg_name],
            fg_name=fg_name,
            bg_name=bg_name,
        ))

    # 8. Assemble flat SVG
    banner_root = assemble_banner_svg(cells, tiles_dir, dimensions)

    result = BannerResult(
        output_path=None,
        seed=seed,
        energy=energy,
        template=chosen_template,
        primary_families=primary_families,
        accent_families=accent_families,
        rotation_pattern=rotation_pattern,
        continuity_strength=continuity_strength,
        dimensions=dimensions,
        color_bias=color_bias,
        cells=[asdict(c) for c in cells],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    return result, banner_root


# ── Batch Generation ──────────────────────────────────────
def generate_batch(
    n: int = 20,
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    energy_mix: Optional[dict] = None,
    dimensions: tuple[int, int] = (1920, 960),
    starting_seed: Optional[int] = None,
    continuity_strength: float = 0.7,
    template: Optional[str] = None,
) -> list[BannerResult]:
    if energy_mix is None:
        energy_mix = {"low": 0.3, "medium": 0.5, "high": 0.2}
    output_dir.mkdir(parents=True, exist_ok=True)

    allocations: list[str] = []
    for level, frac in energy_mix.items():
        allocations.extend([level] * round(n * frac))
    while len(allocations) < n:
        allocations.append("medium")
    allocations = allocations[:n]
    random.Random(starting_seed or 0).shuffle(allocations)

    results = []
    for i, energy_level in enumerate(allocations):
        seed = (starting_seed or 1000) + i
        result, banner_root = generate_banner(
            manifest_path=manifest_path,
            tiles_dir=tiles_dir,
            energy=energy_level,
            seed=seed,
            dimensions=dimensions,
            continuity_strength=continuity_strength,
            template=template,
        )
        fname = f"banner-{i+1:03d}-{energy_level}-{result.template}-s{seed}"
        svg_path = output_dir / f"{fname}.svg"
        svg_path.write_bytes(etree.tostring(banner_root, xml_declaration=True, encoding="UTF-8", pretty_print=True))
        result.output_path = str(svg_path)

        json_path = output_dir / f"{fname}.json"
        with open(json_path, "w") as f:
            json.dump(asdict(result), f, indent=2)

        results.append(result)
        if (i + 1) % 10 == 0 or (i + 1) == n:
            print(f"  Generated {i+1}/{n}")

    return results


# ── Main ──────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI Banner Generator v3")
    parser.add_argument("--energy", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--dimensions", type=int, nargs=2, default=[1920, 960])
    parser.add_argument("--color-bias", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--template", choices=TEMPLATES, default=None)
    parser.add_argument("--continuity-strength", type=float, default=0.7)

    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--energy-mix", type=str, default=None)
    parser.add_argument("--starting-seed", type=int, default=None)

    parser.add_argument("--manifest",   type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tiles-dir",  type=Path, default=DEFAULT_TILES_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)

    args = parser.parse_args()

    if args.batch:
        energy_mix = json.loads(args.energy_mix) if args.energy_mix else None
        print(f"Generating {args.batch} banners...")
        results = generate_batch(
            n=args.batch,
            manifest_path=args.manifest,
            tiles_dir=args.tiles_dir,
            output_dir=args.output_dir,
            energy_mix=energy_mix,
            dimensions=tuple(args.dimensions),
            starting_seed=args.starting_seed,
            continuity_strength=args.continuity_strength,
            template=args.template,
        )
        print(f"\nBatch complete → {args.output_dir}")
        tmpl_counts = Counter(r.template for r in results)
        fam_counts  = Counter(f for r in results for f in r.primary_families)
        for t, c in sorted(tmpl_counts.items(), key=lambda x: -x[1]):
            print(f"  {t}: {c}")
        print("Primary families:", dict(sorted(fam_counts.items(), key=lambda x: -x[1])[:8]))

    else:
        print(f"Generating banner (energy={args.energy}, seed={args.seed})...")
        result, banner_root = generate_banner(
            manifest_path=args.manifest,
            tiles_dir=args.tiles_dir,
            energy=args.energy,
            seed=args.seed,
            dimensions=tuple(args.dimensions),
            color_bias=args.color_bias,
            continuity_strength=args.continuity_strength,
            template=args.template,
        )

        out_dir = args.output_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        svg_path = Path(args.output) if args.output else \
                   out_dir / f"banner-{args.energy}-{result.template}-s{result.seed}.svg"
        svg_path.write_bytes(etree.tostring(banner_root, xml_declaration=True, encoding="UTF-8", pretty_print=True))
        result.output_path = str(svg_path)
        with open(svg_path.with_suffix(".json"), "w") as f:
            json.dump(asdict(result), f, indent=2)

        print(f"Banner:    {svg_path}")
        print(f"Template:  {result.template}  ({result.rotation_pattern} rotation)")
        print(f"Families:  primary={result.primary_families}  accent={result.accent_families}")
        print(f"Seed:      {result.seed}")
        rot_counts = Counter(c["rotation"] for c in result.cells)
        print(f"Rotations: {dict(sorted(rot_counts.items()))}")
        fg_counts  = Counter(c["fg_name"] for c in result.cells)
        print("Fg colors:", dict(sorted(fg_counts.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()
