#!/usr/bin/env python3
"""
Phase 3: FAI Banner Generator

Generates on-brand 6x3 grid banner compositions from cleaned shape tiles,
applying configurable energy levels (color density), adjacency constraints,
and visual weight distribution.

Usage:
    # Single banner
    python generate_banner.py --energy medium --seed 42

    # Batch generation
    python generate_banner.py --batch 50 --energy-mix '{"low":0.3,"medium":0.5,"high":0.2}'

    # With options
    python generate_banner.py --energy high --seed 100 --dimensions 3000 1500 --color-bias international_orange
"""

import argparse
import copy
import json
import math
import os
import random
import sys
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from lxml import etree

# ── Resolve imports ──────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS, WARM_COLORS, COOL_COLORS, NEUTRAL_COLORS, HEX_TO_NAME

# ── Constants ────────────────────────────────────────────
SVG_NS = "http://www.w3.org/2000/svg"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_MANIFEST = BASE_DIR / "tiles-manifest.json"
DEFAULT_TILES_DIR = BASE_DIR / "output" / "shapes-clean"
DEFAULT_OUTPUT_DIR = BASE_DIR / "output" / "banners-generated"

# Grid dimensions
GRID_COLS = 6
GRID_ROWS = 3
TOTAL_SLOTS = GRID_COLS * GRID_ROWS  # 18

# Source tile viewBox
TILE_VB_W = 200
TILE_VB_H = 200

# Color tokens for constraint logic
ALL_COLOR_TOKENS = list(BRAND_COLORS.keys())
COLOR_TOKEN_TO_HEX = BRAND_COLORS.copy()
COLOR_HEX_TO_TOKEN = {v: k for k, v in BRAND_COLORS.items()}

# The two colors used in cleaned tiles (pre-recolor)
TILE_FG_HEX = "#121212"  # Cod Gray — foreground shapes
TILE_BG_HEX = "#F3F3F3"  # Smoke White — background rect


# ── Data Classes ─────────────────────────────────────────
@dataclass
class CellAssignment:
    col: int
    row: int
    tile_id: str
    tile_filename: str
    fg_color: str       # hex
    bg_color: str       # hex
    fg_name: str        # token name
    bg_name: str        # token name


@dataclass
class BannerResult:
    output_path: Optional[str]
    seed: int
    energy: str
    dimensions: tuple
    color_bias: Optional[str]
    cells: list
    generated_at: str


# ── Manifest Loading ─────────────────────────────────────
def load_manifest(path: Path) -> dict:
    with open(path) as f:
        return json.load(f)


# ── Color Palette Selection ──────────────────────────────
def build_color_pool(
    energy: str,
    manifest: dict,
    rng: random.Random,
    color_bias: Optional[str] = None,
) -> list[dict]:
    """
    Build a list of 18 color assignments (fg_name, bg_name pairs)
    respecting energy-level constraints.

    Returns a list of dicts with 'fg' and 'bg' token names.
    """
    energy_spec = manifest["energy_levels"][energy]

    if energy == "low":
        return _build_low_palette(energy_spec, rng, color_bias)
    elif energy == "medium":
        return _build_medium_palette(energy_spec, rng, color_bias)
    elif energy == "high":
        return _build_high_palette(energy_spec, rng, color_bias)
    else:
        raise ValueError(f"Unknown energy level: {energy}")


def _build_low_palette(spec: dict, rng: random.Random, bias: Optional[str]) -> list[str]:
    """Low energy: monochrome + accent. Max 3 colors, 12+ dominant."""
    # Pick dominant color
    dominant_options = spec["required_dominant"]
    dominant = rng.choice(dominant_options)

    # Pick a contrasting background for the dominant
    if dominant in ("cod_gray",):
        bg_pool = ["white", "smoke_white", "timberwolf"]
    else:
        bg_pool = ["cod_gray"]

    bg_dominant = rng.choice(bg_pool)

    # Accent is always orange
    accent = "international_orange"
    accent_count = rng.randint(spec["accent_tile_range"][0], spec["accent_tile_range"][1])
    dominant_count = TOTAL_SLOTS - accent_count

    # Build the 18-cell color list
    cells = []
    for _ in range(dominant_count):
        cells.append({"fg": dominant, "bg": bg_dominant})
    for _ in range(accent_count):
        # Accent cells: orange foreground on dominant background
        cells.append({"fg": accent, "bg": dominant})

    rng.shuffle(cells)
    return cells


def _build_medium_palette(spec: dict, rng: random.Random, bias: Optional[str]) -> list[str]:
    """Medium energy: 4-5 colors, balanced distribution."""
    num_colors = rng.randint(spec["color_count_range"][0], spec["color_count_range"][1])

    # Always include orange and a dark base
    required = ["international_orange", "cod_gray"]
    pool = [c for c in ALL_COLOR_TOKENS if c not in required]
    rng.shuffle(pool)
    chosen = required + pool[:num_colors - len(required)]

    if bias and bias not in chosen:
        chosen[-1] = bias  # Replace last optional with bias color

    # Distribute tiles across colors
    cells = _distribute_colors(
        chosen, TOTAL_SLOTS,
        max_per_color=spec["max_single_color_tiles"],
        orange_range=spec["orange_tile_range"],
        rng=rng,
    )
    return cells


def _build_high_palette(spec: dict, rng: random.Random, bias: Optional[str]) -> list[str]:
    """High energy: full palette, 6-7 colors, all represented."""
    num_colors = rng.randint(spec["color_count_range"][0], spec["color_count_range"][1])

    # Start with required colors
    required = ["international_orange", "celestial_blue", "chrome_yellow"]
    pool = [c for c in ALL_COLOR_TOKENS if c not in required]
    rng.shuffle(pool)
    chosen = required + pool[:num_colors - len(required)]

    if bias and bias not in chosen:
        chosen[-1] = bias

    cells = _distribute_colors(
        chosen, TOTAL_SLOTS,
        max_per_color=5,
        orange_range=spec["orange_tile_range"],
        rng=rng,
        min_per_color=1,
    )
    return cells


def _distribute_colors(
    colors: list[str],
    total: int,
    max_per_color: int,
    orange_range: list[int],
    rng: random.Random,
    min_per_color: int = 0,
) -> list[dict]:
    """
    Distribute `total` cells across `colors`, returning fg/bg pairs.
    """
    n = len(colors)
    counts = {c: min_per_color for c in colors}
    remaining = total - sum(counts.values())

    # Set orange count within range
    if "international_orange" in counts:
        orange_min, orange_max = orange_range
        current_orange = counts["international_orange"]
        target_orange = rng.randint(orange_min, orange_max)
        additional_orange = max(0, target_orange - current_orange)
        counts["international_orange"] = current_orange + additional_orange
        remaining -= additional_orange

    # Distribute remaining randomly
    while remaining > 0:
        candidates = [c for c in colors if counts[c] < max_per_color]
        if not candidates:
            # All at max — allow overflow on random
            candidates = colors
        c = rng.choice(candidates)
        counts[c] += 1
        remaining -= 1

    # Build cell list with fg/bg pairings
    cells = []
    for fg_name, count in counts.items():
        for _ in range(count):
            bg_name = _pick_contrasting_bg(fg_name, colors, rng)
            cells.append({"fg": fg_name, "bg": bg_name})

    rng.shuffle(cells)
    return cells


def _pick_contrasting_bg(fg_name: str, available: list[str], rng: random.Random) -> str:
    """Pick a background color that contrasts with the foreground."""
    fg_hex = COLOR_TOKEN_TO_HEX[fg_name]

    # Strong contrast rules
    if fg_hex in WARM_COLORS or fg_hex in {"#FF4F00", "#FFA300"}:
        # Warm foreground → prefer dark or neutral background
        preferred = ["cod_gray", "white", "smoke_white", "timberwolf"]
    elif fg_hex in COOL_COLORS:
        preferred = ["cod_gray", "white", "smoke_white", "international_orange"]
    elif fg_name == "cod_gray":
        preferred = ["white", "smoke_white", "timberwolf", "international_orange"]
    elif fg_name in ("white", "smoke_white", "timberwolf"):
        preferred = ["cod_gray", "international_orange", "celestial_blue"]
    else:
        preferred = [c for c in available if c != fg_name]

    # Filter to available colors and exclude same as fg
    candidates = [c for c in preferred if c != fg_name]
    if not candidates:
        candidates = [c for c in available if c != fg_name]
    if not candidates:
        candidates = ["cod_gray"] if fg_name != "cod_gray" else ["white"]

    return rng.choice(candidates)


# ── Tile Selection ───────────────────────────────────────
def select_tiles(
    tiles: list[dict],
    total: int,
    rng: random.Random,
) -> list[dict]:
    """
    Select `total` tiles from the manifest, favoring diversity
    of shape families and visual weights.
    """
    # Weight selection toward less-used families
    family_counts: dict[str, int] = {}
    selected = []

    available = list(tiles)

    for i in range(total):
        if not available:
            available = list(tiles)  # Allow repeats after exhaustion

        # Score candidates: penalize repeated families
        scores = []
        for t in available:
            family = t["shape_family"]
            penalty = family_counts.get(family, 0) * 2.0
            # Small bonus for medium-weight tiles (more visually interesting)
            weight_bonus = 0.5 if t["weight_band"] == "medium" else 0.0
            # Avoid clear tiles most of the time
            clear_penalty = 3.0 if t["shape_family"] == "clear" else 0.0
            score = max(0.1, 1.0 - penalty + weight_bonus - clear_penalty)
            scores.append(score)

        # Weighted random selection
        chosen_idx = rng.choices(range(len(available)), weights=scores, k=1)[0]
        chosen = available[chosen_idx]
        selected.append(chosen)

        family = chosen["shape_family"]
        family_counts[family] = family_counts.get(family, 0) + 1

        # Remove from available to reduce immediate repeats
        available.pop(chosen_idx)

    return selected


# ── Adjacency Constraint Solver ──────────────────────────
def apply_adjacency_constraints(
    cells: list[dict],
    rng: random.Random,
    max_iterations: int = 200,
) -> list[dict]:
    """
    Reorder cells on the 6x3 grid so no two adjacent cells share
    the same foreground color. Uses iterative swapping.
    """
    grid = [[None] * GRID_COLS for _ in range(GRID_ROWS)]

    # Place cells in grid (row-major order initially)
    idx = 0
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            grid[row][col] = cells[idx]
            idx += 1

    # Iterative improvement
    for iteration in range(max_iterations):
        violations = _count_violations(grid)
        if violations == 0:
            break

        # Find a violation and try to fix it by swapping
        for row in range(GRID_ROWS):
            for col in range(GRID_COLS):
                if _has_adjacent_conflict(grid, row, col):
                    # Try swapping with a random non-conflicting cell
                    swap_row = rng.randint(0, GRID_ROWS - 1)
                    swap_col = rng.randint(0, GRID_COLS - 1)
                    if (swap_row, swap_col) != (row, col):
                        # Tentative swap
                        grid[row][col], grid[swap_row][swap_col] = \
                            grid[swap_row][swap_col], grid[row][col]
                        new_violations = _count_violations(grid)
                        if new_violations >= violations:
                            # Undo if no improvement
                            grid[row][col], grid[swap_row][swap_col] = \
                                grid[swap_row][swap_col], grid[row][col]

    # Flatten back to list
    result = []
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            cell = grid[row][col]
            cell["_col"] = col
            cell["_row"] = row
            result.append(cell)

    return result


def _count_violations(grid) -> int:
    count = 0
    for row in range(GRID_ROWS):
        for col in range(GRID_COLS):
            if _has_adjacent_conflict(grid, row, col):
                count += 1
    return count


def _has_adjacent_conflict(grid, row, col) -> bool:
    fg = grid[row][col]["fg"]
    # Check right neighbor
    if col + 1 < GRID_COLS and grid[row][col + 1]["fg"] == fg:
        return True
    # Check bottom neighbor
    if row + 1 < GRID_ROWS and grid[row + 1][col]["fg"] == fg:
        return True
    return False


# ── SVG Assembly ─────────────────────────────────────────
def recolor_tile_svg(
    tile_root: etree._Element,
    fg_hex: str,
    bg_hex: str,
) -> etree._Element:
    """
    Deep copy a tile SVG tree and replace the standard foreground/background
    colors with the assigned colors.
    """
    root = copy.deepcopy(tile_root)

    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue

        fill = elem.get("fill")
        if fill:
            upper = fill.upper()
            if upper == TILE_FG_HEX:
                elem.set("fill", fg_hex)
            elif upper == TILE_BG_HEX:
                elem.set("fill", bg_hex)
            elif upper == "#FFFFFF":
                # clipPath rects — leave as is (alpha-only)
                pass
            elif upper == TILE_BG_HEX.upper():
                elem.set("fill", bg_hex)

    return root


def assemble_banner_svg(
    cells: list[CellAssignment],
    tiles_dir: Path,
    dimensions: tuple[int, int],
) -> etree._Element:
    """
    Compose the final banner SVG from 18 recolored tiles
    using nested <svg> elements for each cell.
    """
    banner_w, banner_h = dimensions
    cell_w = banner_w / GRID_COLS
    cell_h = banner_h / GRID_ROWS

    # Create root SVG
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

    # Parse and place each tile
    tile_cache: dict[str, etree._Element] = {}

    for cell in cells:
        # Load tile SVG (cached)
        tile_path = tiles_dir / cell.tile_filename
        if cell.tile_filename not in tile_cache:
            tile_cache[cell.tile_filename] = parse_tile_svg(tile_path)

        tile_root = tile_cache[cell.tile_filename]

        # Recolor
        recolored = recolor_tile_svg(
            tile_root,
            cell.fg_color,
            cell.bg_color,
        )

        # Calculate position
        x = cell.col * cell_w
        y = cell.row * cell_h

        # Create nested <svg> for this cell
        cell_svg = etree.SubElement(root, "svg", attrib={
            "x": str(x),
            "y": str(y),
            "width": str(cell_w),
            "height": str(cell_h),
            "viewBox": f"0 0 {TILE_VB_W} {TILE_VB_H}",
        })

        # Copy defs and content from the recolored tile into the nested svg
        for child in recolored:
            cell_svg.append(child)

    return root


def parse_tile_svg(path: Path) -> etree._Element:
    """Parse a tile SVG file."""
    parser = etree.XMLParser(remove_comments=True)
    tree = etree.parse(str(path), parser)
    return tree.getroot()


# ── Core Generator ───────────────────────────────────────
def generate_banner(
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    energy: str = "medium",
    seed: Optional[int] = None,
    output_format: str = "svg",
    dimensions: tuple[int, int] = (1920, 960),
    color_bias: Optional[str] = None,
) -> BannerResult:
    """
    Generate a single banner composition.
    Returns BannerResult with metadata (SVG not included — written to disk).
    """
    manifest = load_manifest(manifest_path)

    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    rng = random.Random(seed)

    # 1. Build color assignments for 18 cells
    color_cells = build_color_pool(energy, manifest, rng, color_bias)

    # 2. Select 18 tiles
    tiles = manifest["tiles"]
    selected_tiles = select_tiles(tiles, TOTAL_SLOTS, rng)

    # 3. Merge tile selections with color assignments
    merged = []
    for i in range(TOTAL_SLOTS):
        merged.append({
            "tile": selected_tiles[i],
            "fg": color_cells[i]["fg"],
            "bg": color_cells[i]["bg"],
        })

    # 4. Apply adjacency constraints (reorder on grid)
    constrained = apply_adjacency_constraints(merged, rng)

    # 5. Build CellAssignment objects
    cells = []
    for item in constrained:
        col = item.get("_col", 0)
        row = item.get("_row", 0)
        fg_name = item["fg"]
        bg_name = item["bg"]

        cells.append(CellAssignment(
            col=col,
            row=row,
            tile_id=item["tile"]["id"],
            tile_filename=item["tile"]["filename"],
            fg_color=COLOR_TOKEN_TO_HEX[fg_name],
            bg_color=COLOR_TOKEN_TO_HEX[bg_name],
            fg_name=fg_name,
            bg_name=bg_name,
        ))

    # 6. Assemble SVG
    banner_root = assemble_banner_svg(cells, tiles_dir, dimensions)

    result = BannerResult(
        output_path=None,
        seed=seed,
        energy=energy,
        dimensions=dimensions,
        color_bias=color_bias,
        cells=[asdict(c) for c in cells],
        generated_at=datetime.now(timezone.utc).isoformat(),
    )

    return result, banner_root


# ── Batch Generation ─────────────────────────────────────
def generate_batch(
    n: int = 20,
    manifest_path: Path = DEFAULT_MANIFEST,
    tiles_dir: Path = DEFAULT_TILES_DIR,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    energy_mix: dict = None,
    output_format: str = "svg",
    dimensions: tuple[int, int] = (1920, 960),
    starting_seed: Optional[int] = None,
) -> list[BannerResult]:
    """Generate a batch of banners."""
    if energy_mix is None:
        energy_mix = {"low": 0.3, "medium": 0.5, "high": 0.2}

    output_dir.mkdir(parents=True, exist_ok=True)

    # Allocate energy levels
    allocations = []
    for energy_level, fraction in energy_mix.items():
        count = round(n * fraction)
        allocations.extend([energy_level] * count)

    # Adjust to exactly n
    while len(allocations) < n:
        allocations.append("medium")
    allocations = allocations[:n]

    # Shuffle for variety
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
            output_format=output_format,
            dimensions=dimensions,
        )

        # Write SVG
        filename = f"banner-{i+1:03d}-{energy_level}-s{seed}"
        svg_path = output_dir / f"{filename}.svg"
        svg_bytes = etree.tostring(
            banner_root,
            xml_declaration=True,
            encoding="UTF-8",
            pretty_print=True,
        )
        svg_path.write_bytes(svg_bytes)
        result.output_path = str(svg_path)

        # Write JSON sidecar
        json_path = output_dir / f"{filename}.json"
        sidecar = asdict(result)
        with open(json_path, "w") as f:
            json.dump(sidecar, f, indent=2)

        results.append(result)

        if (i + 1) % 10 == 0 or (i + 1) == n:
            print(f"  Generated {i+1}/{n} banners")

    return results


# ── Main ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI Banner Generator")

    # Single banner options
    parser.add_argument("--energy", choices=["low", "medium", "high"], default="medium")
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output-format", choices=["svg"], default="svg")
    parser.add_argument("--dimensions", type=int, nargs=2, default=[1920, 960])
    parser.add_argument("--color-bias", type=str, default=None)
    parser.add_argument("--output", type=str, default=None)

    # Batch options
    parser.add_argument("--batch", type=int, default=None, help="Generate N banners")
    parser.add_argument("--energy-mix", type=str, default=None,
                        help='JSON dict: {"low":0.3,"medium":0.5,"high":0.2}')
    parser.add_argument("--starting-seed", type=int, default=None)

    # Paths
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--tiles-dir", type=Path, default=DEFAULT_TILES_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)

    args = parser.parse_args()

    if args.batch:
        # Batch mode
        energy_mix = json.loads(args.energy_mix) if args.energy_mix else None
        print(f"Generating batch of {args.batch} banners...")
        results = generate_batch(
            n=args.batch,
            manifest_path=args.manifest,
            tiles_dir=args.tiles_dir,
            output_dir=args.output_dir,
            energy_mix=energy_mix,
            output_format=args.output_format,
            dimensions=tuple(args.dimensions),
            starting_seed=args.starting_seed,
        )
        print(f"\nBatch complete: {len(results)} banners in {args.output_dir}")

        # Summary
        by_energy = {}
        for r in results:
            by_energy[r.energy] = by_energy.get(r.energy, 0) + 1
        for e, c in sorted(by_energy.items()):
            print(f"  {e}: {c}")

    else:
        # Single banner mode
        print(f"Generating single banner (energy={args.energy}, seed={args.seed})...")

        result, banner_root = generate_banner(
            manifest_path=args.manifest,
            tiles_dir=args.tiles_dir,
            energy=args.energy,
            seed=args.seed,
            output_format=args.output_format,
            dimensions=tuple(args.dimensions),
            color_bias=args.color_bias,
        )

        # Write output
        output_dir = args.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        if args.output:
            svg_path = Path(args.output)
        else:
            svg_path = output_dir / f"banner-{args.energy}-s{result.seed}.svg"

        svg_bytes = etree.tostring(
            banner_root,
            xml_declaration=True,
            encoding="UTF-8",
            pretty_print=True,
        )
        svg_path.write_bytes(svg_bytes)
        result.output_path = str(svg_path)

        # Write sidecar
        json_path = svg_path.with_suffix(".json")
        with open(json_path, "w") as f:
            json.dump(asdict(result), f, indent=2)

        print(f"Banner written to: {svg_path}")
        print(f"Metadata written to: {json_path}")
        print(f"Seed: {result.seed}")

        # Color summary
        color_counts = {}
        for c in result.cells:
            color_counts[c["fg_name"]] = color_counts.get(c["fg_name"], 0) + 1
        print(f"Foreground colors used:")
        for name, count in sorted(color_counts.items(), key=lambda x: -x[1]):
            print(f"  {name}: {count} tiles")


if __name__ == "__main__":
    main()
