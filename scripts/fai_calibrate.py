#!/usr/bin/env python3
"""
fai_calibrate.py — reference-banner calibration loop.

The supplement (Tuning and Validation) says: score the existing hand-made
banners with the same scoring functions to establish the target score range,
and compare generated output against it. If generated banners consistently
score below the references on an axis, that axis needs recalibration.

This script:
  1. Reads each reference banner in output/banners-clean/ (flat SVGs in
     banner-global coordinates: a global bg rect, optional per-cell bg rects,
     and one foreground <path> per non-empty cell).
  2. Reconstructs the 6x3 cell grid by RENDERING each 320px cell region and
     running the SAME foreground analysis used to label tiles — so reference
     weight/direction are measured identically to generated banners.
  3. Matches each cell's foreground geometry to the nearest manifest tile to
     recover shape_family + dominant_direction.
  4. Scores every reference banner with scripts/fai_banner.py's axes and prints
     per-axis reference mean/min/max, then (optionally) a generated-set mean
     for side-by-side comparison.

Run:
    DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib \
      $HOME/.cache/fai-deck-venv/bin/python scripts/fai_calibrate.py
    # add --compare N to also score N freshly generated banners per mode
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fai_banner as fb  # noqa: E402
from svg_raster import analyse_foreground, decode_png, svg_to_png_bytes  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
REF_DIR = BASE / "output" / "banners-clean"
MANIFEST = BASE / "tiles-manifest-v2.json"

AXES = ["anchor", "rhythm", "direction", "weight", "negative", "temperature", "family", "hero", "template", "total"]


def cell_region_geometry(svg_text: str, col: int, row: int, banner_w=1920, banner_h=960, n=72) -> dict:
    """Render the full banner small, then analyse one cell's region.

    The cell's *background* is whatever colour fills it; the *foreground* is
    every pixel in the cell that differs from that background. We sample the
    background from the cell's corner pixel.
    """
    cw, ch = banner_w // fb.GRID_COLS, banner_h // fb.GRID_ROWS
    # Render whole banner at n px per cell for resolution.
    full_w, full_h = fb.GRID_COLS * n, fb.GRID_ROWS * n
    px, w, h, chan = decode_png(svg_to_png_bytes(svg_bytes=svg_text.encode(), width=full_w, height=full_h))

    x0, y0 = col * n, row * n
    # background = corner pixel of the cell
    ci = (y0 * w + x0) * chan
    bg = (px[ci], px[ci + 1], px[ci + 2])

    cnt = 0
    sx = sy = 0.0
    fg = []
    for yy in range(y0, y0 + n):
        for xx in range(x0, x0 + n):
            i = (yy * w + xx) * chan
            r, g, b = px[i], px[i + 1], px[i + 2]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 60:
                cnt += 1
                sx += xx - x0
                sy += yy - y0
                fg.append(((xx - x0 + 0.5) / n - 0.5, (yy - y0 + 0.5) / n - 0.5))
    if cnt == 0:
        return {"fill_fraction": 0.0, "centroid": (0.5, 0.5), "mean_radius": 0.0, "std_radius": 0.0, "n_fg": 0}
    cx, cy = sx / cnt / n, sy / cnt / n
    rs = [(dx * dx + dy * dy) ** 0.5 for dx, dy in fg]
    mean_r = sum(rs) / len(rs)
    var = sum((rr - mean_r) ** 2 for rr in rs) / len(rs)
    return {
        "fill_fraction": cnt / (n * n),
        "centroid": (cx, cy),
        "mean_radius": mean_r,
        "std_radius": var ** 0.5,
        "n_fg": cnt,
    }


def classify_direction(geo: dict) -> str:
    """Same logic as build_dominant_direction.classify but geometry-only.

    (References have no edge_coverage metadata, so we drop the edge-reinforce
    term — centroid + radius carry the signal.)
    """
    if geo["n_fg"] == 0:
        return "neutral"
    cx, cy = geo["centroid"]
    dx, dy = cx - 0.5, cy - 0.5
    mean_r, std_r = geo["mean_radius"], geo["std_radius"]
    central = abs(dx) < 0.12 and abs(dy) < 0.12
    if central:
        if mean_r >= 0.33 and std_r >= 0.13:
            return "outward"
        if mean_r <= 0.26 and std_r <= 0.13:
            return "center"
        return "neutral"
    return ("right" if dx > 0 else "left") if abs(dx) >= abs(dy) else ("down" if dy > 0 else "up")


def nearest_tile(geo: dict, direction: str, tiles: list):
    """Match a cell's measured geometry to the closest manifest tile.

    Returns the matched Tile so the reference banner recovers BOTH a family
    (for the grouping axis) and a concrete tile id (so the rhythm axis, which
    counts repeated shapes, is measurable on references too). Distance is on
    area weight + direction agreement.
    """
    best = None
    best_d = 1e9
    for t in tiles:
        d = abs(t.area_weight - geo["fill_fraction"])
        if t.direction != direction:
            d += 0.25
        if d < best_d:
            best_d = d
            best = t
    return best


def build_reference_banner(svg_path: Path, tiles: list) -> fb.Banner:
    txt = svg_path.read_text()
    cells = []
    # default background = first global rect fill
    m = re.search(r'<rect[^>]*fill="(#[0-9A-Fa-f]{6})"', txt)
    default_bg = (m.group(1) if m else "#F3F3F3").upper()

    for row in range(fb.GRID_ROWS):
        for col in range(fb.GRID_COLS):
            geo = cell_region_geometry(txt, col, row)
            # determine fg/bg hex from the rendered corner + dominant fg colour
            fg_hex, bg_hex = sample_cell_colors(txt, col, row, default_bg)
            direction = classify_direction(geo)
            match = nearest_tile(geo, direction, tiles)
            tile = fb.Tile(
                id=match.id if match else f"ref-{col}-{row}",
                filename=match.filename if match else "",
                family=match.family if match else "shape",
                direction=direction,
                area_weight=geo["fill_fraction"],
                symmetry="none",
                complexity="simple",
                edge_coverage={},
            )
            cells.append(fb.Cell(col=col, row=row, tile=tile, rotation=0, fg=fg_hex, bg=bg_hex))
    return fb.Banner(cells=cells, template="reference", color_mode="reference", seed=0)


def sample_cell_colors(svg_text: str, col: int, row: int, default_bg: str, n=72) -> tuple[str, str]:
    """Render the cell and pick the two most common brand hexes (bg=corner, fg=most common non-bg)."""
    full_w, full_h = fb.GRID_COLS * n, fb.GRID_ROWS * n
    px, w, h, chan = decode_png(svg_to_png_bytes(svg_bytes=svg_text.encode(), width=full_w, height=full_h))
    x0, y0 = col * n, row * n
    ci = (y0 * w + x0) * chan
    bg = (px[ci], px[ci + 1], px[ci + 2])
    from collections import Counter

    counts: Counter = Counter()
    for yy in range(y0, y0 + n):
        for xx in range(x0, x0 + n):
            i = (yy * w + xx) * chan
            rgb = (px[i], px[i + 1], px[i + 2])
            counts[rgb] += 1
    bg_hex = nearest_brand_hex(bg)
    # foreground = most common colour that isn't the background
    fg_hex = bg_hex
    for rgb, _ in counts.most_common():
        if abs(rgb[0] - bg[0]) + abs(rgb[1] - bg[1]) + abs(rgb[2] - bg[2]) > 60:
            fg_hex = nearest_brand_hex(rgb)
            break
    return fg_hex, bg_hex


def nearest_brand_hex(rgb) -> str:
    best = "#F3F3F3"
    best_d = 1e9
    for hx in fb.BRAND.values():
        h = hx.lstrip("#")
        rr, gg, bb = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        d = (rr - rgb[0]) ** 2 + (gg - rgb[1]) ** 2 + (bb - rgb[2]) ** 2
        if d < best_d:
            best_d = d
            best = hx
    return best


def summarise(label: str, banners: list[fb.Banner]):
    print(f"\n=== {label} (n={len(banners)}) ===")
    print(f"{'axis':>12}  {'mean':>6} {'min':>6} {'max':>6} {'p25':>6} {'p75':>6}")
    for ax in AXES:
        vals = sorted(b.scores[ax] for b in banners)
        mean = statistics.mean(vals)
        p25 = vals[len(vals) // 4]
        p75 = vals[3 * len(vals) // 4]
        print(f"{ax:>12}  {mean:6.3f} {vals[0]:6.3f} {vals[-1]:6.3f} {p25:6.3f} {p75:6.3f}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--compare", type=int, default=0, help="also score N generated banners per colour mode")
    ap.add_argument("--limit", type=int, default=None, help="limit reference banners (debug)")
    args = ap.parse_args(argv)

    tiles, _ = fb.load_tiles(MANIFEST)
    palette = fb.build_palette("full", None)

    refs = sorted(REF_DIR.glob("*.svg"))
    if args.limit:
        refs = refs[: args.limit]
    print(f"scoring {len(refs)} reference banners from {REF_DIR} ...")
    ref_banners = []
    for sp in refs:
        b = build_reference_banner(sp, tiles)
        b.scores = fb.score_banner(b, palette, fb.SCORING_WEIGHTS)
        ref_banners.append(b)
    summarise("REFERENCE banners (output/banners-clean)", ref_banners)

    if args.compare:
        for mode, vhex in [("full", None), ("duotone", None), ("vertical", "#4997D0")]:
            gen = []
            for s in range(args.compare):
                b = fb.generate_banner(tiles, color_mode=mode, vertical_hex=vhex, seed=1000 + s, n_candidates=120)
                gen.append(b)
            summarise(f"GENERATED [{mode}]", gen)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
