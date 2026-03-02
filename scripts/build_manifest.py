#!/usr/bin/env python3
"""
Phase 2: Build Tile Manifest

Analyzes cleaned shape tile SVGs and builds tiles-manifest.json with
computed metadata for each tile: shape_family, visual_weight, edge_type,
and rendering classification. Also embeds the composition grammar
(energy levels, adjacency rules, grid spec).

Uses macOS qlmanage for SVG-to-PNG rendering, then Pillow for pixel analysis.

Usage:
    python build_manifest.py
    python build_manifest.py --shapes-dir path/to/shapes-clean --output manifest.json
"""

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path

from lxml import etree
from PIL import Image

# ── Resolve imports from sibling module ──────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS, BRAND_HEX_SET, WARM_COLORS, COOL_COLORS, NEUTRAL_COLORS

# ── Constants ────────────────────────────────────────────
SVG_NS = "http://www.w3.org/2000/svg"
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SHAPES_DIR = BASE_DIR / "output" / "shapes-clean"
DEFAULT_OUTPUT = BASE_DIR / "tiles-manifest.json"

# Foreground color in cleaned tiles (all shapes use #121212 as foreground)
FG_COLOR_RGB = (18, 18, 18)  # #121212
# Background color (most shapes use #F3F3F3)
BG_COLOR_RGB = (243, 243, 243)  # #F3F3F3

# Threshold for "dark" pixel detection (Euclidean distance from FG)
DARK_THRESHOLD = 60
# Render size for analysis
RENDER_SIZE = 200

# Exclude from manifest
EXCLUDE_FILES = {"Lines.svg"}


# ── Data Classes ─────────────────────────────────────────
@dataclass
class TileMetadata:
    id: str                    # e.g., "angle-01"
    filename: str              # relative path, e.g., "Angle/01.svg"
    shape_family: str          # e.g., "angle"
    visual_weight: float       # 0.0–1.0
    weight_band: str           # "light" | "medium" | "heavy"
    edge_type: dict            # {"top": bool, "right": bool, "bottom": bool, "left": bool}
    has_clippath: bool
    has_background_rect: bool  # figure-on-ground vs full-bleed
    path_count: int


# ── SVG Rendering via qlmanage ───────────────────────────
def render_svg_to_image(svg_path: Path, size: int = RENDER_SIZE) -> Image.Image:
    """
    Render an SVG to a PIL Image using macOS qlmanage.
    Returns an RGB image at the specified size.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        result = subprocess.run(
            ["qlmanage", "-t", "-s", str(size), "-o", tmpdir, str(svg_path)],
            capture_output=True, text=True, timeout=10,
        )
        # qlmanage outputs filename.svg.png
        png_name = svg_path.name + ".png"
        png_path = Path(tmpdir) / png_name
        if not png_path.exists():
            # Sometimes qlmanage changes the extension handling
            pngs = list(Path(tmpdir).glob("*.png"))
            if pngs:
                png_path = pngs[0]
            else:
                raise RuntimeError(
                    f"qlmanage failed to render {svg_path.name}: {result.stderr}"
                )
        return Image.open(png_path).convert("RGB")


# ── Pixel Analysis ───────────────────────────────────────
def _is_dark_pixel(r: int, g: int, b: int) -> bool:
    """Check if a pixel is 'foreground' (dark, near #121212)."""
    dr = r - FG_COLOR_RGB[0]
    dg = g - FG_COLOR_RGB[1]
    db = b - FG_COLOR_RGB[2]
    return (dr*dr + dg*dg + db*db) < DARK_THRESHOLD * DARK_THRESHOLD


def compute_visual_weight(img: Image.Image) -> tuple[float, str]:
    """
    Compute the fill ratio of foreground pixels.
    Returns (ratio, band_label).
    """
    w, h = img.size
    total = w * h
    dark_count = 0

    for pixel in img.getdata():
        if _is_dark_pixel(*pixel):
            dark_count += 1

    ratio = dark_count / total if total > 0 else 0.0

    if ratio < 0.33:
        band = "light"
    elif ratio < 0.66:
        band = "medium"
    else:
        band = "heavy"

    return round(ratio, 4), band


def compute_edge_type(img: Image.Image) -> dict[str, bool]:
    """
    Determine which edges have foreground shapes touching the boundary.
    Samples the border pixels and checks for dark (foreground) pixels.
    """
    w, h = img.size
    pixels = img.load()

    # Sample border strips (2px deep for robustness against anti-aliasing)
    depth = 2

    def has_dark_in_strip(positions):
        for x, y in positions:
            r, g, b = pixels[x, y]
            if _is_dark_pixel(r, g, b):
                return True
        return False

    top_positions = [(x, y) for y in range(depth) for x in range(w)]
    bottom_positions = [(x, y) for y in range(h - depth, h) for x in range(w)]
    left_positions = [(x, y) for x in range(depth) for y in range(h)]
    right_positions = [(x, y) for x in range(w - depth, w) for y in range(h)]

    return {
        "top": has_dark_in_strip(top_positions),
        "right": has_dark_in_strip(right_positions),
        "bottom": has_dark_in_strip(bottom_positions),
        "left": has_dark_in_strip(left_positions),
    }


# ── SVG Structure Analysis ───────────────────────────────
def analyze_svg_structure(svg_path: Path) -> dict:
    """
    Parse the SVG and extract structural information.
    """
    tree = etree.parse(str(svg_path))
    root = tree.getroot()

    has_clippath = False
    has_background_rect = False
    path_count = 0

    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue
        tag = etree.QName(elem.tag).localname

        if tag == "clipPath":
            has_clippath = True
        elif tag == "path":
            path_count += 1

    # Check if first visible child (non-defs) is a full-coverage rect
    for child in root:
        if not isinstance(child.tag, str):
            continue
        tag = etree.QName(child.tag).localname
        if tag == "defs":
            continue

        if tag == "rect":
            w = child.get("width", "")
            h = child.get("height", "")
            try:
                if float(w) >= 190 and float(h) >= 190:  # Allow small tolerance
                    has_background_rect = True
            except ValueError:
                pass

        elif tag == "g":
            # Check inside the group for a background rect
            for sub in child:
                if not isinstance(sub.tag, str):
                    continue
                sub_tag = etree.QName(sub.tag).localname
                if sub_tag == "rect":
                    w = sub.get("width", "")
                    h = sub.get("height", "")
                    try:
                        if float(w) >= 190 and float(h) >= 190:
                            has_background_rect = True
                    except ValueError:
                        pass
                break  # Only check first child of group
        break  # Only check first visible child

    return {
        "has_clippath": has_clippath,
        "has_background_rect": has_background_rect,
        "path_count": path_count,
    }


# ── Tile ID and Family Derivation ────────────────────────
def derive_tile_info(filepath: Path, shapes_dir: Path) -> tuple[str, str, str]:
    """
    Derive tile id, filename (relative), and shape_family from path.
    Returns (tile_id, relative_filename, shape_family).
    """
    rel = filepath.relative_to(shapes_dir)
    parts = rel.parts

    if len(parts) == 1:
        # Root-level file (e.g., Clear.svg)
        name_stem = parts[0].replace(".svg", "").lower()
        family = name_stem
        tile_id = name_stem
        filename = parts[0]
    else:
        # Subfolder file (e.g., Angle/01.svg)
        folder = parts[0]
        family = folder.lower()
        name_stem = parts[1].replace(".svg", "")
        tile_id = f"{family}-{name_stem}"
        filename = f"{folder}/{parts[1]}"

    return tile_id, filename, family


# ── Manifest Building ────────────────────────────────────
def build_manifest(shapes_dir: Path) -> dict:
    """Build the complete tiles manifest."""
    tiles = []
    svg_files = sorted(shapes_dir.rglob("*.svg"))

    print(f"Building manifest from {len(svg_files)} tiles...")

    for i, svg_path in enumerate(svg_files):
        if svg_path.name in EXCLUDE_FILES:
            continue

        tile_id, filename, family = derive_tile_info(svg_path, shapes_dir)

        # Render and analyze
        try:
            img = render_svg_to_image(svg_path, RENDER_SIZE)
            weight, band = compute_visual_weight(img)
            edges = compute_edge_type(img)
        except Exception as e:
            print(f"  WARNING: Could not render {filename}: {e}")
            weight, band = 0.0, "light"
            edges = {"top": False, "right": False, "bottom": False, "left": False}

        # SVG structure analysis
        structure = analyze_svg_structure(svg_path)

        tile = TileMetadata(
            id=tile_id,
            filename=filename,
            shape_family=family,
            visual_weight=weight,
            weight_band=band,
            edge_type=edges,
            has_clippath=structure["has_clippath"],
            has_background_rect=structure["has_background_rect"],
            path_count=structure["path_count"],
        )
        tiles.append(tile)

        # Progress indicator
        if (i + 1) % 20 == 0 or (i + 1) == len(svg_files):
            print(f"  Processed {i + 1}/{len(svg_files)} tiles")

    # Build the full manifest
    manifest = {
        "version": "1.0",
        "generated": datetime.now(timezone.utc).isoformat(),
        "source_dir": str(shapes_dir),
        "tile_count": len(tiles),

        "grid_spec": {
            "columns": 6,
            "rows": 3,
            "total_slots": 18,
            "aspect_ratio": "2:1",
            "tile_viewbox": "0 0 200 200",
            "reference_banner_size": [1920, 960],
            "cell_size_in_banner": [320, 320],
        },

        "energy_levels": {
            "low": {
                "description": "Monochrome + accent",
                "max_colors": 3,
                "required_dominant": ["cod_gray", "white", "smoke_white"],
                "dominant_min_tiles": 12,
                "accent_colors": ["international_orange"],
                "accent_tile_range": [1, 2],
                "excluded_colors": ["chrome_yellow", "celestial_blue"],
            },
            "medium": {
                "description": "Balanced brand",
                "color_count_range": [4, 5],
                "orange_tile_range": [2, 4],
                "max_single_color_tiles": 6,
            },
            "high": {
                "description": "Full palette",
                "color_count_range": [6, 7],
                "orange_tile_range": [3, 5],
                "required_present": ["celestial_blue", "chrome_yellow"],
                "min_tiles_per_required": 1,
            },
        },

        "adjacency_rules": {
            "no_same_color_adjacent": True,
            "prefer_warm_cool_alternation": True,
            "weight_balance": "prefer mixed visual_weight across rows",
        },

        "color_catalog": {
            name: {
                "hex": hex_val,
                "temperature": (
                    "warm" if hex_val in WARM_COLORS
                    else "cool" if hex_val in COOL_COLORS
                    else "neutral"
                ),
            }
            for name, hex_val in BRAND_COLORS.items()
        },

        "tiles": [asdict(t) for t in tiles],
    }

    return manifest


# ── Main ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI Tile Manifest Builder")
    parser.add_argument(
        "--shapes-dir", type=Path, default=DEFAULT_SHAPES_DIR,
        help="Path to cleaned shapes directory",
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT,
        help="Output path for tiles-manifest.json",
    )
    args = parser.parse_args()

    if not args.shapes_dir.exists():
        print(f"ERROR: Shapes directory not found: {args.shapes_dir}")
        sys.exit(1)

    manifest = build_manifest(args.shapes_dir)

    # Write manifest
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nManifest written to: {args.output}")
    print(f"  Total tiles: {manifest['tile_count']}")

    # Summary statistics
    tiles = manifest["tiles"]
    families = set(t["shape_family"] for t in tiles)
    bands = {"light": 0, "medium": 0, "heavy": 0}
    for t in tiles:
        bands[t["weight_band"]] += 1

    print(f"  Shape families: {len(families)} ({', '.join(sorted(families))})")
    print(f"  Weight distribution: light={bands['light']}, medium={bands['medium']}, heavy={bands['heavy']}")
    print(f"  With background rect: {sum(1 for t in tiles if t['has_background_rect'])}")
    print(f"  With clipPath: {sum(1 for t in tiles if t['has_clippath'])}")


if __name__ == "__main__":
    main()
