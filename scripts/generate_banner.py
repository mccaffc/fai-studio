#!/usr/bin/env python3
"""
Phase 3: FAI Banner Generator

Generates on-brand 6x3 grid banner compositions from simplified shape tiles.
The generator now works as a small generate-and-score pipeline:

  - choose a template and family focus
  - limit each banner to a small reusable tile palette
  - place tiles with exact rotation patterns for motif templates
  - select short continuity chains from genuine edge matches
  - assign colors jointly across continuity groups
  - score several candidates and keep the best one
"""

import argparse
import json
import math
import random
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS, WARM_COLORS, COOL_COLORS

# - Constants ---------------------------------------------------------------
SVG_NS = "http://www.w3.org/2000/svg"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = BASE_DIR / "tiles-manifest-v2.json"
DEFAULT_TILES_DIR = BASE_DIR / "output" / "shapes-simplified"
DEFAULT_OUTPUT_DIR = BASE_DIR / "output" / "banners-generated"

GRID_COLS = 6
GRID_ROWS = 3
TOTAL_SLOTS = GRID_COLS * GRID_ROWS
TILE_VB_W = 200
TILE_VB_H = 200
CELL_W = 320
CELL_H = 320
CELL_SCALE = CELL_W / TILE_VB_W

ROTATIONS = [0, 90, 180, 270]
POWER_POSITIONS = {(0, 1), (0, 4), (1, 3), (2, 0), (2, 5)}

ALL_COLOR_TOKENS = list(BRAND_COLORS.keys())
COLOR_TOKEN_TO_HEX = BRAND_COLORS.copy()

MOTIF_TEMPLATES = {
    "pinwheel",
    "spiral",
    "mirror",
    "symmetric",
    "flow",
    "river",
    "checkerboard",
}

FLOW_FAMILIES = {"wave", "curve", "lines", "cascade", "ramp", "angle", "open"}
GEOMETRIC_FAMILIES = {"square", "rectangle", "circle", "mirror", "float", "composition", "centric"}

COLOR_IMPACT = {
    "international_orange": 1.0,
    "celestial_blue": 0.95,
    "chrome_yellow": 0.9,
    "cod_gray": 0.8,
    "timberwolf": 0.55,
    "smoke_white": 0.45,
    "white": 0.4,
}

GRADIENT_COLOR_ORDER = [
    "cod_gray",
    "celestial_blue",
    "international_orange",
    "chrome_yellow",
    "timberwolf",
    "smoke_white",
    "white",
]

# After rotation R, new edge P comes from original edge SOURCE[R][P].
EDGE_ROTATION_SOURCE = {
    0: {"top": "top", "right": "right", "bottom": "bottom", "left": "left"},
    90: {"top": "right", "right": "bottom", "bottom": "left", "left": "top"},
    180: {"top": "bottom", "right": "left", "bottom": "top", "left": "right"},
    270: {"top": "left", "right": "top", "bottom": "right", "left": "bottom"},
}

ROTATION_PATTERN_FNS = {
    "pinwheel": lambda r, c: (r * 2 + c) % 4,
    "spiral": lambda r, c: c % 4,
    "mirror": lambda r, c: c % 4 if c < GRID_COLS // 2 else (GRID_COLS - 1 - c) % 4,
    "flow": lambda r, c: (r + c) % 2 * 2,
    "checker90": lambda r, c: (r + c) % 2 * 2,
    "diagonal": lambda r, c: (r + c) % 4,
    "free": None,
}

TEMPLATES = [
    "pinwheel",
    "spiral",
    "mirror",
    "symmetric",
    "flow",
    "river",
    "checkerboard",
    "focal",
    "scatter",
    "gradient",
]

TEMPLATE_CONFIG = {
    "pinwheel": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "pinwheel",
        "motif": True,
        "rotation_strict": True,
    },
    "spiral": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "spiral",
        "motif": True,
        "rotation_strict": True,
    },
    "mirror": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "mirror",
        "motif": True,
        "rotation_strict": True,
    },
    "symmetric": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "mirror",
        "motif": True,
        "rotation_strict": True,
    },
    "flow": {
        "primary_fam": (1, 1),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "flow",
        "motif": True,
        "rotation_strict": True,
    },
    "river": {
        "primary_fam": (1, 1),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "flow",
        "motif": True,
        "rotation_strict": True,
    },
    "checkerboard": {
        "primary_fam": (1, 2),
        "accent_fam": (0, 1),
        "primary_tiles": (3, 4),
        "accent_tiles": (0, 1),
        "rotation": "checker90",
        "motif": True,
        "rotation_strict": True,
    },
    "focal": {
        "primary_fam": (2, 3),
        "accent_fam": (1, 2),
        "primary_tiles": (4, 5),
        "accent_tiles": (1, 2),
        "rotation": "free",
        "motif": False,
        "rotation_strict": False,
    },
    "scatter": {
        "primary_fam": (2, 4),
        "accent_fam": (0, 2),
        "primary_tiles": (4, 6),
        "accent_tiles": (0, 2),
        "rotation": "free",
        "motif": False,
        "rotation_strict": False,
    },
    "gradient": {
        "primary_fam": (2, 3),
        "accent_fam": (0, 1),
        "primary_tiles": (4, 5),
        "accent_tiles": (0, 1),
        "rotation": "diagonal",
        "motif": False,
        "rotation_strict": False,
    },
}

TEMPLATE_ENERGY_WEIGHTS = {
    "low": {
        "flow": 3,
        "river": 3,
        "mirror": 2,
        "symmetric": 2,
        "focal": 1,
        "gradient": 1,
        "checkerboard": 1,
        "pinwheel": 1,
        "spiral": 1,
        "scatter": 0,
    },
    "medium": {
        "pinwheel": 2,
        "spiral": 2,
        "mirror": 2,
        "symmetric": 2,
        "flow": 2,
        "river": 2,
        "checkerboard": 2,
        "focal": 2,
        "gradient": 2,
        "scatter": 1,
    },
    "high": {
        "pinwheel": 2,
        "spiral": 2,
        "checkerboard": 2,
        "scatter": 3,
        "gradient": 3,
        "focal": 2,
        "mirror": 1,
        "symmetric": 1,
        "flow": 1,
        "river": 1,
    },
}


# - Data classes ------------------------------------------------------------
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
class CandidateBanner:
    template: str
    primary_families: list[str]
    accent_families: list[str]
    placement: list[dict]
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]]
    cells: list[CellAssignment]
    score: float
    score_breakdown: dict[str, float] = field(default_factory=dict)


@dataclass
class BannerResult:
    output_path: Optional[str]
    seed: int
    energy: str
    template: str
    primary_families: list[str]
    accent_families: list[str]
    rotation_pattern: str
    continuity_strength: float
    candidate_count: int
    dimensions: tuple[int, int]
    color_bias: Optional[str]
    score: float
    score_breakdown: dict[str, float]
    cells: list
    generated_at: str


# - Small helpers -----------------------------------------------------------
def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def pair_key(a: tuple[int, int], b: tuple[int, int]) -> tuple[tuple[int, int], tuple[int, int]]:
    return (a, b) if a <= b else (b, a)


def color_temperature(color_name: str) -> str:
    color_hex = COLOR_TOKEN_TO_HEX[color_name]
    if color_hex in WARM_COLORS or color_name in ("international_orange", "chrome_yellow"):
        return "warm"
    if color_hex in COOL_COLORS or color_name == "celestial_blue":
        return "cool"
    return "neutral"


def rotate_edges(edge_type: dict, coverage: dict, rotation: int) -> tuple[dict, dict]:
    src = EDGE_ROTATION_SOURCE[rotation]
    new_type = {edge: edge_type[src[edge]] for edge in ("top", "right", "bottom", "left")}
    new_cov = {edge: coverage[src[edge]] for edge in ("top", "right", "bottom", "left")}
    return new_type, new_cov


def weighted_sample_without_replacement(items, weights, k: int, rng: random.Random):
    pool = list(zip(items, weights))
    chosen = []
    for _ in range(min(k, len(pool))):
        idx = rng.choices(
            range(len(pool)),
            weights=[max(weight, 0.001) for _, weight in pool],
            k=1,
        )[0]
        item, _ = pool.pop(idx)
        chosen.append(item)
    return chosen


class UnionFind:
    def __init__(self, items):
        self.parent = {item: item for item in items}
        self.sizes = {item: 1 for item in items}

    def find(self, item):
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, a, b):
        ra = self.find(a)
        rb = self.find(b)
        if ra == rb:
            return ra
        if self.sizes[ra] < self.sizes[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.sizes[ra] += self.sizes[rb]
        return ra

    def size(self, item) -> int:
        return self.sizes[self.find(item)]


# - Manifest ----------------------------------------------------------------
def load_manifest(path: Path) -> dict:
    with open(path) as handle:
        return json.load(handle)


def choose_template(energy: str, rng: random.Random, override: Optional[str]) -> str:
    if override:
        return override
    weights_map = TEMPLATE_ENERGY_WEIGHTS[energy]
    templates = [name for name in TEMPLATES if weights_map.get(name, 0) > 0]
    weights = [weights_map[name] for name in templates]
    return rng.choices(templates, weights=weights, k=1)[0]


# - Rotated tile pool -------------------------------------------------------
def build_rotated_pool(tiles: list[dict]) -> list[RotatedTile]:
    pool = []
    for tile in tiles:
        if tile.get("shape_family") == "lines" and "clear" in tile.get("id", ""):
            continue

        symmetry = tile.get("symmetry", "none")
        edge_type = tile.get("edge_type", {edge: False for edge in ("top", "right", "bottom", "left")})
        edge_cov = tile.get("edge_coverage", {edge: 0.0 for edge in ("top", "right", "bottom", "left")})

        if symmetry == "both":
            rotations = [0]
        elif symmetry in ("horizontal", "vertical", "rotational"):
            rotations = [0, 90]
        else:
            rotations = ROTATIONS

        for rotation in rotations:
            rotated_type, rotated_cov = rotate_edges(edge_type, edge_cov, rotation)
            pool.append(
                RotatedTile(
                    tile=tile,
                    rotation=rotation,
                    edges=rotated_type,
                    coverage=rotated_cov,
                )
            )
    return pool


# - Family and tile palette selection ---------------------------------------
def family_weight_for_template(template: str, family: str, family_size: int) -> float:
    weight = float(family_size)
    if template in {"flow", "river"} and family in FLOW_FAMILIES:
        weight *= 2.2
    elif template in {"pinwheel", "spiral", "mirror", "symmetric", "checkerboard"} and family in GEOMETRIC_FAMILIES:
        weight *= 1.9
    elif template in {"focal", "gradient"} and family in GEOMETRIC_FAMILIES | FLOW_FAMILIES:
        weight *= 1.2
    elif template == "scatter":
        weight *= 1.0
    return max(weight, 0.1)


def pick_family_focus(
    tiles: list[dict],
    template: str,
    rng: random.Random,
) -> tuple[list[str], list[str]]:
    cfg = TEMPLATE_CONFIG[template]
    family_tiles = defaultdict(list)

    for tile in tiles:
        family = tile.get("shape_family", "")
        if not family or (family == "lines" and "clear" in tile.get("id", "")):
            continue
        family_tiles[family].append(tile)

    families = list(family_tiles)
    weights = [family_weight_for_template(template, family, len(family_tiles[family])) for family in families]

    n_primary = rng.randint(*cfg["primary_fam"])
    primary = weighted_sample_without_replacement(families, weights, n_primary, rng)

    accent_candidates = [family for family in families if family not in primary]
    accent_weights = [len(family_tiles[family]) for family in accent_candidates]
    n_accent = rng.randint(*cfg["accent_fam"])
    accent = weighted_sample_without_replacement(accent_candidates, accent_weights, n_accent, rng)
    return primary, accent


def tile_palette_weight(tile: dict, template: str, role: str) -> float:
    weight = 1.0 + tile.get("visual_weight", 0.0) * 2.0
    edges = tile.get("edge_type", {})
    active_edges = sum(1 for edge in ("top", "right", "bottom", "left") if edges.get(edge))

    if role == "primary":
        weight += 0.8
    else:
        weight += 0.2

    if template in {"flow", "river"}:
        if edges.get("left") and edges.get("right"):
            weight += 2.0
        if edges.get("top") and edges.get("bottom"):
            weight += 1.0

    if template in {"mirror", "symmetric"} and tile.get("symmetry") in ("vertical", "horizontal", "both"):
        weight += 1.2

    if template in {"pinwheel", "spiral", "checkerboard"}:
        if active_edges >= 2:
            weight += 0.8
        if tile.get("shape_family") in GEOMETRIC_FAMILIES:
            weight += 0.6

    if template == "focal":
        weight += tile.get("visual_weight", 0.0) * 2.5

    if template == "scatter":
        weight += max(0.0, 0.35 - abs(tile.get("visual_weight", 0.0) - 0.18))

    if template == "gradient":
        weight += max(0.0, 0.4 - abs(tile.get("visual_weight", 0.0) - 0.22))

    if tile.get("complexity") == "complex" and template in MOTIF_TEMPLATES:
        weight -= 0.4

    if active_edges == 0:
        weight -= 0.8

    return max(weight, 0.05)


def pick_tile_palette(
    tiles: list[dict],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
) -> list[dict]:
    cfg = TEMPLATE_CONFIG[template]
    n_primary_tiles = rng.randint(*cfg["primary_tiles"])
    n_accent_tiles = rng.randint(*cfg["accent_tiles"])

    primary_pool = [tile for tile in tiles if tile.get("shape_family") in primary_families]
    accent_pool = [tile for tile in tiles if tile.get("shape_family") in accent_families]

    chosen = []
    if primary_pool:
        chosen.extend(
            weighted_sample_without_replacement(
                primary_pool,
                [tile_palette_weight(tile, template, "primary") for tile in primary_pool],
                n_primary_tiles,
                rng,
            )
        )

    accent_pool = [tile for tile in accent_pool if tile["id"] not in {item["id"] for item in chosen}]
    if accent_pool and n_accent_tiles:
        chosen.extend(
            weighted_sample_without_replacement(
                accent_pool,
                [tile_palette_weight(tile, template, "accent") for tile in accent_pool],
                n_accent_tiles,
                rng,
            )
        )

    if len(chosen) < 3:
        remainder = [tile for tile in primary_pool if tile["id"] not in {item["id"] for item in chosen}]
        chosen.extend(
            weighted_sample_without_replacement(
                remainder,
                [tile_palette_weight(tile, template, "primary") for tile in remainder],
                3 - len(chosen),
                rng,
            )
        )

    return chosen or tiles


# - Tile placement ----------------------------------------------------------
def make_position_weights(template: str) -> list[float]:
    weights = [1.0] * TOTAL_SLOTS
    if template == "focal":
        for pos in range(TOTAL_SLOTS):
            row, col = divmod(pos, GRID_COLS)
            dist = math.sqrt((col - 2.5) ** 2 + (row - 1.0) ** 2)
            weights[pos] = max(0.3, 2.5 - dist * 0.55)
    elif template == "river":
        for pos in range(TOTAL_SLOTS):
            row, col = divmod(pos, GRID_COLS)
            weights[pos] = 1.75 if row == 1 else 0.85
            if col in (2, 3):
                weights[pos] += 0.2
    elif template == "gradient":
        for pos in range(TOTAL_SLOTS):
            row, col = divmod(pos, GRID_COLS)
            weights[pos] = 0.9 + col * 0.08 + row * 0.04
    return weights


def placement_order(template: str, position_weights: list[float]) -> list[int]:
    order = list(range(TOTAL_SLOTS))
    if template in {"focal", "gradient"}:
        order.sort(key=lambda pos: position_weights[pos], reverse=True)
    elif template == "river":
        order.sort(key=lambda pos: (position_weights[pos], -(pos % GRID_COLS)), reverse=True)
    return order


def score_candidate(
    candidate: RotatedTile,
    placed: dict,
    row: int,
    col: int,
    primary_families: list[str],
    accent_families: list[str],
    target_rotation: Optional[int],
    rotation_counts: Counter,
    tile_counts: Counter,
    template: str,
    pos_weight: float,
) -> float:
    family = candidate.tile.get("shape_family", "")
    tile_id = candidate.tile.get("id", "")

    if family in primary_families:
        score = 9.0
    elif family in accent_families:
        score = 3.0
    else:
        score = -20.0

    if target_rotation is not None:
        score += 4.0 if candidate.rotation == target_rotation else -6.0
    else:
        score += max(0.0, 1.5 - rotation_counts.get(candidate.rotation, 0) * 0.25)

    uses = tile_counts.get(tile_id, 0)
    if uses == 0:
        score += 1.4
    elif uses <= 3:
        score += 0.6
    else:
        score -= 0.9 * (uses - 2)

    for neighbor_offset, our_edge, their_edge in [
        ((0, -1), "left", "right"),
        ((-1, 0), "top", "bottom"),
    ]:
        nr = row + neighbor_offset[0]
        nc = col + neighbor_offset[1]
        if (nr, nc) not in placed:
            continue
        neighbor = placed[(nr, nc)]
        our_active = candidate.edges[our_edge]
        their_active = neighbor.edges[their_edge]
        if our_active and their_active:
            match = (candidate.coverage[our_edge] + neighbor.coverage[their_edge]) / 2
            score += 2.2 * match
            if template == "river" and our_edge in ("left", "right"):
                score += 0.35 * match
        elif not our_active and not their_active:
            score += 0.15
        else:
            score -= 0.8

        if neighbor.tile.get("id") == tile_id:
            score -= 1.0

    score += candidate.tile.get("visual_weight", 0.0) * pos_weight
    return max(score, 0.01)


def scored_tile_placement(
    rotated_pool: list[RotatedTile],
    template: str,
    primary_families: list[str],
    accent_families: list[str],
    rng: random.Random,
    top_k: int = 10,
) -> list[dict]:
    cfg = TEMPLATE_CONFIG[template]
    rotation_fn = ROTATION_PATTERN_FNS[cfg["rotation"]]
    position_weights = make_position_weights(template)
    order = placement_order(template, position_weights)

    placed = {}
    rotation_counts = Counter()
    tile_counts = Counter()

    for pos in order:
        row, col = divmod(pos, GRID_COLS)
        target_rotation = ROTATIONS[rotation_fn(row, col)] if rotation_fn is not None else None

        candidates = rotated_pool
        if cfg["rotation_strict"] and target_rotation is not None:
            exact = [candidate for candidate in rotated_pool if candidate.rotation == target_rotation]
            if exact:
                candidates = exact

        scored = []
        for candidate in candidates:
            score = score_candidate(
                candidate,
                placed,
                row,
                col,
                primary_families,
                accent_families,
                target_rotation,
                rotation_counts,
                tile_counts,
                template,
                position_weights[pos],
            )
            scored.append((candidate, score))

        top = sorted(scored, key=lambda item: item[1], reverse=True)[: max(4, min(top_k, len(scored)))]
        choice = rng.choices([candidate for candidate, _ in top], weights=[score for _, score in top], k=1)[0]
        placed[(row, col)] = choice
        rotation_counts[choice.rotation] += 1
        tile_counts[choice.tile["id"]] += 1

    result = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            chosen = placed[(row, col)]
            result.append(
                {
                    "row": row,
                    "col": col,
                    "tile": chosen.tile,
                    "rotation": chosen.rotation,
                    "edges": chosen.edges,
                    "coverage": chosen.coverage,
                }
            )
    return result


# - Continuity grouping -----------------------------------------------------
def matched_edge_candidates(placement: list[dict], template: str, rng: random.Random):
    grid = {(item["row"], item["col"]): item for item in placement}
    candidates = []

    for item in placement:
        row = item["row"]
        col = item["col"]

        if col + 1 < GRID_COLS:
            neighbor = grid[(row, col + 1)]
            if item["edges"]["right"] and neighbor["edges"]["left"]:
                coverage = (item["coverage"]["right"] + neighbor["coverage"]["left"]) / 2
                score = coverage
                if template in {"flow", "river"}:
                    score += 0.25
                if template == "river" and row == 1:
                    score += 0.35
                candidates.append((score + rng.random() * 0.05, (row, col), (row, col + 1), "h"))

        if row + 1 < GRID_ROWS:
            neighbor = grid[(row + 1, col)]
            if item["edges"]["bottom"] and neighbor["edges"]["top"]:
                coverage = (item["coverage"]["bottom"] + neighbor["coverage"]["top"]) / 2
                score = coverage
                if template in {"mirror", "symmetric", "focal"}:
                    score += 0.15
                candidates.append((score + rng.random() * 0.05, (row, col), (row + 1, col), "v"))

    return candidates


def build_continuity_pairs(
    placement: list[dict],
    template: str,
    continuity_strength: float,
    rng: random.Random,
) -> list[tuple[tuple[int, int], tuple[int, int]]]:
    candidates = sorted(matched_edge_candidates(placement, template, rng), reverse=True)
    if not candidates:
        return []

    all_positions = [(row, col) for row in range(GRID_ROWS) for col in range(GRID_COLS)]
    union_find = UnionFind(all_positions)
    degree = Counter()

    base_target = round(len(candidates) * (0.10 + continuity_strength * 0.35))
    target_pairs = max(1, min(7, base_target))
    max_degree = 2 if template in MOTIF_TEMPLATES else 1
    max_group_size = 4 if template in {"flow", "river"} else 3 if template in MOTIF_TEMPLATES else 2

    selected = []
    for _, a, b, _ in candidates:
        if len(selected) >= target_pairs:
            break
        if degree[a] >= max_degree or degree[b] >= max_degree:
            continue
        if union_find.find(a) != union_find.find(b) and union_find.size(a) + union_find.size(b) > max_group_size:
            continue
        union_find.union(a, b)
        degree[a] += 1
        degree[b] += 1
        selected.append((a, b))

    return selected


def build_continuity_groups(
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]]
) -> tuple[dict, dict]:
    positions = [(row, col) for row in range(GRID_ROWS) for col in range(GRID_COLS)]
    union_find = UnionFind(positions)
    for a, b in continuity_pairs:
        union_find.union(a, b)

    groups = defaultdict(list)
    pos_to_group = {}
    for pos in positions:
        group_id = union_find.find(pos)
        groups[group_id].append(pos)
        pos_to_group[pos] = group_id
    return dict(groups), pos_to_group


def build_group_adjacency(pos_to_group: dict) -> dict:
    adjacency = Counter()
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            current = (row, col)
            g1 = pos_to_group[current]
            for neighbor in ((row, col + 1), (row + 1, col)):
                nr, nc = neighbor
                if nr >= GRID_ROWS or nc >= GRID_COLS:
                    continue
                g2 = pos_to_group[neighbor]
                if g1 == g2:
                    continue
                adjacency[pair_key(g1, g2)] += 1
    return dict(adjacency)


# - Color assignment --------------------------------------------------------
def build_color_targets(
    energy: str,
    rng: random.Random,
    color_bias: Optional[str] = None,
) -> dict[str, int]:
    if energy == "low":
        dominant = rng.choice(["cod_gray", "white", "smoke_white"])
        orange_count = rng.randint(1, 2)
        max_secondary = max(0, TOTAL_SLOTS - orange_count - 12)
        secondary_count = rng.randint(0, min(3, max_secondary))

        targets = {
            dominant: TOTAL_SLOTS - orange_count - secondary_count,
            "international_orange": orange_count,
        }
        if secondary_count:
            allowed = [color for color in ["cod_gray", "white", "smoke_white", "timberwolf"] if color != dominant]
            secondary = color_bias if color_bias in allowed else rng.choice(allowed)
            targets[secondary] = secondary_count
        return targets

    if energy == "medium":
        num_colors = rng.randint(4, 5)
        palette = ["international_orange", "cod_gray"]
        others = [color for color in ALL_COLOR_TOKENS if color not in palette]
        if color_bias and color_bias not in palette and color_bias in others:
            palette.append(color_bias)
            others.remove(color_bias)
        palette.extend(
            weighted_sample_without_replacement(
                others,
                [1.0] * len(others),
                num_colors - len(palette),
                rng,
            )
        )

        targets = {color: 1 for color in palette}
        targets["international_orange"] = rng.randint(2, 4)
        remaining = TOTAL_SLOTS - sum(targets.values())
        while remaining > 0:
            candidates = [color for color in palette if targets[color] < 6]
            chosen = rng.choice(candidates)
            targets[chosen] += 1
            remaining -= 1
        return targets

    num_colors = rng.randint(6, 7)
    palette = ["international_orange", "celestial_blue", "chrome_yellow"]
    others = [color for color in ALL_COLOR_TOKENS if color not in palette]
    if color_bias and color_bias not in palette and color_bias in others:
        palette.append(color_bias)
        others.remove(color_bias)
    palette.extend(
        weighted_sample_without_replacement(
            others,
            [1.0] * len(others),
            num_colors - len(palette),
            rng,
        )
    )

    targets = {color: 1 for color in palette}
    targets["international_orange"] = rng.randint(3, 5)
    remaining = TOTAL_SLOTS - sum(targets.values())
    while remaining > 0:
        candidates = [color for color in palette if targets[color] < 5]
        chosen = rng.choice(candidates)
        targets[chosen] += 1
        remaining -= 1
    return targets


def group_info(groups: dict, adjacency: dict) -> dict:
    neighbor_map = defaultdict(list)
    for (g1, g2), weight in adjacency.items():
        neighbor_map[g1].append((g2, weight))
        neighbor_map[g2].append((g1, weight))

    info = {}
    for group_id, positions in groups.items():
        rows = [row for row, _ in positions]
        cols = [col for _, col in positions]
        anchor = sum(1 for pos in positions if pos in POWER_POSITIONS) / max(1, len(positions))
        middle_row_weight = sum(1 for row in rows if row == 1) / max(1, len(rows))
        info[group_id] = {
            "size": len(positions),
            "avg_row": sum(rows) / len(rows),
            "avg_col": sum(cols) / len(cols),
            "anchor": anchor,
            "middle_row_weight": middle_row_weight,
            "degree": sum(weight for _, weight in neighbor_map[group_id]),
        }
    return info


def group_color_choice_score(
    group_id,
    color_name: str,
    info: dict,
    assigned: dict,
    used_counts: Counter,
    target_counts: dict[str, int],
    adjacency: dict,
    template: str,
    energy: str,
) -> float:
    size = info[group_id]["size"]
    remaining = target_counts.get(color_name, 0) - used_counts[color_name]
    score = min(size, max(remaining, 0)) * 1.6
    score -= max(0, size - max(remaining, 0)) * 1.1

    for (g1, g2), weight in adjacency.items():
        if group_id not in (g1, g2):
            continue
        other = g2 if group_id == g1 else g1
        other_color = assigned.get(other)
        if other_color is None:
            continue
        if other_color == color_name:
            same_penalty = 1.6 if energy == "low" else 2.5
            score -= same_penalty * weight
        else:
            our_temp = color_temperature(color_name)
            other_temp = color_temperature(other_color)
            if our_temp != other_temp and "neutral" not in (our_temp, other_temp):
                bonus = 0.2
                if template == "checkerboard":
                    bonus = 0.35
                score += bonus * weight

    score += info[group_id]["anchor"] * COLOR_IMPACT.get(color_name, 0.5) * 0.8

    if template == "gradient":
        ordered_palette = [color for color in GRADIENT_COLOR_ORDER if color in target_counts]
        rank = ordered_palette.index(color_name)
        goal = round(info[group_id]["avg_col"] / max(1, GRID_COLS - 1) * (len(ordered_palette) - 1))
        score -= abs(rank - goal) * 0.8

    if template == "river" and color_name in ("international_orange", "celestial_blue"):
        score += info[group_id]["middle_row_weight"] * 0.5

    return score


def group_coloring_objective(
    assignments: dict,
    groups: dict,
    adjacency: dict,
    target_counts: dict[str, int],
    template: str,
    energy: str,
) -> float:
    used = Counter()
    for group_id, color_name in assignments.items():
        used[color_name] += len(groups[group_id])

    score = 0.0
    for color_name, target in target_counts.items():
        score -= abs(used[color_name] - target) * 0.65

    for (g1, g2), weight in adjacency.items():
        c1 = assignments[g1]
        c2 = assignments[g2]
        if c1 == c2:
            same_penalty = 1.6 if energy == "low" else 2.4
            score -= same_penalty * weight
        else:
            temp1 = color_temperature(c1)
            temp2 = color_temperature(c2)
            if temp1 != temp2 and "neutral" not in (temp1, temp2):
                bonus = 0.15 if template != "checkerboard" else 0.3
                score += bonus * weight

    if template == "gradient":
        ordered_palette = [color for color in GRADIENT_COLOR_ORDER if color in target_counts]
        for group_id, color_name in assignments.items():
            avg_col = sum(col for _, col in groups[group_id]) / len(groups[group_id])
            goal = round(avg_col / max(1, GRID_COLS - 1) * (len(ordered_palette) - 1))
            score -= abs(ordered_palette.index(color_name) - goal) * 0.6

    return score


def assign_group_colors(
    groups: dict,
    adjacency: dict,
    target_counts: dict[str, int],
    template: str,
    energy: str,
    rng: random.Random,
) -> dict:
    info = group_info(groups, adjacency)
    group_ids = sorted(
        groups,
        key=lambda group_id: (info[group_id]["size"], info[group_id]["degree"], info[group_id]["anchor"]),
        reverse=True,
    )

    assignments = {}
    used_counts = Counter()
    palette = list(target_counts)

    for group_id in group_ids:
        scored = []
        for color_name in palette:
            score = group_color_choice_score(
                group_id,
                color_name,
                info,
                assignments,
                used_counts,
                target_counts,
                adjacency,
                template,
                energy,
            )
            scored.append((color_name, score))

        top = sorted(scored, key=lambda item: item[1], reverse=True)[: max(2, min(3, len(scored)))]
        chosen = rng.choices([color for color, _ in top], weights=[max(score, 0.01) for _, score in top], k=1)[0]
        assignments[group_id] = chosen
        used_counts[chosen] += len(groups[group_id])

    current_score = group_coloring_objective(assignments, groups, adjacency, target_counts, template, energy)
    for _ in range(120):
        trial = dict(assignments)
        if rng.random() < 0.65:
            group_id = rng.choice(group_ids)
            trial[group_id] = rng.choice(palette)
        else:
            g1, g2 = rng.sample(group_ids, 2)
            trial[g1], trial[g2] = trial[g2], trial[g1]
        trial_score = group_coloring_objective(trial, groups, adjacency, target_counts, template, energy)
        if trial_score > current_score:
            assignments = trial
            current_score = trial_score

    return assignments


def preferred_backgrounds(fg_name: str) -> list[str]:
    fg_hex = COLOR_TOKEN_TO_HEX[fg_name]
    if fg_hex in WARM_COLORS or fg_name in ("international_orange", "chrome_yellow"):
        return ["cod_gray", "white", "smoke_white", "timberwolf", "celestial_blue"]
    if fg_hex in COOL_COLORS or fg_name == "celestial_blue":
        return ["cod_gray", "white", "smoke_white", "international_orange", "timberwolf"]
    if fg_name == "cod_gray":
        return ["white", "smoke_white", "timberwolf", "international_orange", "celestial_blue"]
    return ["cod_gray", "international_orange", "celestial_blue", "chrome_yellow", "timberwolf"]


def assign_backgrounds(fg_by_pos: dict, template: str, rng: random.Random) -> dict:
    backgrounds = {}
    positions = [(row, col) for row in range(GRID_ROWS) for col in range(GRID_COLS)]

    if template == "focal":
        positions.sort(key=lambda pos: abs(pos[0] - 1) + abs(pos[1] - 2.5))

    for row, col in positions:
        fg_name = fg_by_pos[(row, col)]
        preferred = [color for color in preferred_backgrounds(fg_name) if color != fg_name]
        candidates = preferred + [color for color in ALL_COLOR_TOKENS if color not in preferred and color != fg_name]

        scored = []
        for bg_name in candidates:
            score = float(len(candidates) - candidates.index(bg_name))
            for neighbor in ((row, col - 1), (row - 1, col)):
                nr, nc = neighbor
                if nr < 0 or nc < 0:
                    continue
                if backgrounds.get(neighbor) == bg_name:
                    score -= 0.35
                if fg_by_pos.get(neighbor) == bg_name:
                    score -= 0.2
            if template == "checkerboard" and (row + col) % 2 == 0 and color_temperature(bg_name) == "neutral":
                score += 0.25
            scored.append((bg_name, score))

        top = sorted(scored, key=lambda item: item[1], reverse=True)[:3]
        chosen = rng.choices([name for name, _ in top], weights=[max(score, 0.01) for _, score in top], k=1)[0]
        backgrounds[(row, col)] = chosen

    return backgrounds


# - Candidate scoring -------------------------------------------------------
def score_rotation_pattern(placement: list[dict], template: str) -> float:
    rotation_fn = ROTATION_PATTERN_FNS[TEMPLATE_CONFIG[template]["rotation"]]
    if rotation_fn is None:
        return 0.7
    matches = 0
    for item in placement:
        expected = ROTATIONS[rotation_fn(item["row"], item["col"])]
        if item["rotation"] == expected:
            matches += 1
    return matches / TOTAL_SLOTS


def score_repetition(placement: list[dict], template: str) -> float:
    counts = Counter(item["tile"]["id"] for item in placement)
    unique_count = len(counts)
    ideal_low, ideal_high = (3, 5) if TEMPLATE_CONFIG[template]["motif"] else (4, 6)
    if ideal_low <= unique_count <= ideal_high:
        unique_score = 1.0
    else:
        midpoint = (ideal_low + ideal_high) / 2
        unique_score = max(0.0, 1.0 - abs(unique_count - midpoint) * 0.18)

    singletons = sum(1 for value in counts.values() if value == 1)
    singleton_penalty = max(0, singletons - 2) * 0.18
    dominant_penalty = max(0, max(counts.values()) - 6) * 0.10
    return clamp01(unique_score - singleton_penalty - dominant_penalty)


def score_weight_balance(placement: list[dict]) -> float:
    row_weights = [0.0] * GRID_ROWS
    left_weight = 0.0
    right_weight = 0.0

    for item in placement:
        weight = item["tile"].get("visual_weight", 0.0)
        row_weights[item["row"]] += weight
        if item["col"] < GRID_COLS / 2:
            left_weight += weight
        else:
            right_weight += weight

    max_row = max(row_weights)
    min_row = min(row_weights)
    row_ratio = min_row / max_row if max_row > 0 else 1.0

    side_ratio = min(left_weight, right_weight) / max(left_weight, right_weight) if max(left_weight, right_weight) > 0 else 1.0
    return clamp01((row_ratio / 0.65 + side_ratio / 0.65) / 2)


def score_continuity(placement: list[dict], continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]]) -> float:
    possible = matched_edge_candidates(placement, "flow", random.Random(0))
    if not possible:
        return 0.5

    possible_target = max(1, min(7, round(len(possible) * 0.35)))
    count_score = 1.0 - abs(len(continuity_pairs) - possible_target) / max(1, possible_target)

    pair_lookup = {pair_key(a, b) for a, b in continuity_pairs}
    grid = {(item["row"], item["col"]): item for item in placement}
    selected_coverages = []
    for a, b in pair_lookup:
        if a[0] == b[0]:
            left, right = (a, b) if a[1] < b[1] else (b, a)
            selected_coverages.append((grid[left]["coverage"]["right"] + grid[right]["coverage"]["left"]) / 2)
        else:
            top, bottom = (a, b) if a[0] < b[0] else (b, a)
            selected_coverages.append((grid[top]["coverage"]["bottom"] + grid[bottom]["coverage"]["top"]) / 2)

    coverage_score = sum(selected_coverages) / max(1, len(selected_coverages)) if selected_coverages else 0.0
    return clamp01(0.55 * count_score + 0.45 * coverage_score)


def score_color_adjacency(
    cells: list[CellAssignment],
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]],
) -> float:
    grid = {(cell.row, cell.col): cell for cell in cells}
    continuity_lookup = {pair_key(a, b) for a, b in continuity_pairs}
    raw = 0.0
    pair_count = 0

    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            current = grid[(row, col)]
            for neighbor in ((row, col + 1), (row + 1, col)):
                nr, nc = neighbor
                if nr >= GRID_ROWS or nc >= GRID_COLS:
                    continue
                other = grid[neighbor]
                pair_count += 1
                if current.fg_name == other.fg_name:
                    if pair_key((row, col), neighbor) in continuity_lookup:
                        raw += 1.0
                    else:
                        raw -= 1.9
                else:
                    raw += 0.75
                    if color_temperature(current.fg_name) != color_temperature(other.fg_name):
                        raw += 0.15

    min_raw = -1.9 * pair_count
    max_raw = 0.9 * pair_count
    return clamp01((raw - min_raw) / (max_raw - min_raw)) if pair_count else 1.0


def score_anchor_distribution(cells: list[CellAssignment], placement: list[dict]) -> float:
    placement_map = {(item["row"], item["col"]): item for item in placement}
    ranked = []
    for cell in cells:
        tile = placement_map[(cell.row, cell.col)]["tile"]
        intensity = tile.get("visual_weight", 0.0) * COLOR_IMPACT.get(cell.fg_name, 0.5)
        ranked.append(((cell.row, cell.col), intensity))

    top = [pos for pos, _ in sorted(ranked, key=lambda item: item[1], reverse=True)[:3]]
    third_count = len({min(2, col // 2) for _, col in top})
    row_count = len({row for row, _ in top})
    power_hits = sum(1 for pos in top if pos in POWER_POSITIONS)
    return clamp01(0.45 * (third_count / 3) + 0.30 * (row_count / 3) + 0.25 * (power_hits / 3))


def score_target_fit(cells: list[CellAssignment], target_counts: dict[str, int]) -> float:
    used = Counter(cell.fg_name for cell in cells)
    delta = sum(abs(used[color] - target_counts.get(color, 0)) for color in target_counts)
    return clamp01(1.0 - delta / (TOTAL_SLOTS * 1.6))


def score_energy_adherence(cells: list[CellAssignment], energy: str) -> float:
    counts = Counter(cell.fg_name for cell in cells)
    unique_colors = len(counts)
    orange = counts.get("international_orange", 0)

    if energy == "low":
        dominant = max(counts.values())
        excluded = counts.get("chrome_yellow", 0) + counts.get("celestial_blue", 0)
        score = 1.0
        if unique_colors > 3:
            score -= 0.35
        if dominant < 12:
            score -= 0.35
        if orange not in (1, 2):
            score -= 0.2
        if excluded:
            score -= 0.3
        return clamp01(score)

    if energy == "medium":
        score = 1.0
        if not 4 <= unique_colors <= 5:
            score -= 0.35
        if not 2 <= orange <= 4:
            score -= 0.25
        if max(counts.values()) > 6:
            score -= 0.25
        return clamp01(score)

    score = 1.0
    if not 6 <= unique_colors <= 7:
        score -= 0.35
    if not 3 <= orange <= 5:
        score -= 0.2
    if counts.get("celestial_blue", 0) == 0 or counts.get("chrome_yellow", 0) == 0:
        score -= 0.3
    return clamp01(score)


def score_candidate_banner(
    cells: list[CellAssignment],
    placement: list[dict],
    continuity_pairs: list[tuple[tuple[int, int], tuple[int, int]]],
    target_counts: dict[str, int],
    template: str,
    energy: str,
) -> tuple[float, dict[str, float]]:
    breakdown = {
        "color_adjacency": score_color_adjacency(cells, continuity_pairs),
        "continuity": score_continuity(placement, continuity_pairs),
        "repetition": score_repetition(placement, template),
        "weight_balance": score_weight_balance(placement),
        "rotation": score_rotation_pattern(placement, template),
        "anchors": score_anchor_distribution(cells, placement),
        "target_fit": score_target_fit(cells, target_counts),
        "energy": score_energy_adherence(cells, energy),
    }

    score = (
        0.22 * breakdown["color_adjacency"]
        + 0.16 * breakdown["continuity"]
        + 0.14 * breakdown["repetition"]
        + 0.14 * breakdown["weight_balance"]
        + 0.10 * breakdown["rotation"]
        + 0.10 * breakdown["anchors"]
        + 0.08 * breakdown["target_fit"]
        + 0.06 * breakdown["energy"]
    )
    return score, breakdown


# - SVG assembly ------------------------------------------------------------
def parse_tile_svg(path: Path) -> etree._Element:
    return etree.parse(str(path), etree.XMLParser(remove_comments=True)).getroot()


def assemble_banner_svg(
    cells: list[CellAssignment],
    tiles_dir: Path,
    dimensions: tuple[int, int],
) -> etree._Element:
    banner_w, banner_h = dimensions
    root = etree.Element(
        "svg",
        attrib={
            "xmlns": SVG_NS,
            "version": "1.1",
            "width": str(banner_w),
            "height": str(banner_h),
            "viewBox": f"0 0 {banner_w} {banner_h}",
        },
    )

    tile_cache: dict[str, Optional[etree._Element]] = {}
    for cell in sorted(cells, key=lambda item: item.row * GRID_COLS + item.col):
        x = cell.col * CELL_W
        y = cell.row * CELL_H

        etree.SubElement(
            root,
            "rect",
            attrib={
                "x": str(x),
                "y": str(y),
                "width": str(CELL_W),
                "height": str(CELL_H),
                "fill": cell.bg_color,
            },
        )

        if cell.tile_filename not in tile_cache:
            try:
                tile_cache[cell.tile_filename] = parse_tile_svg(tiles_dir / cell.tile_filename)
            except Exception:
                tile_cache[cell.tile_filename] = None

        tile_root = tile_cache[cell.tile_filename]
        if tile_root is None:
            continue

        path_elem = tile_root.find(f"{{{SVG_NS}}}path")
        if path_elem is None:
            continue

        transform = f"translate({x},{y}) scale({CELL_SCALE})"
        if cell.rotation:
            transform += f" rotate({cell.rotation},100,100)"
        group = etree.SubElement(root, "g", attrib={"transform": transform})

        attrib = dict(path_elem.attrib)
        attrib["fill"] = cell.fg_color
        etree.SubElement(group, "path", attrib=attrib)

    return root


# - Candidate generation ----------------------------------------------------
def generate_candidate(
    manifest: dict,
    energy: str,
    continuity_strength: float,
    color_bias: Optional[str],
    template_override: Optional[str],
    rng: random.Random,
) -> CandidateBanner:
    template = choose_template(energy, rng, template_override)
    tiles = manifest["tiles"]

    primary_families, accent_families = pick_family_focus(tiles, template, rng)
    tile_palette = pick_tile_palette(tiles, template, primary_families, accent_families, rng)
    rotated_pool = build_rotated_pool(tile_palette)
    placement = scored_tile_placement(rotated_pool, template, primary_families, accent_families, rng)

    continuity_pairs = build_continuity_pairs(placement, template, continuity_strength, rng)
    groups, pos_to_group = build_continuity_groups(continuity_pairs)
    adjacency = build_group_adjacency(pos_to_group)

    target_counts = build_color_targets(energy, rng, color_bias)
    group_colors = assign_group_colors(groups, adjacency, target_counts, template, energy, rng)

    fg_by_pos = {}
    for pos, group_id in pos_to_group.items():
        fg_by_pos[pos] = group_colors[group_id]
    backgrounds = assign_backgrounds(fg_by_pos, template, rng)

    placement_map = {(item["row"], item["col"]): item for item in placement}
    cells = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            item = placement_map[(row, col)]
            fg_name = fg_by_pos[(row, col)]
            bg_name = backgrounds[(row, col)]
            cells.append(
                CellAssignment(
                    col=col,
                    row=row,
                    tile_id=item["tile"]["id"],
                    tile_filename=item["tile"]["filename"],
                    rotation=item["rotation"],
                    fg_color=COLOR_TOKEN_TO_HEX[fg_name],
                    bg_color=COLOR_TOKEN_TO_HEX[bg_name],
                    fg_name=fg_name,
                    bg_name=bg_name,
                )
            )

    score, score_breakdown = score_candidate_banner(
        cells,
        placement,
        continuity_pairs,
        target_counts,
        template,
        energy,
    )

    return CandidateBanner(
        template=template,
        primary_families=primary_families,
        accent_families=accent_families,
        placement=placement,
        continuity_pairs=continuity_pairs,
        cells=cells,
        score=score,
        score_breakdown=score_breakdown,
    )


# - Public API --------------------------------------------------------------
def generate_banner(
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    energy: str = "medium",
    seed: Optional[int] = None,
    dimensions: tuple[int, int] = (1920, 960),
    color_bias: Optional[str] = None,
    continuity_strength: float = 0.7,
    template: Optional[str] = None,
    candidate_count: int = 16,
) -> tuple[BannerResult, etree._Element]:
    manifest = load_manifest(manifest_path)

    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    master_rng = random.Random(seed)

    best_candidate = None
    for _ in range(max(1, candidate_count)):
        candidate_rng = random.Random(master_rng.randint(0, 2**31 - 1))
        candidate = generate_candidate(
            manifest=manifest,
            energy=energy,
            continuity_strength=continuity_strength,
            color_bias=color_bias,
            template_override=template,
            rng=candidate_rng,
        )
        if best_candidate is None or candidate.score > best_candidate.score:
            best_candidate = candidate

    assert best_candidate is not None
    rotation_pattern = TEMPLATE_CONFIG[best_candidate.template]["rotation"]
    banner_root = assemble_banner_svg(best_candidate.cells, tiles_dir, dimensions)

    result = BannerResult(
        output_path=None,
        seed=seed,
        energy=energy,
        template=best_candidate.template,
        primary_families=best_candidate.primary_families,
        accent_families=best_candidate.accent_families,
        rotation_pattern=rotation_pattern,
        continuity_strength=continuity_strength,
        candidate_count=max(1, candidate_count),
        dimensions=dimensions,
        color_bias=color_bias,
        score=best_candidate.score,
        score_breakdown=best_candidate.score_breakdown,
        cells=[asdict(cell) for cell in best_candidate.cells],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )
    return result, banner_root


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
    candidate_count: int = 16,
) -> list[BannerResult]:
    if energy_mix is None:
        energy_mix = {"low": 0.3, "medium": 0.5, "high": 0.2}

    output_dir.mkdir(parents=True, exist_ok=True)

    allocations = []
    for energy_level, fraction in energy_mix.items():
        allocations.extend([energy_level] * round(n * fraction))
    while len(allocations) < n:
        allocations.append("medium")
    allocations = allocations[:n]
    random.Random(starting_seed or 0).shuffle(allocations)

    results = []
    for index, energy_level in enumerate(allocations):
        seed = (starting_seed or 1000) + index
        result, banner_root = generate_banner(
            manifest_path=manifest_path,
            tiles_dir=tiles_dir,
            energy=energy_level,
            seed=seed,
            dimensions=dimensions,
            continuity_strength=continuity_strength,
            template=template,
            candidate_count=candidate_count,
        )

        filename = f"banner-{index + 1:03d}-{energy_level}-{result.template}-s{seed}"
        svg_path = output_dir / f"{filename}.svg"
        svg_path.write_bytes(etree.tostring(banner_root, xml_declaration=True, encoding="UTF-8", pretty_print=True))
        result.output_path = str(svg_path)

        json_path = output_dir / f"{filename}.json"
        with open(json_path, "w") as handle:
            json.dump(asdict(result), handle, indent=2)

        results.append(result)
        if (index + 1) % 10 == 0 or (index + 1) == n:
            print(f"  Generated {index + 1}/{n}")

    return results


# - CLI ---------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="FAI Banner Generator")
    parser.add_argument("--energy", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--dimensions", type=int, nargs=2, default=[1920, 960])
    parser.add_argument("--color-bias", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)
    parser.add_argument("--template", choices=TEMPLATES, default=None)
    parser.add_argument("--continuity-strength", type=float, default=0.7)
    parser.add_argument("--candidate-count", type=int, default=16)

    parser.add_argument("--batch", type=int, default=None)
    parser.add_argument("--energy-mix", type=str, default=None)
    parser.add_argument("--starting-seed", type=int, default=None)

    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tiles-dir", type=Path, default=DEFAULT_TILES_DIR)
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
            candidate_count=args.candidate_count,
        )
        print(f"\nBatch complete -> {args.output_dir}")
        template_counts = Counter(result.template for result in results)
        family_counts = Counter(family for result in results for family in result.primary_families)
        for template_name, count in sorted(template_counts.items(), key=lambda item: (-item[1], item[0])):
            print(f"  {template_name}: {count}")
        print("Primary families:", dict(sorted(family_counts.items(), key=lambda item: (-item[1], item[0]))[:8]))
        return

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
        candidate_count=args.candidate_count,
    )

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    svg_path = Path(args.output) if args.output else output_dir / f"banner-{args.energy}-{result.template}-s{result.seed}.svg"
    svg_path.write_bytes(etree.tostring(banner_root, xml_declaration=True, encoding="UTF-8", pretty_print=True))
    result.output_path = str(svg_path)

    with open(svg_path.with_suffix(".json"), "w") as handle:
        json.dump(asdict(result), handle, indent=2)

    print(f"Banner:    {svg_path}")
    print(f"Template:  {result.template}  ({result.rotation_pattern} rotation)")
    print(f"Families:  primary={result.primary_families}  accent={result.accent_families}")
    print(f"Seed:      {result.seed}")
    print(f"Score:     {result.score:.3f}")
    rotation_counts = Counter(cell["rotation"] for cell in result.cells)
    print(f"Rotations: {dict(sorted(rotation_counts.items()))}")
    fg_counts = Counter(cell["fg_name"] for cell in result.cells)
    print("Fg colors:", dict(sorted(fg_counts.items(), key=lambda item: (-item[1], item[0]))))


if __name__ == "__main__":
    main()
