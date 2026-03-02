#!/usr/bin/env python3
"""
Phase 3: FAI Banner Generator (v2)

Generates on-brand 6×3 grid banner compositions from simplified shape tiles.
Improvements over v1:
  - Tile rotation (0/90/180/270°) quadruples the effective tile library
  - Scored edge-matching placement creates visual shape continuity across cells
  - Continuity groups: adjacent cells with matched edges share a fg color
  - Compositional templates (river, focal, symmetric, gradient, checkerboard, cluster)
  - Simplified tile support: bg rect drawn per cell, fg path placed on top
  - Integer pixel positions (cell_w=320, cell_h=320 at 1920×960)

Usage:
    python generate_banner.py --energy medium --seed 42
    python generate_banner.py --batch 50 --manifest tiles-manifest-v2.json
    python generate_banner.py --energy high --template river --continuity-strength 0.8
"""

import argparse
import copy
import json
import math
import random
import sys
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS, WARM_COLORS, COOL_COLORS, NEUTRAL_COLORS, HEX_TO_NAME

# ── Constants ─────────────────────────────────────────────
SVG_NS = "http://www.w3.org/2000/svg"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST  = BASE_DIR / "tiles-manifest-v2.json"
DEFAULT_TILES_DIR = BASE_DIR / "output" / "shapes-simplified"
DEFAULT_OUTPUT_DIR = BASE_DIR / "output" / "banners-generated"

GRID_COLS   = 6
GRID_ROWS   = 3
TOTAL_SLOTS = GRID_COLS * GRID_ROWS   # 18
TILE_VB_W   = 200
TILE_VB_H   = 200
CELL_W      = 320   # 1920 / 6 — exact integer
CELL_H      = 320   # 960 / 3 — exact integer

ROTATIONS = [0, 90, 180, 270]
TEMPLATES = ["river", "focal", "symmetric", "gradient", "checkerboard", "cluster"]

# Energy-level template affinity weights (template → weight by energy)
TEMPLATE_ENERGY_WEIGHTS = {
    "low":    {"gradient": 3, "symmetric": 3, "focal": 2, "checkerboard": 1, "river": 1, "cluster": 0},
    "medium": {"focal": 3, "river": 3, "symmetric": 2, "checkerboard": 2, "gradient": 1, "cluster": 1},
    "high":   {"river": 3, "cluster": 3, "checkerboard": 2, "focal": 2, "symmetric": 1, "gradient": 1},
}

ALL_COLOR_TOKENS   = list(BRAND_COLORS.keys())
COLOR_TOKEN_TO_HEX = BRAND_COLORS.copy()
COLOR_HEX_TO_TOKEN = {v: k for k, v in BRAND_COLORS.items()}

TILE_FG_HEX = "#121212"


# ── Rotation edge mapping ─────────────────────────────────
# After rotation R, the new edge at position P comes from original edge SOURCE[R][P].
EDGE_ROTATION_SOURCE = {
    0:   {"top": "top",    "right": "right",  "bottom": "bottom", "left": "left"},
    90:  {"top": "right",  "right": "bottom", "bottom": "left",   "left": "top"},
    180: {"top": "bottom", "right": "left",   "bottom": "top",    "left": "right"},
    270: {"top": "left",   "right": "top",    "bottom": "right",  "left": "bottom"},
}


def rotate_edges(edge_type: dict, coverage: dict, rotation: int) -> tuple[dict, dict]:
    """Return edge_type and edge_coverage after applying rotation."""
    src = EDGE_ROTATION_SOURCE[rotation]
    new_type = {new: edge_type[src[new]] for new in ("top", "right", "bottom", "left")}
    new_cov  = {new: coverage[src[new]]  for new in ("top", "right", "bottom", "left")}
    return new_type, new_cov


# ── Data Classes ──────────────────────────────────────────
@dataclass
class RotatedTile:
    tile: dict
    rotation: int
    edges: dict      # boolean per edge after rotation
    coverage: dict   # float per edge after rotation


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
    """
    Build pool of (tile, rotation) candidates.
    Skips empty tiles. De-duplicates rotations that are visually identical
    by symmetry metadata to avoid bloat (not strictly needed but nice).
    """
    pool = []
    for tile in tiles:
        if tile["shape_family"] == "lines" and "clear" in tile["id"]:
            continue  # Skip the empty tile

        sym = tile.get("symmetry", "none")
        edge_type = tile.get("edge_type", {"top": False, "right": False, "bottom": False, "left": False})
        edge_cov  = tile.get("edge_coverage", {"top": 0.0, "right": 0.0, "bottom": 0.0, "left": 0.0})

        # Determine which rotations produce distinct visual results
        if sym == "both":
            effective_rotations = [0]  # All rotations identical
        elif sym in ("horizontal", "vertical"):
            effective_rotations = [0, 90]  # Two distinct orientations
        elif sym == "rotational":
            effective_rotations = [0, 90]  # 0° and 180° identical; 90° and 270° identical
        else:
            effective_rotations = ROTATIONS

        for r in effective_rotations:
            re_type, re_cov = rotate_edges(edge_type, edge_cov, r)
            pool.append(RotatedTile(
                tile=tile,
                rotation=r,
                edges=re_type,
                coverage=re_cov,
            ))

    return pool


# ── Template Weights ──────────────────────────────────────
def select_template(energy: str, rng: random.Random, force: Optional[str] = None) -> str:
    if force:
        return force
    weights_map = TEMPLATE_ENERGY_WEIGHTS[energy]
    templates = list(weights_map.keys())
    weights   = [weights_map[t] for t in templates]
    return rng.choices(templates, weights=weights, k=1)[0]


def make_position_weights(template: str) -> list[float]:
    """
    Returns 18 position weights [row-major, row0=top, col0=left].
    Higher = prefer heavier/more-connected tiles at this position.
    """
    weights = [1.0] * 18

    if template == "river":
        # Diagonal band from top-left to bottom-right
        for pos in range(18):
            row, col = pos // GRID_COLS, pos % GRID_COLS
            # Diagonal at slope 0.5 (6 cols, 3 rows)
            diag_dist = abs(col / (GRID_COLS - 1) - row / max(GRID_ROWS - 1, 1))
            weights[pos] = max(0.3, 2.0 - diag_dist * 3.0)

    elif template == "focal":
        # Heavy tiles toward center
        for pos in range(18):
            row, col = pos // GRID_COLS, pos % GRID_COLS
            dist = math.sqrt((col - 2.5) ** 2 + (row - 1.0) ** 2)
            weights[pos] = max(0.3, 2.5 - dist * 0.55)

    elif template == "symmetric":
        # Symmetric about vertical center; matching cols get same weight
        for pos in range(18):
            row, col = pos // GRID_COLS, pos % GRID_COLS
            # Slight upward bias for variety
            weights[pos] = 1.0 + 0.3 * (1 - row / (GRID_ROWS - 1))

    elif template == "gradient":
        # Visual weight increases left → right
        for pos in range(18):
            col = pos % GRID_COLS
            weights[pos] = 0.4 + col * 0.28

    elif template == "checkerboard":
        # Alternating high/low weight positions
        for pos in range(18):
            row, col = pos // GRID_COLS, pos % GRID_COLS
            weights[pos] = 1.8 if (row + col) % 2 == 0 else 0.4

    elif template == "cluster":
        # Dense cluster in top-right quadrant
        for pos in range(18):
            row, col = pos // GRID_COLS, pos % GRID_COLS
            if row < 2 and col >= 3:
                weights[pos] = 2.2
            else:
                weights[pos] = 0.5

    return weights


def placement_order(template: str) -> list[int]:
    """Return position indices in placement order for the given template."""
    if template == "river":
        # Place along diagonal bands first
        return sorted(range(18), key=lambda p: abs((p % GRID_COLS) / (GRID_COLS - 1) - (p // GRID_COLS) / max(GRID_ROWS - 1, 1)))
    elif template == "focal":
        # Place from center outward
        return sorted(range(18), key=lambda p: (
            (p % GRID_COLS - 2.5) ** 2 + (p // GRID_COLS - 1.0) ** 2
        ))
    else:
        return list(range(18))   # row-major


# ── Scored Tile Placement ─────────────────────────────────
def score_candidate(
    cand: RotatedTile,
    placed: dict,           # (row, col) → RotatedTile
    row: int, col: int,
    template: str,
    pos_weight: float,
    family_counts: dict,
    used_keys: set,
) -> float:
    edges = cand.edges
    score = 1.0

    # ─ Edge matching with left neighbor ─
    if col > 0 and (row, col - 1) in placed:
        left_rt = placed[(row, col - 1)]
        our_left   = edges["left"]
        their_right = left_rt.edges["right"]
        if our_left and their_right:
            # Both shapes touch the shared boundary → visual continuity
            score += 3.0 * (cand.coverage["left"] + left_rt.coverage["right"]) / 2.0
        elif not our_left and not their_right:
            score += 0.5   # Clean gap — fine
        else:
            score -= 0.5   # Awkward termination

    # ─ Edge matching with top neighbor ─
    if row > 0 and (row - 1, col) in placed:
        top_rt = placed[(row - 1, col)]
        our_top    = edges["top"]
        their_bottom = top_rt.edges["bottom"]
        if our_top and their_bottom:
            score += 3.0 * (cand.coverage["top"] + top_rt.coverage["bottom"]) / 2.0
        elif not our_top and not their_bottom:
            score += 0.5
        else:
            score -= 0.5

    # ─ Position weight × tile visual weight ─
    tile_weight = cand.tile.get("visual_weight", 0.1)
    score += pos_weight * tile_weight * 1.5

    # ─ Family diversity penalty ─
    family = cand.tile["shape_family"]
    score -= family_counts.get(family, 0) * 0.4

    # ─ Slight penalty for exact tile+rotation reuse ─
    key = (cand.tile["filename"], cand.rotation)
    if key in used_keys:
        score -= 1.5

    # ─ For symmetric template: penalise tiles with no symmetry ─
    if template == "symmetric":
        sym = cand.tile.get("symmetry", "none")
        if sym in ("vertical", "both"):
            score += 1.0

    return max(0.01, score)


def scored_tile_placement(
    rotated_pool: list[RotatedTile],
    template: str,
    rng: random.Random,
    top_k: int = 12,
) -> list[dict]:
    """
    Greedy scored placement with edge-matching.
    Returns list of {row, col, tile, rotation, edges, coverage} dicts.
    """
    pos_weights = make_position_weights(template)
    order       = placement_order(template)
    placed      = {}   # (row, col) → RotatedTile
    family_counts: dict[str, int] = {}
    used_keys: set = set()
    result = []

    for pos in order:
        row, col = pos // GRID_COLS, pos % GRID_COLS
        pw = pos_weights[pos]

        scores = [
            score_candidate(c, placed, row, col, template, pw, family_counts, used_keys)
            for c in rotated_pool
        ]

        # Weighted random from top-k
        indexed = sorted(enumerate(scores), key=lambda x: -x[1])[:top_k]
        top_i  = [i for i, _ in indexed]
        top_s  = [s for _, s in indexed]

        chosen_idx = rng.choices(top_i, weights=top_s, k=1)[0]
        chosen = rotated_pool[chosen_idx]

        placed[(row, col)] = chosen
        family_counts[chosen.tile["shape_family"]] = family_counts.get(chosen.tile["shape_family"], 0) + 1
        used_keys.add((chosen.tile["filename"], chosen.rotation))

        result.append({
            "row": row, "col": col,
            "tile": chosen.tile,
            "rotation": chosen.rotation,
            "edges": chosen.edges,
            "coverage": chosen.coverage,
        })

    return result


# ── Color Palette ─────────────────────────────────────────
def build_color_pool(energy: str, manifest: dict, rng: random.Random, color_bias: Optional[str] = None) -> list[dict]:
    spec = manifest["energy_levels"][energy]
    if energy == "low":
        return _build_low_palette(spec, rng, color_bias)
    elif energy == "medium":
        return _build_medium_palette(spec, rng, color_bias)
    else:
        return _build_high_palette(spec, rng, color_bias)


def _build_low_palette(spec, rng, bias):
    dominant_options = spec["required_dominant"]
    dominant = rng.choice(dominant_options)
    bg_pool  = ["white", "smoke_white"] if dominant in ("cod_gray",) else ["cod_gray"]
    bg_dom   = rng.choice(bg_pool)
    accent   = "international_orange"
    n_accent = rng.randint(spec["accent_tile_range"][0], spec["accent_tile_range"][1])
    cells = [{"fg": dominant, "bg": bg_dom}] * (TOTAL_SLOTS - n_accent)
    cells += [{"fg": accent, "bg": dominant}] * n_accent
    rng.shuffle(cells)
    return cells


def _build_medium_palette(spec, rng, bias):
    num_colors = rng.randint(spec["color_count_range"][0], spec["color_count_range"][1])
    required = ["international_orange", "cod_gray"]
    pool = [c for c in ALL_COLOR_TOKENS if c not in required]
    rng.shuffle(pool)
    chosen = required + pool[:num_colors - len(required)]
    if bias and bias not in chosen:
        chosen[-1] = bias
    return _distribute_colors(chosen, TOTAL_SLOTS, spec["max_single_color_tiles"], spec["orange_tile_range"], rng)


def _build_high_palette(spec, rng, bias):
    num_colors = rng.randint(spec["color_count_range"][0], spec["color_count_range"][1])
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
        cands = [c for c in colors if counts[c] < max_per_color] or colors
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
    candidates = [c for c in preferred if c != fg_name] or [c for c in available if c != fg_name] or ["cod_gray"]
    return rng.choice(candidates)


# ── Color Continuity ──────────────────────────────────────
def build_continuity_pairs(placement: list[dict], continuity_strength: float, rng: random.Random) -> list[tuple]:
    """
    Return list of position-pairs ((r1,c1),(r2,c2)) where both tiles touch the shared edge
    AND the pair passes the continuity_strength probability gate.
    """
    grid = {(p["row"], p["col"]): p for p in placement}
    pairs = []
    for p in placement:
        r, c = p["row"], p["col"]
        # Right neighbor: our right vs their left
        if c + 1 < GRID_COLS and (r, c + 1) in grid:
            nb = grid[(r, c + 1)]
            if p["edges"]["right"] and nb["edges"]["left"]:
                if rng.random() < continuity_strength:
                    pairs.append(((r, c), (r, c + 1)))
        # Bottom neighbor: our bottom vs their top
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
    """
    Force same fg_name for edge-matched continuity pairs.

    Must be called AFTER apply_adjacency_constraints so that each cell
    has '_row'/'_col' assigned and positions are fixed.
    Continuity may introduce intentional same-fg adjacent pairs (by design).
    """
    # Build mutable position map
    pos_map: dict[tuple, dict] = {(c["_row"], c["_col"]): c for c in color_cells}

    for (r1, c1), (r2, c2) in continuity_pairs:
        cell_a = pos_map.get((r1, c1))
        cell_b = pos_map.get((r2, c2))
        if cell_a is None or cell_b is None:
            continue
        # Propagate the earlier position's fg to the later one
        shared_fg = cell_a["fg"]
        if cell_b["fg"] != shared_fg:
            cell_b["fg"] = shared_fg
            if cell_b["bg"] == shared_fg:
                cell_b["bg"] = _pick_contrasting_bg(shared_fg, ALL_COLOR_TOKENS, rng)

    return color_cells


# ── Adjacency Constraint ──────────────────────────────────
def apply_adjacency_constraints(cells: list[dict], rng: random.Random, max_iter: int = 150) -> list[dict]:
    """
    Reorder cells on grid to minimise same-fg adjacent pairs, using iterative swaps.
    cells must be in row-major order (index = row*GRID_COLS + col).
    """
    grid = [list(cells[r * GRID_COLS:(r + 1) * GRID_COLS]) for r in range(GRID_ROWS)]

    for _ in range(max_iter):
        violations = _count_violations(grid)
        if violations == 0:
            break
        for row in range(GRID_ROWS):
            for col in range(GRID_COLS):
                if _has_conflict(grid, row, col):
                    sr, sc = rng.randint(0, GRID_ROWS - 1), rng.randint(0, GRID_COLS - 1)
                    if (sr, sc) != (row, col):
                        grid[row][col], grid[sr][sc] = grid[sr][sc], grid[row][col]
                        if _count_violations(grid) >= violations:
                            grid[row][col], grid[sr][sc] = grid[sr][sc], grid[row][col]

    result = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            item = dict(grid[row][col])
            item["_row"] = row
            item["_col"] = col
            result.append(item)
    return result


def _count_violations(grid):
    count = 0
    for r in range(GRID_ROWS):
        for c in range(GRID_COLS):
            if _has_conflict(grid, r, c):
                count += 1
    return count


def _has_conflict(grid, r, c):
    fg = grid[r][c]["fg"]
    if c + 1 < GRID_COLS and grid[r][c + 1]["fg"] == fg:
        return True
    if r + 1 < GRID_ROWS and grid[r + 1][c]["fg"] == fg:
        return True
    return False


# ── SVG Assembly ──────────────────────────────────────────
def parse_tile_svg(path: Path) -> etree._Element:
    parser = etree.XMLParser(remove_comments=True)
    return etree.parse(str(path), parser).getroot()


def assemble_banner_svg(
    cells: list[CellAssignment],
    tiles_dir: Path,
    dimensions: tuple[int, int],
) -> etree._Element:
    """
    Assemble the banner SVG from simplified tiles.

    Each cell is rendered as:
      1. <rect> for background color
      2. Nested <svg> with the tile's single <path> (rotated if needed)

    Using nested <svg> with viewBox="0 0 200 200" handles scaling automatically.
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

        # 1. Background rect
        etree.SubElement(root, "rect", attrib={
            "x": str(x), "y": str(y),
            "width": str(CELL_W), "height": str(CELL_H),
            "fill": cell.bg_color,
        })

        # 2. Load tile path
        tile_path = tiles_dir / cell.tile_filename
        cache_key = cell.tile_filename
        if cache_key not in tile_cache:
            try:
                tile_cache[cache_key] = parse_tile_svg(tile_path)
            except Exception:
                tile_cache[cache_key] = None

        tile_root = tile_cache[cache_key]
        if tile_root is None:
            continue

        # Find the single <path> in the simplified tile
        path_elem = tile_root.find(f"{{{SVG_NS}}}path")
        if path_elem is None:
            continue  # Empty tile (Clear)

        # 3. Nested <svg> preserves the 200×200 viewBox + handles scaling
        cell_svg = etree.SubElement(root, "svg", attrib={
            "x":       str(x),
            "y":       str(y),
            "width":   str(CELL_W),
            "height":  str(CELL_H),
            "viewBox": f"0 0 {TILE_VB_W} {TILE_VB_H}",
            "overflow": "hidden",
        })

        # 4. Recolored + optionally rotated foreground path
        path_copy = copy.deepcopy(path_elem)
        # Normalise fill to fg_hex
        fill = path_copy.get("fill", TILE_FG_HEX).upper()
        if fill in (TILE_FG_HEX.upper(), ""):
            path_copy.set("fill", cell.fg_color)
        else:
            path_copy.set("fill", cell.fg_color)  # Simplified tiles always use fg

        # Apply rotation around tile center (100, 100)
        if cell.rotation != 0:
            path_copy.set("transform", f"rotate({cell.rotation},100,100)")

        cell_svg.append(path_copy)

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
) -> tuple["BannerResult", etree._Element]:
    """Generate a single banner. Returns (BannerResult, SVG element)."""
    manifest = load_manifest(manifest_path)

    if seed is None:
        seed = random.randint(0, 2 ** 31 - 1)
    rng = random.Random(seed)

    # 1. Choose template
    chosen_template = select_template(energy, rng, force=template)

    # 2. Build rotated tile pool
    rotated_pool = build_rotated_pool(manifest["tiles"])

    # 3. Place tiles with edge-matching
    placement = scored_tile_placement(rotated_pool, chosen_template, rng)

    # 4. Build initial color assignments (18 cells, row-major)
    placement_sorted = sorted(placement, key=lambda p: p["row"] * GRID_COLS + p["col"])
    color_cells = build_color_pool(energy, manifest, rng, color_bias)

    # 5. Apply adjacency constraint FIRST (fixes _row/_col per cell)
    color_cells = apply_adjacency_constraints(color_cells, rng)

    # 6. Apply color continuity AFTER positions are locked
    #    This may introduce intentional same-fg pairs at matched edges (by design)
    cont_pairs = build_continuity_pairs(placement_sorted, continuity_strength, rng)
    if cont_pairs:
        color_cells = apply_color_continuity(color_cells, cont_pairs, rng)

    # 7. Build CellAssignment objects, merging tile placement + colors
    placement_map = {(p["row"], p["col"]): p for p in placement_sorted}

    cells = []
    for item in color_cells:
        r, c = item["_row"], item["_col"]
        p = placement_map[(r, c)]
        fg_name = item["fg"]
        bg_name = item["bg"]
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

    # 8. Assemble SVG
    banner_root = assemble_banner_svg(cells, tiles_dir, dimensions)

    result = BannerResult(
        output_path=None,
        seed=seed,
        energy=energy,
        template=chosen_template,
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

    rng = random.Random(starting_seed or 0)
    rng.shuffle(allocations)

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
            print(f"  Generated {i+1}/{n} banners")

    return results


# ── Main ──────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI Banner Generator v2")
    parser.add_argument("--energy", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--dimensions", type=int, nargs=2, default=[1920, 960])
    parser.add_argument("--color-bias", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--template", choices=TEMPLATES, default=None, help="Force a compositional template")
    parser.add_argument("--continuity-strength", type=float, default=0.7,
                        help="0.0–1.0: probability that edge-matched pairs share fg color (default 0.7)")

    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--energy-mix", type=str, default=None,
                        help='JSON: {"low":0.3,"medium":0.5,"high":0.2}')
    parser.add_argument("--starting-seed", type=int, default=None)

    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tiles-dir", type=Path, default=DEFAULT_TILES_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)

    args = parser.parse_args()

    if args.batch:
        energy_mix = json.loads(args.energy_mix) if args.energy_mix else None
        print(f"Generating batch of {args.batch} banners...")
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
        print(f"\nBatch complete: {len(results)} banners → {args.output_dir}")
        by_energy = {}
        by_template = {}
        for r in results:
            by_energy[r.energy] = by_energy.get(r.energy, 0) + 1
            by_template[r.template] = by_template.get(r.template, 0) + 1
        for e, c in sorted(by_energy.items()):
            print(f"  {e}: {c}")
        print("  Templates:", dict(sorted(by_template.items(), key=lambda x: -x[1])))

    else:
        print(f"Generating single banner (energy={args.energy}, seed={args.seed})...")
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

        if args.output:
            svg_path = Path(args.output)
        else:
            svg_path = out_dir / f"banner-{args.energy}-{result.template}-s{result.seed}.svg"

        svg_path.write_bytes(etree.tostring(banner_root, xml_declaration=True, encoding="UTF-8", pretty_print=True))
        result.output_path = str(svg_path)

        json_path = svg_path.with_suffix(".json")
        with open(json_path, "w") as f:
            json.dump(asdict(result), f, indent=2)

        print(f"Banner:    {svg_path}")
        print(f"Metadata:  {json_path}")
        print(f"Seed:      {result.seed}")
        print(f"Template:  {result.template}")
        print(f"Continuity strength: {result.continuity_strength}")

        color_counts: dict[str, int] = {}
        rot_counts:   dict[int, int]  = {}
        for c in result.cells:
            color_counts[c["fg_name"]] = color_counts.get(c["fg_name"], 0) + 1
            rot_counts[c["rotation"]] = rot_counts.get(c["rotation"], 0) + 1
        print("Foreground colors:")
        for name, cnt in sorted(color_counts.items(), key=lambda x: -x[1]):
            print(f"  {name}: {cnt}")
        print("Rotations used:", dict(sorted(rot_counts.items())))


if __name__ == "__main__":
    main()
