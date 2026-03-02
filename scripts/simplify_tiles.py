#!/usr/bin/env python3
"""
Phase 1.5: FAI Tile Simplification

Transforms every cleaned shape tile into a minimal SVG with exactly one
<path> element (or zero for the empty Clear tile). Removes background rects,
clipPaths, and merges multiple shapes into compound paths.

Input:  output/shapes-clean/{Family}/{N}.svg
Output: output/shapes-simplified/{Family}/{N}.svg

Usage:
    python simplify_tiles.py
    python simplify_tiles.py --tile "Mirror/03.svg"   # single tile
    python simplify_tiles.py --validate-only           # compare existing output
    python simplify_tiles.py --skip-validation         # fast run, no raster check
"""

import argparse
import math
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from lxml import etree

try:
    from shapely.geometry import box as shapely_box
    from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString
    from shapely.ops import unary_union
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

# ── Constants ────────────────────────────────────────────
SVG_NS    = "http://www.w3.org/2000/svg"
BASE_DIR  = Path(__file__).resolve().parent.parent
INPUT_DIR = BASE_DIR / "output" / "shapes-clean"
OUT_DIR   = BASE_DIR / "output" / "shapes-simplified"
REPORT    = BASE_DIR / "reports" / "simplification-report.md"

CLIP_BOX  = (0.0, 0.0, 200.0, 200.0)   # xmin, ymin, xmax, ymax
CLIP_EPS  = 0.5                          # treat overflow < this as floating-point noise

FG_FILL  = "#121212"   # Cod Gray — foreground
BG_FILL  = "#F3F3F3"   # Smoke White — background rect to remove
WHITE_FILL = "#FFFFFF"

# Regex to extract all numeric tokens from a path `d` attribute
_COORD_RE = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")

# Match Lnan nan artefacts from Figma rounded-corner exports
_NAN_RE = re.compile(r"[Ll]nan\s+nan\s*")


# ── Data classes ─────────────────────────────────────────
@dataclass
class TileClassification:
    rel_path: str
    has_clip: bool
    bg_rects: list       # element references
    fg_elements: list    # (tag, fill, element) tuples
    has_nan: bool
    has_circles: bool
    has_rects_fg: bool
    has_ellipses: bool
    has_mixed_colors: bool  # both #121212 and #F3F3F3 as fg
    uses_evenodd: bool
    is_clear: bool


@dataclass
class ValidationResult:
    passed: bool
    orig_coverage: float
    simp_coverage: float
    diff: float
    note: str = ""


@dataclass
class SimplificationResult:
    rel_path: str
    status: str          # OK | VALIDATION_FAILED | EMPTY | ERROR
    strategy: str
    input_fg_count: int
    output_path_count: int
    validation: Optional[ValidationResult] = None
    error: Optional[str] = None


# ── SVG helpers ──────────────────────────────────────────
def _tag(elem) -> str:
    """Return the local tag name without namespace."""
    t = elem.tag
    if t and t.startswith("{"):
        t = t.split("}", 1)[1]
    return t


def _attr(elem, name: str, default="") -> str:
    return elem.get(name, default)


def _is_bg_rect(elem) -> bool:
    """True if this element is the background rect (large, smoke-white or white fill)."""
    if _tag(elem) not in ("rect", "svg"):
        return False
    fill = _attr(elem, "fill", "").upper()
    if fill not in (BG_FILL.upper(), WHITE_FILL.upper(), "#FAFAFA"):
        return False
    # Must be large: width and height both >= 150 (in their own coordinate space)
    try:
        w = float(_attr(elem, "width", "0"))
        h = float(_attr(elem, "height", "0"))
    except ValueError:
        return False
    return w >= 150 and h >= 150


def _is_fg(elem) -> bool:
    """True if this element is a visible foreground shape."""
    tag = _tag(elem)
    if tag not in ("path", "circle", "ellipse", "rect", "line",
                   "polyline", "polygon"):
        return False
    fill = _attr(elem, "fill", "#121212").upper()
    stroke = _attr(elem, "stroke", "none")
    # Skip elements that are purely transparent/none
    if fill == "NONE" and stroke in ("none", ""):
        return False
    return True


def classify_tile(svg_path: Path) -> TileClassification:
    """Parse a tile SVG and return its structural classification."""
    tree = etree.parse(str(svg_path), etree.XMLParser(remove_comments=True))
    root = tree.getroot()
    rel_path = "/".join(svg_path.parts[-2:])

    has_clip = False
    bg_rects = []
    fg_elements = []
    has_nan = False
    has_circles = False
    has_rects_fg = False
    has_ellipses = False
    uses_evenodd = False

    # Walk the full tree
    for elem in root.iter():
        tag = _tag(elem)
        if tag == "clipPath":
            has_clip = True
            continue
        if tag == "defs":
            continue

        if _is_bg_rect(elem):
            bg_rects.append(elem)
            continue

        if _is_fg(elem):
            fill = _attr(elem, "fill", FG_FILL).upper()
            fg_elements.append((tag, fill, elem))
            if tag == "circle":
                has_circles = True
            elif tag == "ellipse":
                has_ellipses = True
            elif tag == "rect":
                has_rects_fg = True
            if tag == "path":
                d = _attr(elem, "d", "")
                if _NAN_RE.search(d):
                    has_nan = True
                if "evenodd" in _attr(elem, "fill-rule", "").lower():
                    uses_evenodd = True

    fg_fills = {f.upper() for (_, f, _) in fg_elements}
    has_mixed_colors = FG_FILL.upper() in fg_fills and BG_FILL.upper() in fg_fills

    is_clear = (
        rel_path.lower().endswith("clear.svg")
        or (len(fg_elements) == 0 and len(bg_rects) <= 2)
    )

    return TileClassification(
        rel_path=rel_path,
        has_clip=has_clip,
        bg_rects=bg_rects,
        fg_elements=fg_elements,
        has_nan=has_nan,
        has_circles=has_circles,
        has_rects_fg=has_rects_fg,
        has_ellipses=has_ellipses,
        has_mixed_colors=has_mixed_colors,
        uses_evenodd=uses_evenodd,
        is_clear=is_clear,
    )


# ── Stage 2: NaN sanitization ────────────────────────────
def sanitize_nan(d: str) -> str:
    """Remove Lnan nan / lnan nan segments from path data."""
    return _NAN_RE.sub("", d).strip()


# ── Stage 3: Primitive → path ────────────────────────────
def circle_to_d(cx: float, cy: float, r: float) -> str:
    """Full circle as two-arc SVG path."""
    return (
        f"M{cx - r},{cy} "
        f"A{r},{r} 0 1,0 {cx + r},{cy} "
        f"A{r},{r} 0 1,0 {cx - r},{cy} Z"
    )


def rect_to_d(x: float, y: float, w: float, h: float) -> str:
    """Rectangle as closed path."""
    return f"M{x},{y} L{x+w},{y} L{x+w},{y+h} L{x},{y+h} Z"


def ellipse_to_d(cx: float, cy: float, rx: float, ry: float) -> str:
    """Ellipse as two-arc SVG path."""
    return (
        f"M{cx - rx},{cy} "
        f"A{rx},{ry} 0 1,0 {cx + rx},{cy} "
        f"A{rx},{ry} 0 1,0 {cx - rx},{cy} Z"
    )


def elem_to_d(tag: str, elem) -> str:
    """Convert any primitive element to a path d string."""
    if tag == "path":
        return sanitize_nan(_attr(elem, "d", ""))
    elif tag == "circle":
        cx = float(_attr(elem, "cx", "0"))
        cy = float(_attr(elem, "cy", "0"))
        r  = float(_attr(elem, "r",  "0"))
        return circle_to_d(cx, cy, r)
    elif tag == "ellipse":
        cx = float(_attr(elem, "cx", "0"))
        cy = float(_attr(elem, "cy", "0"))
        rx = float(_attr(elem, "rx", "0"))
        ry = float(_attr(elem, "ry", "0"))
        return ellipse_to_d(cx, cy, rx, ry)
    elif tag == "rect":
        x = float(_attr(elem, "x", "0"))
        y = float(_attr(elem, "y", "0"))
        w = float(_attr(elem, "width",  "0"))
        h = float(_attr(elem, "height", "0"))
        return rect_to_d(x, y, w, h)
    return ""


# ── Stage 4: Bounds check & clipping ────────────────────
def _path_coords(d: str) -> list[float]:
    """Extract all numeric values from a path d string."""
    return [float(v) for v in _COORD_RE.findall(d)
            if not math.isnan(float(v))]


def _path_bbox(d: str) -> tuple[float, float, float, float]:
    """Very rough bounding box from coordinate scan (ignores curve control points)."""
    coords = _path_coords(d)
    if not coords:
        return (0, 0, 0, 0)
    # Can't easily split x vs y from raw numbers without full parsing,
    # so we report the range of ALL numbers as a conservative estimate
    mn, mx = min(coords), max(coords)
    return (mn, mn, mx, mx)


def needs_clipping(d: str) -> bool:
    """Heuristic: does this path have coordinates significantly outside [0,200]?"""
    coords = _path_coords(d)
    for v in coords:
        if v < -CLIP_EPS or v > 200.0 + CLIP_EPS:
            return True
    return False


def _d_to_shapely(d: str, resolution: int = 64) -> Optional[object]:
    """
    Convert an SVG path d string to a Shapely geometry via point sampling.
    Uses svgpathtools if available for accurate curve tracing, otherwise
    falls back to coordinate-only extraction (good enough for simple polygons).
    """
    if not HAS_SHAPELY:
        return None
    try:
        import svgpathtools
        path = svgpathtools.parse_path(d)
        if len(path) == 0:
            return None
        # Sample points along each subpath
        all_subpaths = []
        current_sub = []
        for seg in path:
            pts = [seg.point(t / resolution) for t in range(resolution + 1)]
            current_sub.extend(pts)
        if current_sub:
            coords = [(p.real, p.imag) for p in current_sub]
            if len(coords) >= 3:
                try:
                    poly = Polygon(coords)
                    if not poly.is_valid:
                        poly = poly.buffer(0)
                    return poly
                except Exception:
                    pass
        return None
    except Exception:
        return None


def _shapely_to_d(geom) -> str:
    """Convert a Shapely geometry back to an SVG path d string."""
    if geom is None or geom.is_empty:
        return ""

    parts = []

    def _ring_to_d(coords):
        pts = list(coords)
        if not pts:
            return ""
        # Remove duplicate last point (shapely closes rings)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 2:
            return ""
        d = f"M{pts[0][0]:.4f},{pts[0][1]:.4f}"
        for x, y in pts[1:]:
            d += f" L{x:.4f},{y:.4f}"
        d += " Z"
        return d

    def _poly_to_d(poly):
        d = _ring_to_d(poly.exterior.coords)
        for interior in poly.interiors:
            d += " " + _ring_to_d(interior.coords)
        return d

    geom_type = geom.geom_type
    if geom_type == "Polygon":
        parts.append(_poly_to_d(geom))
    elif geom_type in ("MultiPolygon", "GeometryCollection"):
        for g in geom.geoms:
            if g.geom_type == "Polygon":
                parts.append(_poly_to_d(g))
    elif geom_type in ("LineString", "MultiLineString", "LinearRing"):
        # Lines: trace as open path
        coords = list(geom.coords) if hasattr(geom, "coords") else []
        if coords:
            d = f"M{coords[0][0]:.4f},{coords[0][1]:.4f}"
            for x, y in coords[1:]:
                d += f" L{x:.4f},{y:.4f}"
            parts.append(d)
    elif geom_type == "Point":
        pass  # skip degenerate

    return " ".join(p for p in parts if p)


def clip_d_to_box(d: str) -> str:
    """
    Clip an SVG path d string to the 200×200 bounding box.
    Returns the clipped path d string, or the original if clipping fails.
    """
    if not HAS_SHAPELY:
        return d  # can't clip without shapely

    clip_rect = shapely_box(*CLIP_BOX)

    try:
        import svgpathtools
        path = svgpathtools.parse_path(d)

        # Handle compound paths: split at M commands into subpaths
        subpath_strings = []
        current = []
        for seg in path:
            current.append(seg)

        if not current:
            return d

        # Sample the full path as a polygon for clipping
        geom = _d_to_shapely(d, resolution=128)
        if geom is None:
            return d

        clipped = geom.intersection(clip_rect)
        result = _shapely_to_d(clipped)
        return result if result else d
    except Exception:
        return d


# ── Stage 5: Merge multiple paths ───────────────────────
def merge_paths_to_compound(path_data: list[tuple[str, str]]) -> tuple[str, str]:
    """
    Merge a list of (d_string, fill_color) into a single compound path.
    Returns (merged_d, fill_rule).

    Mixed-color strategy: #F3F3F3 shapes are treated as "holes" in #121212 shapes.
    Combined with fill-rule="evenodd", the light regions become transparent.
    """
    dark_parts = []
    light_parts = []

    for d, fill in path_data:
        if not d.strip():
            continue
        if fill.upper() == BG_FILL.upper():
            light_parts.append(d)
        else:
            dark_parts.append(d)

    if light_parts:
        # Mixed: combine dark shapes + light "hole" shapes with evenodd
        all_parts = dark_parts + light_parts
        return (" ".join(all_parts), "evenodd")
    else:
        # All dark: simple compound path
        combined = " ".join(dark_parts)
        return (combined, "nonzero")


# ── Stage 6: Write simplified SVG ───────────────────────
def write_simplified_svg(output_path: Path, d: str, fill_rule: str):
    """Write the final simplified SVG with a single <path>."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fill_rule_attr = f' fill-rule="{fill_rule}"' if fill_rule != "nonzero" else ""
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" '
        'viewBox="0 0 200 200">\n'
        f'  <path d="{d}" fill="{FG_FILL}"{fill_rule_attr}/>\n'
        '</svg>\n'
    )
    output_path.write_text(content, encoding="utf-8")


def write_empty_svg(output_path: Path):
    """Write an empty SVG (for Clear tile)."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" '
        'viewBox="0 0 200 200"/>\n'
    )
    output_path.write_text(content, encoding="utf-8")


# ── Stage 7: Raster validation ───────────────────────────
def render_to_png(svg_path: Path, size: int = 200) -> Optional[Path]:
    """Render an SVG to PNG using macOS qlmanage."""
    with tempfile.TemporaryDirectory() as tmpdir:
        result = subprocess.run(
            ["qlmanage", "-t", "-s", str(size), "-o", tmpdir, str(svg_path)],
            capture_output=True, timeout=10,
        )
        # qlmanage appends .png to filename
        candidates = list(Path(tmpdir).glob("*.png"))
        if candidates:
            dest = svg_path.with_suffix(f".{size}.png")
            candidates[0].replace(dest)
            return dest
    return None


def count_dark_pixels(png_path: Path) -> int:
    """Count pixels darker than threshold (foreground coverage)."""
    if not HAS_PILLOW:
        return 0
    img = Image.open(png_path).convert("L")
    pixels = list(img.getdata())
    return sum(1 for p in pixels if p < 128)


def validate_simplification(
    original: Path,
    simplified: Path,
    tolerance: float = 0.04,
) -> ValidationResult:
    """Compare rendered original vs simplified tile for visual equivalence."""
    try:
        orig_png = render_to_png(original)
        simp_png = render_to_png(simplified)

        if orig_png is None or simp_png is None:
            return ValidationResult(False, 0, 0, 1.0, "render_failed")

        orig_dark = count_dark_pixels(orig_png)
        simp_dark = count_dark_pixels(simp_png)
        total = 200 * 200

        orig_cov = orig_dark / total
        simp_cov = simp_dark / total
        diff = abs(orig_cov - simp_cov)

        # Clean up temp PNGs
        orig_png.unlink(missing_ok=True)
        simp_png.unlink(missing_ok=True)

        passed = diff <= tolerance
        return ValidationResult(passed, orig_cov, simp_cov, diff)
    except Exception as e:
        return ValidationResult(False, 0, 0, 1.0, str(e))


# ── Core per-tile simplification ────────────────────────
def simplify_tile(
    svg_path: Path,
    output_path: Path,
    skip_validation: bool = False,
) -> SimplificationResult:
    """Simplify a single tile and write the result."""
    try:
        clf = classify_tile(svg_path)
        rel = clf.rel_path

        # Empty tile
        if clf.is_clear and len(clf.fg_elements) == 0:
            write_empty_svg(output_path)
            return SimplificationResult(rel, "EMPTY", "clear_tile", 0, 0)

        # Build list of (d_string, fill_color) from all fg elements
        raw: list[tuple[str, str]] = []
        for tag, fill, elem in clf.fg_elements:
            d = elem_to_d(tag, elem)
            if not d.strip():
                continue
            raw.append((d, fill))

        if not raw:
            write_empty_svg(output_path)
            return SimplificationResult(rel, "EMPTY", "no_fg_shapes", 0, 0)

        # Clip paths that genuinely overflow the bounding box
        strategy_parts = []
        clipped: list[tuple[str, str]] = []
        for d, fill in raw:
            if needs_clipping(d):
                strategy_parts.append("geo_clip")
                d = clip_d_to_box(d)
            clipped.append((d, fill))

        if not strategy_parts:
            if clf.has_circles or clf.has_ellipses or clf.has_rects_fg:
                strategy_parts.append("primitive_convert")
            elif clf.has_nan:
                strategy_parts.append("nan_sanitize")
            elif len(raw) > 1:
                strategy_parts.append("multi_merge")
            else:
                strategy_parts.append("simple_strip")

        strategy = "+".join(strategy_parts) if strategy_parts else "simple_strip"
        if clf.has_mixed_colors:
            strategy += "+evenodd_holes"

        # Merge into compound path
        merged_d, fill_rule = merge_paths_to_compound(clipped)

        if not merged_d.strip():
            write_empty_svg(output_path)
            return SimplificationResult(rel, "EMPTY", strategy, len(raw), 0)

        write_simplified_svg(output_path, merged_d, fill_rule)

        # Raster validation
        validation = None
        if not skip_validation and HAS_PILLOW:
            validation = validate_simplification(svg_path, output_path)
            if not validation.passed:
                return SimplificationResult(
                    rel, "VALIDATION_FAILED", strategy,
                    len(raw), 1, validation
                )

        return SimplificationResult(
            rel, "OK", strategy,
            len(raw), 1, validation
        )

    except Exception as e:
        return SimplificationResult(
            "/".join(svg_path.parts[-2:]),
            "ERROR", "exception",
            0, 0, error=str(e)
        )


# ── Discovery ────────────────────────────────────────────
def discover_tiles(input_dir: Path) -> list[Path]:
    """Find all SVG tiles, excluding Lines/Lines.svg (reference file)."""
    tiles = []
    for svg in sorted(input_dir.rglob("*.svg")):
        # Skip the reference file
        if svg.name == "Lines.svg" and svg.parent.name == "Lines":
            continue
        tiles.append(svg)
    return tiles


# ── Report ───────────────────────────────────────────────
def write_report(results: list[SimplificationResult], output_path: Path):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ok      = [r for r in results if r.status == "OK"]
    failed  = [r for r in results if r.status == "VALIDATION_FAILED"]
    empty   = [r for r in results if r.status == "EMPTY"]
    errors  = [r for r in results if r.status == "ERROR"]

    lines = [
        "# Tile Simplification Report\n",
        f"**Total:** {len(results)}  |  "
        f"**OK:** {len(ok)}  |  "
        f"**Empty:** {len(empty)}  |  "
        f"**Validation failed:** {len(failed)}  |  "
        f"**Errors:** {len(errors)}\n",
        "",
        "## Strategy summary",
        "",
    ]
    from collections import Counter
    strategy_counts = Counter(r.strategy for r in results)
    for strat, count in sorted(strategy_counts.items(), key=lambda x: -x[1]):
        lines.append(f"- `{strat}`: {count}")
    lines.append("")

    if failed:
        lines += ["## Validation failures (manual review needed)", ""]
        for r in failed:
            v = r.validation
            diff_pct = v.diff * 100 if v else 0
            lines.append(
                f"- **{r.rel_path}**: orig={v.orig_coverage:.3f} "
                f"simp={v.simp_coverage:.3f} diff={diff_pct:.1f}%"
            )
        lines.append("")

    if errors:
        lines += ["## Errors", ""]
        for r in errors:
            lines.append(f"- **{r.rel_path}**: {r.error}")
        lines.append("")

    lines += ["## All results", "", "| File | Status | Strategy | FG shapes in |",
              "|---|---|---|---|"]
    for r in results:
        lines.append(f"| {r.rel_path} | {r.status} | {r.strategy} | {r.input_fg_count} |")

    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Report: {output_path}")


# ── Main ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI Tile Simplification")
    parser.add_argument("--input",  type=Path, default=INPUT_DIR)
    parser.add_argument("--output", type=Path, default=OUT_DIR)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--tile",   type=str,  default=None,
                        help='Process single tile, e.g. "Mirror/03.svg"')
    parser.add_argument("--skip-validation", action="store_true",
                        help="Skip raster validation (faster)")
    parser.add_argument("--classify-only", action="store_true",
                        help="Classify tiles and print summary, no output")
    args = parser.parse_args()

    tiles = discover_tiles(args.input)
    print(f"Found {len(tiles)} tiles in {args.input}")

    if args.tile:
        tiles = [t for t in tiles if t.name == Path(args.tile).name
                 or "/".join(t.parts[-2:]) == args.tile]
        if not tiles:
            print(f"No tile matching '{args.tile}'")
            sys.exit(1)

    if args.classify_only:
        from collections import Counter
        has_clip = has_nan = has_circles = has_ellipses = has_mixed = has_fg_rects = 0
        multi_fg = empty_count = 0
        for t in tiles:
            clf = classify_tile(t)
            if clf.has_clip: has_clip += 1
            if clf.has_nan: has_nan += 1
            if clf.has_circles: has_circles += 1
            if clf.has_ellipses: has_ellipses += 1
            if clf.has_mixed_colors: has_mixed += 1
            if clf.has_rects_fg: has_fg_rects += 1
            if len(clf.fg_elements) > 1: multi_fg += 1
            if clf.is_clear: empty_count += 1
        print(f"\nClassification summary ({len(tiles)} tiles):")
        print(f"  Has clipPath:        {has_clip}")
        print(f"  Has NaN in paths:    {has_nan}")
        print(f"  Has circles:         {has_circles}")
        print(f"  Has ellipses:        {has_ellipses}")
        print(f"  Has fg rects:        {has_fg_rects}")
        print(f"  Multi-shape tiles:   {multi_fg}")
        print(f"  Mixed colors:        {has_mixed}")
        print(f"  Empty/clear tiles:   {empty_count}")
        return

    print(f"Output: {args.output}")
    print(f"Validation: {'off' if args.skip_validation else 'on'}")
    print()

    results = []
    for i, tile_path in enumerate(tiles):
        rel = "/".join(tile_path.parts[-2:])
        # Mirror output path structure
        rel_from_input = tile_path.relative_to(args.input)
        output_path = args.output / rel_from_input

        result = simplify_tile(
            tile_path, output_path,
            skip_validation=args.skip_validation,
        )
        results.append(result)

        status_sym = {"OK": "✓", "EMPTY": "○", "VALIDATION_FAILED": "✗", "ERROR": "!"}.get(result.status, "?")
        print(f"  {status_sym} {rel:35s}  {result.strategy}")

    print()
    ok     = sum(1 for r in results if r.status == "OK")
    empty  = sum(1 for r in results if r.status == "EMPTY")
    failed = sum(1 for r in results if r.status == "VALIDATION_FAILED")
    errors = sum(1 for r in results if r.status == "ERROR")
    print(f"Done: {ok} OK  {empty} empty  {failed} failed  {errors} errors")

    write_report(results, args.report)


if __name__ == "__main__":
    main()
