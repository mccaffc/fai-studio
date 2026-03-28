#!/usr/bin/env python3
"""
Phase 1: SVG Audit & Cleanup

Reads Figma SVG exports, remaps off-brand colors to the canonical FAI
palette, normalizes viewBoxes, strips metadata, and generates an audit
report.

Usage:
    python clean_svgs.py --all
    python clean_svgs.py --shapes --freestyle
    python clean_svgs.py --banners --dry-run
    python clean_svgs.py --all --report-only
"""

import argparse
import copy
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

from lxml import etree
from svgpathtools import parse_path

try:
    from shapely.affinity import affine_transform as shapely_affine_transform
    from shapely.geometry import (
        GeometryCollection,
        LineString,
        MultiLineString,
        MultiPolygon,
        Point,
        Polygon,
        box as shapely_box,
    )
    from shapely.ops import unary_union
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False

# ── Resolve imports from sibling module ──────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import (
    BRAND_HEX_SET, COLOR_MAP, KEYWORD_MAP, HEX_TO_NAME,
    normalize_color, is_brand_color, color_name, HEX_RE,
)

# ── Constants ────────────────────────────────────────────
SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
NSMAP = {"svg": SVG_NS, "xlink": XLINK_NS}

BASE_DIR = Path(__file__).resolve().parent.parent
INPUT_SHAPES = BASE_DIR / "Figma Files" / "Shapes"
INPUT_FREESTYLE = BASE_DIR / "Figma Files" / "Freestyle"
INPUT_BANNERS = BASE_DIR / "Figma Files" / "Banners"
OUTPUT_SHAPES = BASE_DIR / "output" / "shapes-clean"
OUTPUT_FREESTYLE = BASE_DIR / "output" / "freestyle-clean"
OUTPUT_BANNERS = BASE_DIR / "output" / "banners-clean"
REPORT_PATH = BASE_DIR / "reports" / "audit-report.md"

# Files to exclude from processing
EXCLUDE_FILES = {"Lines.svg"}  # reference file with non-standard viewBox

# Expected dimensions per category
EXPECTED_DIMS = {
    "shapes":    (200, 200),
    "freestyle": (500, 500),
    "banners":   (1920, 960),
}

# Style attribute regex for extracting fill/stroke from inline styles
STYLE_COLOR_RE = re.compile(
    r"(fill|stroke)\s*:\s*([^;\"']+)", re.IGNORECASE
)
TRANSFORM_RE = re.compile(r"([A-Za-z]+)\(([^)]*)\)")
URL_REF_RE = re.compile(r"url\(#([^)]+)\)")
NUMBER_RE = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
SVG_PATH_COMMANDS = set("AaCcHhLlMmQqSsTtVvZz")
NAN_TOKEN_RE = re.compile(r"(?i)[-+]?nan")

IDENTITY_MATRIX = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
EPS = 1e-4


# ── Data Classes ─────────────────────────────────────────
@dataclass
class ColorChange:
    element_tag: str
    attribute: str       # "fill", "stroke", or "style:fill" / "style:stroke"
    old_value: str
    new_value: str


@dataclass
class FileResult:
    filepath: Path
    category: str
    relative_path: str   # e.g., "Circle/01.svg" or "01.svg"
    status: str = "CLEAN"  # CLEAN | AUTO_FIXED | NEEDS_MANUAL_FIX
    color_changes: list[ColorChange] = field(default_factory=list)
    viewbox_fix: Optional[str] = None
    metadata_stripped: list[str] = field(default_factory=list)
    stroke_notes: list[str] = field(default_factory=list)
    validation_failures: list[str] = field(default_factory=list)
    fill_colors_found: set = field(default_factory=set)
    stroke_colors_found: set = field(default_factory=set)
    has_clippath: bool = False
    has_mask: bool = False
    has_gradient: bool = False
    has_opacity: bool = False
    has_stroke: bool = False
    viewbox: Optional[str] = None
    skipped: bool = False
    skip_reason: str = ""


# ── SVG Parsing ──────────────────────────────────────────
def parse_svg(filepath: Path) -> etree._Element:
    """Parse an SVG file and return the root element."""
    parser = etree.XMLParser(remove_comments=True, remove_blank_text=True)
    tree = etree.parse(str(filepath), parser)
    return tree.getroot()


def serialize_svg(root: etree._Element) -> bytes:
    """Serialize an lxml element tree to SVG bytes."""
    return etree.tostring(
        root,
        xml_declaration=True,
        encoding="UTF-8",
        pretty_print=True,
    )


def local_tag(elem: etree._Element) -> str:
    """Return the non-namespaced tag name."""
    return etree.QName(elem.tag).localname if isinstance(elem.tag, str) else ""


def parse_numbers(text: str) -> list[float]:
    return [float(m.group(0)) for m in NUMBER_RE.finditer(text or "")]


def fmt_num(value: float) -> str:
    """Emit stable, compact numeric strings for SVG attributes."""
    if abs(value) < EPS:
        value = 0.0
    rounded = round(value)
    if abs(value - rounded) < EPS:
        return str(int(rounded))
    text = f"{value:.6f}".rstrip("0").rstrip(".")
    return text or "0"


def matrix_multiply(left: tuple[float, ...], right: tuple[float, ...]) -> tuple[float, ...]:
    """Compose SVG affine matrices using the SVG transform order."""
    a1, b1, c1, d1, e1, f1 = left
    a2, b2, c2, d2, e2, f2 = right
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def matrix_translate(tx: float, ty: float) -> tuple[float, ...]:
    return (1.0, 0.0, 0.0, 1.0, tx, ty)


def matrix_scale(sx: float, sy: float) -> tuple[float, ...]:
    return (sx, 0.0, 0.0, sy, 0.0, 0.0)


def matrix_rotate(deg: float) -> tuple[float, ...]:
    deg_norm = round(deg) % 360
    if deg_norm == 0:
        return IDENTITY_MATRIX
    if deg_norm == 90:
        return (0.0, 1.0, -1.0, 0.0, 0.0, 0.0)
    if deg_norm == 180:
        return (-1.0, 0.0, 0.0, -1.0, 0.0, 0.0)
    if deg_norm == 270:
        return (0.0, -1.0, 1.0, 0.0, 0.0, 0.0)
    raise ValueError(f"Unsupported rotation for cleanup: {deg}")


def parse_transform(transform: str) -> tuple[float, ...]:
    """Parse the subset of SVG transforms used in these exports."""
    matrix = IDENTITY_MATRIX
    if not transform:
        return matrix

    for name, raw_args in TRANSFORM_RE.findall(transform):
        nums = parse_numbers(raw_args)
        op = IDENTITY_MATRIX

        if name == "translate":
            tx = nums[0] if nums else 0.0
            ty = nums[1] if len(nums) > 1 else 0.0
            op = matrix_translate(tx, ty)
        elif name == "scale":
            sx = nums[0] if nums else 1.0
            sy = nums[1] if len(nums) > 1 else sx
            op = matrix_scale(sx, sy)
        elif name == "rotate":
            angle = nums[0] if nums else 0.0
            rot = matrix_rotate(angle)
            if len(nums) >= 3:
                cx, cy = nums[1], nums[2]
                op = matrix_multiply(
                    matrix_multiply(matrix_translate(cx, cy), rot),
                    matrix_translate(-cx, -cy),
                )
            else:
                op = rot
        elif name == "matrix" and len(nums) == 6:
            op = tuple(nums)  # type: ignore[assignment]
        else:
            continue

        matrix = matrix_multiply(matrix, op)

    return matrix


def apply_matrix(matrix: tuple[float, ...], x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = matrix
    return (a * x + c * y + e, b * x + d * y + f)


def union_bbox(
    left: Optional[tuple[float, float, float, float]],
    right: Optional[tuple[float, float, float, float]],
) -> Optional[tuple[float, float, float, float]]:
    if left is None:
        return right
    if right is None:
        return left
    return (
        min(left[0], right[0]),
        min(left[1], right[1]),
        max(left[2], right[2]),
        max(left[3], right[3]),
    )


def bbox_from_points(points: list[tuple[float, float]]) -> Optional[tuple[float, float, float, float]]:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def transform_bbox(
    bbox: tuple[float, float, float, float],
    matrix: tuple[float, ...],
) -> tuple[float, float, float, float]:
    xmin, ymin, xmax, ymax = bbox
    corners = [
        apply_matrix(matrix, xmin, ymin),
        apply_matrix(matrix, xmax, ymin),
        apply_matrix(matrix, xmax, ymax),
        apply_matrix(matrix, xmin, ymax),
    ]
    return bbox_from_points(corners)  # type: ignore[return-value]


def parse_points(points_attr: str) -> list[tuple[float, float]]:
    nums = parse_numbers(points_attr)
    points = []
    for idx in range(0, len(nums) - 1, 2):
        points.append((nums[idx], nums[idx + 1]))
    return points


def element_bbox(
    elem: etree._Element,
    inherited_matrix: tuple[float, ...] = IDENTITY_MATRIX,
) -> Optional[tuple[float, float, float, float]]:
    """Approximate a subtree bbox well enough to remove redundant rectangular clips."""
    if not isinstance(elem.tag, str):
        return None

    tag = local_tag(elem)
    if tag in {"defs", "style", "title", "desc"}:
        return None

    matrix = matrix_multiply(inherited_matrix, parse_transform(elem.get("transform")))

    if tag in {"svg", "g", "clipPath", "mask"}:
        bbox = None
        for child in elem:
            bbox = union_bbox(bbox, element_bbox(child, matrix))
        return bbox

    if tag == "path":
        d = elem.get("d")
        if not d:
            return None
        try:
            xmin, xmax, ymin, ymax = parse_path(d).bbox()
        except Exception:
            return None
        return transform_bbox((xmin, ymin, xmax, ymax), matrix)

    if tag == "rect":
        x = float(elem.get("x", "0"))
        y = float(elem.get("y", "0"))
        w = float(elem.get("width", "0"))
        h = float(elem.get("height", "0"))
        return transform_bbox((x, y, x + w, y + h), matrix)

    if tag == "circle":
        cx = float(elem.get("cx", "0"))
        cy = float(elem.get("cy", "0"))
        r = float(elem.get("r", "0"))
        return transform_bbox((cx - r, cy - r, cx + r, cy + r), matrix)

    if tag == "ellipse":
        cx = float(elem.get("cx", "0"))
        cy = float(elem.get("cy", "0"))
        rx = float(elem.get("rx", "0"))
        ry = float(elem.get("ry", "0"))
        return transform_bbox((cx - rx, cy - ry, cx + rx, cy + ry), matrix)

    if tag == "line":
        x1 = float(elem.get("x1", "0"))
        y1 = float(elem.get("y1", "0"))
        x2 = float(elem.get("x2", "0"))
        y2 = float(elem.get("y2", "0"))
        points = [apply_matrix(matrix, x1, y1), apply_matrix(matrix, x2, y2)]
        return bbox_from_points(points)

    if tag in {"polyline", "polygon"}:
        points = [apply_matrix(matrix, x, y) for x, y in parse_points(elem.get("points", ""))]
        return bbox_from_points(points)

    bbox = None
    for child in elem:
        bbox = union_bbox(bbox, element_bbox(child, matrix))
    return bbox


def bbox_contains(
    outer: tuple[float, float, float, float],
    inner: tuple[float, float, float, float],
    padding: float = 0.75,
) -> bool:
    return (
        inner[0] >= outer[0] - padding
        and inner[1] >= outer[1] - padding
        and inner[2] <= outer[2] + padding
        and inner[3] <= outer[3] + padding
    )


def rect_bbox(elem: etree._Element) -> Optional[tuple[float, float, float, float]]:
    if local_tag(elem) != "rect":
        return None
    try:
        x = float(elem.get("x", "0"))
        y = float(elem.get("y", "0"))
        w = float(elem.get("width", "0"))
        h = float(elem.get("height", "0"))
    except ValueError:
        return None
    matrix = parse_transform(elem.get("transform"))
    return transform_bbox((x, y, x + w, y + h), matrix)


def rect_can_be_axis_aligned(elem: etree._Element) -> bool:
    bbox = rect_bbox(elem)
    if bbox is None:
        return False
    x = float(elem.get("x", "0"))
    y = float(elem.get("y", "0"))
    w = float(elem.get("width", "0"))
    h = float(elem.get("height", "0"))
    matrix = parse_transform(elem.get("transform"))
    corners = [
        apply_matrix(matrix, x, y),
        apply_matrix(matrix, x + w, y),
        apply_matrix(matrix, x + w, y + h),
        apply_matrix(matrix, x, y + h),
    ]
    xs = sorted(p[0] for p in corners)
    ys = sorted(p[1] for p in corners)
    return (
        abs(xs[0] - xs[1]) < 0.75
        and abs(xs[2] - xs[3]) < 0.75
        and abs(ys[0] - ys[1]) < 0.75
        and abs(ys[2] - ys[3]) < 0.75
    )


def referenced_ids(root: etree._Element) -> set[str]:
    refs: set[str] = set()
    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue
        for attr_val in elem.attrib.values():
            for match in URL_REF_RE.finditer(attr_val):
                refs.add(match.group(1))
            if attr_val.startswith("#"):
                refs.add(attr_val[1:])
    return refs


def sampled_points_from_path(path_obj, samples_per_seg: int = 24) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for seg in path_obj:
        for idx in range(samples_per_seg + 1):
            t = idx / samples_per_seg
            pt = seg.point(t)
            points.append((pt.real, pt.imag))
    if points and points[0] != points[-1]:
        points.append(points[0])
    return points


def sampled_path_geometry(d: str, fill_rule: str = "nonzero"):
    """Approximate a filled path as Shapely geometry."""
    if not HAS_SHAPELY or not d:
        return None

    try:
        path_obj = parse_path(d)
    except Exception:
        return None

    geoms = []
    for subpath in path_obj.continuous_subpaths():
        pts = sampled_points_from_path(subpath)
        if len(pts) < 4:
            continue
        try:
            poly = Polygon(pts)
            if not poly.is_valid:
                poly = poly.buffer(0)
        except Exception:
            continue
        if not poly.is_empty:
            geoms.append(poly)

    if not geoms:
        return None

    if fill_rule.lower() == "evenodd":
        geom = geoms[0]
        for next_geom in geoms[1:]:
            geom = geom.symmetric_difference(next_geom)
        return geom

    return unary_union(geoms)


def apply_svg_matrix_to_geometry(geom, matrix: tuple[float, ...]):
    """Apply an SVG affine matrix to a Shapely geometry."""
    if not HAS_SHAPELY or geom is None:
        return geom
    if matrix == IDENTITY_MATRIX:
        return geom
    a, b, c, d, e, f = matrix
    return shapely_affine_transform(geom, [a, c, b, d, e, f])


def fill_geometry_from_element(elem: etree._Element):
    """Convert filled SVG primitives to approximate Shapely geometry."""
    if not HAS_SHAPELY or not isinstance(elem.tag, str):
        return None

    tag = local_tag(elem)
    geom = None

    try:
        if tag == "path":
            fill_rule = elem.get("fill-rule", "nonzero")
            geom = sampled_path_geometry(elem.get("d", ""), fill_rule=fill_rule)
        elif tag == "rect":
            x = float(elem.get("x", "0"))
            y = float(elem.get("y", "0"))
            w = float(elem.get("width", "0"))
            h = float(elem.get("height", "0"))
            geom = shapely_box(x, y, x + w, y + h)
        elif tag == "circle":
            cx = float(elem.get("cx", "0"))
            cy = float(elem.get("cy", "0"))
            r = float(elem.get("r", "0"))
            geom = Point(cx, cy).buffer(r, resolution=64)
        elif tag == "ellipse":
            cx = float(elem.get("cx", "0"))
            cy = float(elem.get("cy", "0"))
            rx = float(elem.get("rx", "0"))
            ry = float(elem.get("ry", "0"))
            geom = shapely_affine_transform(
                Point(cx, cy).buffer(1.0, resolution=64),
                [rx, 0.0, 0.0, ry, cx, cy],
            )
        elif tag == "polygon":
            pts = parse_points(elem.get("points", ""))
            if len(pts) >= 3:
                geom = Polygon(pts)
        elif tag == "polyline":
            pts = parse_points(elem.get("points", ""))
            if len(pts) >= 2:
                geom = LineString(pts)
        elif tag == "line":
            pts = [
                (float(elem.get("x1", "0")), float(elem.get("y1", "0"))),
                (float(elem.get("x2", "0")), float(elem.get("y2", "0"))),
            ]
            geom = LineString(pts)
    except Exception:
        return None

    if geom is None:
        return None

    if hasattr(geom, "is_valid") and not geom.is_valid:
        geom = geom.buffer(0)

    return apply_svg_matrix_to_geometry(geom, parse_transform(elem.get("transform")))


def stroke_geometry_from_element(elem: etree._Element):
    """Approximate a stroked SVG primitive as a filled geometry."""
    if not HAS_SHAPELY or not isinstance(elem.tag, str):
        return None

    stroke = elem.get("stroke", "")
    if not stroke or stroke.lower() == "none":
        return None

    try:
        stroke_width = float(elem.get("stroke-width", "1"))
    except ValueError:
        stroke_width = 1.0
    if stroke_width <= 0:
        return None

    tag = local_tag(elem)
    base = None

    try:
        if tag == "path":
            path_obj = parse_path(elem.get("d", ""))
            lines = []
            for subpath in path_obj.continuous_subpaths():
                pts = sampled_points_from_path(subpath)
                if len(pts) >= 2:
                    lines.append(LineString(pts))
            if len(lines) == 1:
                base = lines[0]
            elif lines:
                base = MultiLineString(lines)
        elif tag == "line":
            base = LineString([
                (float(elem.get("x1", "0")), float(elem.get("y1", "0"))),
                (float(elem.get("x2", "0")), float(elem.get("y2", "0"))),
            ])
        elif tag == "polyline":
            pts = parse_points(elem.get("points", ""))
            if len(pts) >= 2:
                base = LineString(pts)
        elif tag == "polygon":
            pts = parse_points(elem.get("points", ""))
            if len(pts) >= 3:
                base = LineString(pts + [pts[0]])
        elif tag in {"circle", "ellipse", "rect"}:
            fill_geom = fill_geometry_from_element(elem)
            if fill_geom is not None:
                cap = 1
                join = 1
                return fill_geom.boundary.buffer(stroke_width / 2.0, cap_style=cap, join_style=join)
    except Exception:
        return None

    if base is None:
        return None

    cap_map = {"round": 1, "butt": 2, "square": 3}
    join_map = {"round": 1, "miter": 2, "mitre": 2, "bevel": 3}
    cap_style = cap_map.get(elem.get("stroke-linecap", "round").lower(), 1)
    join_style = join_map.get(elem.get("stroke-linejoin", "round").lower(), 1)
    geom = base.buffer(stroke_width / 2.0, cap_style=cap_style, join_style=join_style)
    return apply_svg_matrix_to_geometry(geom, parse_transform(elem.get("transform")))


def geometry_from_element(elem: etree._Element):
    """Combine fill and stroke geometry for one SVG primitive."""
    if not HAS_SHAPELY or not isinstance(elem.tag, str):
        return None

    fill = elem.get("fill", "")
    stroke = elem.get("stroke", "")

    parts = []
    if fill and fill.lower() != "none":
        fill_geom = fill_geometry_from_element(elem)
        if fill_geom is not None and not fill_geom.is_empty:
            parts.append(fill_geom)

    if stroke and stroke.lower() != "none":
        stroke_geom = stroke_geometry_from_element(elem)
        if stroke_geom is not None and not stroke_geom.is_empty:
            parts.append(stroke_geom)

    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return unary_union(parts)


def geometry_to_path_d(geom) -> str:
    """Convert Shapely geometry back into SVG path data."""
    if geom is None or geom.is_empty:
        return ""

    def ring_to_path(coords) -> str:
        pts = list(coords)
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if not pts:
            return ""
        segments = [f"M{fmt_num(pts[0][0])},{fmt_num(pts[0][1])}"]
        segments.extend(f"L{fmt_num(x)},{fmt_num(y)}" for x, y in pts[1:])
        segments.append("Z")
        return " ".join(segments)

    if isinstance(geom, Polygon):
        parts = [ring_to_path(geom.exterior.coords)]
        parts.extend(ring_to_path(interior.coords) for interior in geom.interiors)
        return " ".join(part for part in parts if part)

    if isinstance(geom, MultiPolygon):
        return " ".join(geometry_to_path_d(part) for part in geom.geoms if not part.is_empty)

    if isinstance(geom, GeometryCollection):
        return " ".join(geometry_to_path_d(part) for part in geom.geoms if not part.is_empty)

    return ""


# ── Color Remapping ──────────────────────────────────────
def remap_colors(root: etree._Element) -> list[ColorChange]:
    """
    Walk all elements and normalize fill/stroke attributes.
    Handles both inline attributes and style-embedded colors.
    """
    changes = []

    for elem in root.iter():
        # Skip non-element nodes
        if not isinstance(elem.tag, str):
            continue

        # Process fill and stroke attributes
        for attr in ("fill", "stroke"):
            val = elem.get(attr)
            if val is not None:
                result = normalize_color(val)
                if result.normalized != val:
                    changes.append(ColorChange(
                        element_tag=etree.QName(elem.tag).localname if isinstance(elem.tag, str) else str(elem.tag),
                        attribute=attr,
                        old_value=val,
                        new_value=result.normalized,
                    ))
                    elem.set(attr, result.normalized)

        # Process inline style attribute
        style = elem.get("style")
        if style:
            new_style = style
            for match in STYLE_COLOR_RE.finditer(style):
                prop = match.group(1)  # fill or stroke
                color_val = match.group(2).strip()
                result = normalize_color(color_val)
                if result.normalized != color_val:
                    new_style = new_style.replace(
                        f"{prop}:{color_val}" if f"{prop}:{color_val}" in new_style
                        else f"{prop}: {color_val}",
                        f"{prop}:{result.normalized}" if ":" in match.group(0) and " " not in match.group(0).split(":")[1][:1]
                        else f"{prop}: {result.normalized}",
                    )
                    # Simpler: just replace the matched span
                    old_span = match.group(0)
                    new_span = f"{prop}: {result.normalized}"
                    new_style = new_style.replace(old_span, new_span, 1)
                    changes.append(ColorChange(
                        element_tag=etree.QName(elem.tag).localname,
                        attribute=f"style:{prop}",
                        old_value=color_val,
                        new_value=result.normalized,
                    ))
            if new_style != style:
                elem.set("style", new_style)

    return changes


# ── ViewBox Normalization ────────────────────────────────
def normalize_viewbox(root: etree._Element, category: str) -> Optional[str]:
    """
    Verify and fix viewBox + width/height attributes.
    Returns description of fix applied, or None.
    """
    expected_w, expected_h = EXPECTED_DIMS[category]

    vb = root.get("viewBox", "")
    width = root.get("width", "")
    height = root.get("height", "")

    fix_desc = None

    # Parse viewBox
    if vb:
        parts = vb.split()
        if len(parts) == 4:
            vb_x, vb_y, vb_w, vb_h = parts
            try:
                vb_w_f = float(vb_w)
                vb_h_f = float(vb_h)

                # Fix known anomaly: Banner 021.svg has width 1921
                if category == "banners" and abs(vb_w_f - expected_w) <= 2:
                    if vb_w_f != expected_w:
                        new_vb = f"{vb_x} {vb_y} {expected_w} {int(vb_h_f)}"
                        root.set("viewBox", new_vb)
                        fix_desc = f"viewBox width {vb_w} -> {expected_w}"

                if vb_h_f != expected_h and abs(vb_h_f - expected_h) <= 2:
                    new_vb = root.get("viewBox", "").split()
                    new_vb[3] = str(expected_h)
                    root.set("viewBox", " ".join(new_vb))
                    fix_desc = (fix_desc or "") + f"; viewBox height {vb_h} -> {expected_h}"

            except ValueError:
                pass

    # Fix width/height attributes to match expected
    if width:
        try:
            w_f = float(width)
            if abs(w_f - expected_w) <= 2 and w_f != expected_w:
                root.set("width", str(expected_w))
                fix_desc = (fix_desc or "") + f"; width {width} -> {expected_w}"
        except ValueError:
            pass

    if height:
        try:
            h_f = float(height)
            if abs(h_f - expected_h) <= 2 and h_f != expected_h:
                root.set("height", str(expected_h))
                fix_desc = (fix_desc or "") + f"; height {height} -> {expected_h}"
        except ValueError:
            pass

    return fix_desc.lstrip("; ") if fix_desc else None


# ── Metadata Stripping ───────────────────────────────────
def strip_figma_metadata(root: etree._Element) -> list[str]:
    """
    Remove non-essential Figma export artifacts while
    preserving all functional SVG content.
    """
    removed = []

    # Remove fill="none" on root <svg> (Figma default)
    if root.get("fill") == "none":
        del root.attrib["fill"]
        removed.append("fill='none' on root <svg>")

    # Remove non-essential export metadata on root
    for attr in ("version", "xml:space"):
        if attr in root.attrib:
            del root.attrib[attr]
            removed.append(f"root attr: {attr}")

    # Remove empty <title> and <desc> elements
    for tag in ("title", "desc"):
        for elem in root.findall(f".//{{{SVG_NS}}}{tag}"):
            if elem.text is None or elem.text.strip() == "":
                parent = elem.getparent()
                if parent is not None:
                    parent.remove(elem)
                    removed.append(f"empty <{tag}>")

    # Remove data-* attributes from all elements
    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue
        to_remove = [k for k in elem.attrib if k.startswith("data-")]
        for attr in to_remove:
            del elem.attrib[attr]
            removed.append(f"data-* attr: {attr}")

    return removed


def normalize_rect_transforms(root: etree._Element) -> list[str]:
    """Rewrite simple rotated/mirrored rects as axis-aligned rects."""
    notes = []
    for elem in root.iterfind(".//svg:rect", namespaces=NSMAP):
        transform = elem.get("transform")
        if not transform:
            continue
        if not rect_can_be_axis_aligned(elem):
            continue

        bbox = rect_bbox(elem)
        if bbox is None:
            continue

        xmin, ymin, xmax, ymax = bbox
        elem.set("x", fmt_num(xmin))
        elem.set("y", fmt_num(ymin))
        elem.set("width", fmt_num(xmax - xmin))
        elem.set("height", fmt_num(ymax - ymin))
        del elem.attrib["transform"]
        notes.append(f"rect transform -> xywh on <{local_tag(elem)}>")

    return notes


def fill_color_for_element(elem: etree._Element) -> str:
    """Choose the fill color to use after flattening geometry."""
    fill = elem.get("fill", "")
    if fill and fill.lower() != "none":
        return fill
    stroke = elem.get("stroke", "")
    if stroke and stroke.lower() != "none":
        return stroke
    return "#121212"


def sanitize_path_d(d: str) -> str:
    """Drop malformed SVG command segments containing NaN coordinates."""
    if not d or "nan" not in d.lower():
        return d

    segments = []
    i = 0
    while i < len(d):
        char = d[i]
        if char in SVG_PATH_COMMANDS and (i == 0 or not d[i - 1].isalpha()):
            j = i + 1
            while j < len(d):
                next_char = d[j]
                if next_char in SVG_PATH_COMMANDS and not d[j - 1].isalpha():
                    break
                j += 1
            segments.append(d[i:j].strip())
            i = j
            continue
        i += 1

    kept_segments = [
        segment
        for segment in segments
        if not NAN_TOKEN_RE.search(segment)
    ]
    return " ".join(segment for segment in kept_segments if segment)


def sanitize_path_data(root: etree._Element) -> list[str]:
    """Remove invalid NaN command segments before geometry or bbox passes."""
    notes = []
    for elem in root.iterfind(".//svg:path", namespaces=NSMAP):
        d = elem.get("d", "")
        cleaned = sanitize_path_d(d)
        if cleaned and cleaned != d:
            elem.set("d", cleaned)
            notes.append("removed NaN path segment")
    return notes


def replace_with_filled_path(elem: etree._Element, geom, clip_bbox=None) -> bool:
    """Replace a primitive element with a filled path derived from geometry."""
    if geom is None or geom.is_empty:
        parent = elem.getparent()
        if parent is not None:
            parent.remove(elem)
        return True

    if clip_bbox is not None:
        geom = geom.intersection(shapely_box(*clip_bbox))
        if geom.is_empty:
            parent = elem.getparent()
            if parent is not None:
                parent.remove(elem)
            return True

    d = geometry_to_path_d(geom)
    if not d:
        return False

    new_elem = etree.Element(f"{{{SVG_NS}}}path")
    new_elem.set("d", d)
    new_elem.set("fill", fill_color_for_element(elem))
    if "fill-rule" in elem.attrib:
        new_elem.set("fill-rule", elem.attrib["fill-rule"])
    if "clip-rule" in elem.attrib:
        new_elem.set("clip-rule", elem.attrib["clip-rule"])

    parent = elem.getparent()
    if parent is None:
        return False
    parent.replace(elem, new_elem)
    return True


def convert_strokes_to_fills(root: etree._Element) -> list[str]:
    """Convert stroked artwork into filled paths where possible."""
    notes = []
    if not HAS_SHAPELY:
        return notes

    for elem in list(root.iter()):
        if not isinstance(elem.tag, str):
            continue
        stroke = elem.get("stroke", "")
        if not stroke or stroke.lower() == "none":
            continue

        geom = geometry_from_element(elem)
        if geom is None:
            continue
        if replace_with_filled_path(elem, geom):
            notes.append(f"stroke converted to fill on <{local_tag(elem)}>")

    return notes


def clip_rects_by_id(root: etree._Element) -> dict[str, tuple[float, float, float, float]]:
    """Return simple rectangular clipPath bboxes keyed by id."""
    rects: dict[str, tuple[float, float, float, float]] = {}
    for clip in root.iterfind(".//svg:clipPath", namespaces=NSMAP):
        clip_id = clip.get("id")
        if not clip_id:
            continue
        children = [child for child in clip if isinstance(child.tag, str)]
        if len(children) != 1 or local_tag(children[0]) != "rect":
            continue
        bbox = rect_bbox(children[0])
        if bbox is not None:
            rects[clip_id] = bbox
    return rects


def simple_masks_by_id(root: etree._Element) -> dict[str, tuple[float, float, float, float]]:
    """Return opaque full-rect masks that can be dropped when redundant."""
    masks: dict[str, tuple[float, float, float, float]] = {}
    for mask in root.iterfind(".//svg:mask", namespaces=NSMAP):
        mask_id = mask.get("id")
        if not mask_id:
            continue
        children = [child for child in mask if isinstance(child.tag, str)]
        if len(children) != 1 or local_tag(children[0]) != "rect":
            continue
        bbox = rect_bbox(children[0])
        fill = children[0].get("fill", "").strip().upper()
        if bbox is not None and fill not in {"NONE", ""}:
            masks[mask_id] = bbox
    return masks


def flatten_rectangular_clip_groups(root: etree._Element) -> list[str]:
    """Replace rectangular clip/mask groups with plain clipped geometry."""
    notes = []
    if not HAS_SHAPELY:
        return notes

    clip_rects = clip_rects_by_id(root)
    mask_rects = simple_masks_by_id(root)

    for group in list(root.iterfind(".//svg:g", namespaces=NSMAP)):
        if not isinstance(group.tag, str):
            continue

        clip_bbox = None
        clip_attr_name = None

        clip_attr = group.get("clip-path")
        if clip_attr:
            match = URL_REF_RE.fullmatch(clip_attr.strip())
            if match:
                clip_bbox = clip_rects.get(match.group(1))
                clip_attr_name = "clip-path"

        if clip_bbox is None:
            mask_attr = group.get("mask")
            if mask_attr:
                match = URL_REF_RE.fullmatch(mask_attr.strip())
                if match:
                    clip_bbox = mask_rects.get(match.group(1))
                    clip_attr_name = "mask"

        if clip_bbox is None or clip_attr_name is None:
            continue

        convertible = True
        for child in list(group):
            if not isinstance(child.tag, str):
                continue
            tag = local_tag(child)
            if tag in {"defs", "title", "desc"}:
                continue
            if tag == "g":
                convertible = False
                break

            bbox = element_bbox(child)
            overflow = bbox is not None and not bbox_contains(clip_bbox, bbox)
            if tag in {"path", "circle", "ellipse", "rect", "polygon", "polyline", "line"}:
                if overflow or child.get("stroke", "").lower() not in {"", "none"}:
                    geom = geometry_from_element(child)
                    if geom is None or not replace_with_filled_path(child, geom, clip_bbox=clip_bbox):
                        convertible = False
                        break
                continue

            convertible = False
            break

        if not convertible:
            continue

        if clip_attr_name in group.attrib:
            del group.attrib[clip_attr_name]
        notes.append(f"flattened rectangular {clip_attr_name} on <g>")

    return notes


def remove_redundant_clips(root: etree._Element) -> list[str]:
    """Drop clip-path attributes when the clipped content is already inside the clip rect."""
    notes = []
    clip_rects = clip_rects_by_id(root)

    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue
        clip_attr = elem.get("clip-path")
        if not clip_attr:
            continue
        match = URL_REF_RE.fullmatch(clip_attr.strip())
        if not match:
            continue
        clip_bbox = clip_rects.get(match.group(1))
        if clip_bbox is None:
            continue

        bbox = element_bbox(elem)
        if bbox is None:
            continue
        if bbox_contains(clip_bbox, bbox):
            del elem.attrib["clip-path"]
            notes.append(f"removed redundant clip-path on <{local_tag(elem)}>")

    return notes


def remove_redundant_masks(root: etree._Element) -> list[str]:
    """Drop simple full-frame masks that do not alter the rendered result."""
    notes = []
    root_bbox = element_bbox(root)
    if root_bbox is None:
        return notes

    masks = simple_masks_by_id(root)
    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue
        mask_attr = elem.get("mask")
        if not mask_attr:
            continue
        match = URL_REF_RE.fullmatch(mask_attr.strip())
        if not match:
            continue
        mask_bbox = masks.get(match.group(1))
        if mask_bbox is None:
            continue

        bbox = element_bbox(elem)
        if bbox is None:
            continue
        if bbox_contains(mask_bbox, bbox) and bbox_contains(mask_bbox, root_bbox, padding=1.0):
            del elem.attrib["mask"]
            notes.append(f"removed redundant mask on <{local_tag(elem)}>")

    return notes


def prune_unused_defs(root: etree._Element) -> list[str]:
    """Remove unused clip/mask/gradient definitions and empty defs wrappers."""
    notes = []
    refs = referenced_ids(root)

    for defs in list(root.iterfind(".//svg:defs", namespaces=NSMAP)):
        for child in list(defs):
            if not isinstance(child.tag, str):
                continue
            child_id = child.get("id")
            if child_id and child_id in refs:
                continue
            defs.remove(child)
            notes.append(f"unused <{local_tag(child)}> removed from <defs>")
        if len(defs) == 0:
            parent = defs.getparent()
            if parent is not None:
                parent.remove(defs)
                notes.append("empty <defs> removed")

    return notes


def prune_unused_reference_elements(root: etree._Element) -> list[str]:
    """Remove unused clip/mask/gradient elements that live outside <defs>."""
    notes = []
    refs = referenced_ids(root)
    removable_tags = {"clipPath", "mask", "linearGradient", "radialGradient", "pattern"}

    for elem in list(root.iter()):
        if not isinstance(elem.tag, str):
            continue
        if local_tag(elem) not in removable_tags:
            continue
        elem_id = elem.get("id")
        if not elem_id or elem_id in refs:
            continue
        parent = elem.getparent()
        if parent is None:
            continue
        parent.remove(elem)
        notes.append(f"removed unused <{local_tag(elem)}>")

    return notes


def strip_unreferenced_ids(root: etree._Element) -> list[str]:
    """Remove ids that are not referenced anywhere in the document."""
    notes = []
    refs = referenced_ids(root)
    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue
        elem_id = elem.get("id")
        if not elem_id or elem_id in refs:
            continue
        del elem.attrib["id"]
        notes.append(f"removed unreferenced id on <{local_tag(elem)}>")
    return notes


def element_signature(elem: etree._Element):
    """Create a canonical subtree signature that ignores XML attribute ordering."""
    if not isinstance(elem.tag, str):
        return ("__non_element__",)
    return (
        local_tag(elem),
        tuple(sorted(elem.attrib.items())),
        (elem.text or "").strip(),
        tuple(element_signature(child) for child in elem if isinstance(child.tag, str)),
    )


def simplify_groups_and_duplicates(root: etree._Element) -> list[str]:
    """Flatten empty groups and remove duplicate sibling elements."""
    notes = []

    def visit(parent: etree._Element):
        for child in list(parent):
            if isinstance(child.tag, str):
                visit(child)

        seen: set[bytes] = set()
        for child in list(parent):
            if not isinstance(child.tag, str):
                continue
            if local_tag(child) == "defs":
                continue
            sig = element_signature(child)
            if sig in seen:
                parent.remove(child)
                notes.append(f"removed duplicate <{local_tag(child)}> sibling")
                continue
            seen.add(sig)

        for child in list(parent):
            if not isinstance(child.tag, str):
                continue
            if local_tag(child) != "g" or child.attrib:
                continue
            idx = parent.index(child)
            for grandchild in list(child):
                child.remove(grandchild)
                parent.insert(idx, grandchild)
                idx += 1
            parent.remove(child)
            notes.append("unwrapped empty <g>")

    visit(root)
    return notes


def structural_cleanup(root: etree._Element) -> list[str]:
    """Second-pass cleanup focused on Figma export structure."""
    notes = []
    notes.extend(sanitize_path_data(root))
    notes.extend(normalize_rect_transforms(root))
    notes.extend(convert_strokes_to_fills(root))
    notes.extend(flatten_rectangular_clip_groups(root))
    notes.extend(remove_redundant_clips(root))
    notes.extend(remove_redundant_masks(root))
    notes.extend(prune_unused_defs(root))
    notes.extend(prune_unused_reference_elements(root))
    notes.extend(strip_unreferenced_ids(root))
    notes.extend(simplify_groups_and_duplicates(root))
    notes.extend(prune_unused_defs(root))
    notes.extend(prune_unused_reference_elements(root))
    return notes


def run_structural_cleanup(root: etree._Element, max_passes: int = 3) -> list[str]:
    """Repeat structural cleanup until it stops making changes."""
    all_notes = []
    for _ in range(max_passes):
        pass_notes = structural_cleanup(root)
        if not pass_notes:
            break
        all_notes.extend(pass_notes)
    return all_notes


# ── Stroke Handling ──────────────────────────────────────
def handle_strokes(root: etree._Element, category: str) -> list[str]:
    """
    Category-specific stroke handling.
    Returns list of notes about strokes found.
    """
    notes = []
    has_strokes = False

    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue

        stroke_val = elem.get("stroke")
        stroke_width = elem.get("stroke-width")

        # Also check style attribute
        style = elem.get("style", "")
        style_has_stroke = "stroke:" in style.lower() or "stroke-width:" in style.lower()

        if stroke_val and stroke_val.lower() != "none":
            has_strokes = True

            # Remap stroke colors through the color map
            result = normalize_color(stroke_val)
            if result.normalized != stroke_val:
                elem.set("stroke", result.normalized)
                notes.append(f"Stroke remapped: {stroke_val} -> {result.normalized}")

            if category == "shapes":
                notes.append(f"WARNING: Unexpected stroke in shapes: {stroke_val}")
            elif category == "freestyle":
                tag = etree.QName(elem.tag).localname
                notes.append(f"Stroke preserved on <{tag}>: {result.normalized} (width={stroke_width})")
            elif category == "banners":
                notes.append(f"WARNING: Unexpected stroke in banners: {stroke_val}")

    return notes


# ── Audit (read-only analysis) ───────────────────────────
def audit_file(root: etree._Element, filepath: Path, category: str) -> FileResult:
    """Non-destructive analysis of one SVG file."""
    rel = filepath.name
    if category == "shapes":
        # Include subfolder in relative path
        parent = filepath.parent.name
        if parent != "Shapes":
            rel = f"{parent}/{filepath.name}"

    result = FileResult(
        filepath=filepath,
        category=category,
        relative_path=rel,
        viewbox=root.get("viewBox", ""),
    )

    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue

        tag = etree.QName(elem.tag).localname

        # Collect fill colors
        fill = elem.get("fill")
        if fill and fill.lower() != "none" and not fill.startswith("url("):
            result.fill_colors_found.add(fill)

        # Collect stroke colors
        stroke = elem.get("stroke")
        if stroke and stroke.lower() != "none":
            result.stroke_colors_found.add(stroke)
            result.has_stroke = True

        # Check for style-embedded colors
        style = elem.get("style", "")
        for m in STYLE_COLOR_RE.finditer(style):
            color_val = m.group(2).strip()
            if m.group(1).lower() == "fill":
                result.fill_colors_found.add(color_val)
            else:
                result.stroke_colors_found.add(color_val)
                result.has_stroke = True

        # Check for special features
        if tag == "clipPath":
            result.has_clippath = True
        elif tag == "mask":
            result.has_mask = True
        elif tag in ("linearGradient", "radialGradient"):
            result.has_gradient = True

        # Check for opacity
        opacity = elem.get("opacity")
        fill_opacity = elem.get("fill-opacity")
        if opacity and opacity != "1":
            result.has_opacity = True
        if fill_opacity and fill_opacity != "1":
            result.has_opacity = True

    return result


# ── Full Clean Pipeline ──────────────────────────────────
def clean_file(filepath: Path, category: str, dry_run: bool = False) -> FileResult:
    """
    Full cleanup pipeline for one SVG file.
    Returns FileResult with all changes logged.
    """
    root = parse_svg(filepath)

    # Audit first (on the original)
    result = audit_file(copy.deepcopy(root), filepath, category)

    # Apply cleaning operations
    color_changes = remap_colors(root)
    viewbox_fix = normalize_viewbox(root, category)
    metadata_stripped = strip_figma_metadata(root)
    metadata_stripped.extend(run_structural_cleanup(root))
    stroke_notes = handle_strokes(root, category)

    # Validate final state
    validation_failures = validate_final(root)
    final_audit = audit_file(copy.deepcopy(root), filepath, category)

    # Determine status
    result.color_changes = color_changes
    result.viewbox_fix = viewbox_fix
    result.metadata_stripped = metadata_stripped
    result.stroke_notes = stroke_notes
    result.validation_failures = validation_failures
    result.fill_colors_found = final_audit.fill_colors_found
    result.stroke_colors_found = final_audit.stroke_colors_found
    result.has_clippath = final_audit.has_clippath
    result.has_mask = final_audit.has_mask
    result.has_gradient = final_audit.has_gradient
    result.has_opacity = final_audit.has_opacity
    result.has_stroke = final_audit.has_stroke

    if validation_failures:
        result.status = "NEEDS_MANUAL_FIX"
    elif color_changes or viewbox_fix or metadata_stripped:
        result.status = "AUTO_FIXED"
    else:
        result.status = "CLEAN"

    # Flag freestyle files with strokes as needing manual review
    if category == "freestyle" and result.has_stroke:
        any_stroke_only = any("stroke-width" in n.lower() or "stroke preserved" in n.lower()
                              for n in stroke_notes)
        if any_stroke_only:
            result.status = "NEEDS_MANUAL_FIX"
            result.stroke_notes.append("Contains stroke-based elements — may need manual conversion to filled paths")

    # Write output if not dry run
    if not dry_run:
        write_output(root, filepath, category)

    return result


def validate_final(root: etree._Element) -> list[str]:
    """
    Post-cleaning validation: confirm every fill/stroke is brand-compliant.
    """
    failures = []

    for elem in root.iter():
        if not isinstance(elem.tag, str):
            continue

        for attr in ("fill", "stroke"):
            val = elem.get(attr)
            if val is None:
                continue

            val_upper = val.strip().upper()

            # Allowed values
            if val_upper == "NONE":
                continue
            if val.startswith("url("):
                continue
            if val_upper in BRAND_HEX_SET:
                continue

            tag = etree.QName(elem.tag).localname
            failures.append(f"<{tag}> {attr}={val} — not a brand color")

    return failures


def write_output(root: etree._Element, input_path: Path, category: str):
    """Write cleaned SVG to the appropriate output directory."""
    if category == "shapes":
        parent = input_path.parent.name
        if parent == "Shapes":
            # Root-level file (e.g., Clear.svg)
            out_path = OUTPUT_SHAPES / input_path.name
        else:
            out_dir = OUTPUT_SHAPES / parent
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / input_path.name
    elif category == "freestyle":
        out_path = OUTPUT_FREESTYLE / input_path.name
    elif category == "banners":
        out_path = OUTPUT_BANNERS / input_path.name
    else:
        raise ValueError(f"Unknown category: {category}")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    svg_bytes = serialize_svg(root)
    out_path.write_bytes(svg_bytes)


# ── File Discovery ───────────────────────────────────────
def discover_files(category: str) -> list[Path]:
    """Find all SVG files for a given category."""
    if category == "shapes":
        input_dir = INPUT_SHAPES
    elif category == "freestyle":
        input_dir = INPUT_FREESTYLE
    elif category == "banners":
        input_dir = INPUT_BANNERS
    else:
        raise ValueError(f"Unknown category: {category}")

    files = []
    for p in sorted(input_dir.rglob("*.svg")):
        if p.name in EXCLUDE_FILES:
            continue
        files.append(p)

    return files


# ── Report Generation ────────────────────────────────────
def generate_report(all_results: list[FileResult], output_path: Path):
    """Generate the markdown audit report."""
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Group by category
    by_cat = {"shapes": [], "freestyle": [], "banners": []}
    for r in all_results:
        by_cat[r.category].append(r)

    # Count statuses
    total = len(all_results)
    clean = sum(1 for r in all_results if r.status == "CLEAN")
    auto_fixed = sum(1 for r in all_results if r.status == "AUTO_FIXED")
    manual = sum(1 for r in all_results if r.status == "NEEDS_MANUAL_FIX")
    skipped = sum(1 for r in all_results if r.skipped)

    # Aggregate color changes
    all_color_changes = []
    for r in all_results:
        all_color_changes.extend(r.color_changes)

    remap_counts: dict[str, int] = {}
    for cc in all_color_changes:
        key = f"{cc.old_value} -> {cc.new_value}"
        remap_counts[key] = remap_counts.get(key, 0) + 1

    lines = [
        "# FAI Illustration System — Phase 1 Audit Report",
        f"\n**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"\n**Total files processed:** {total - skipped}",
        "",
        "## Summary",
        "",
        "| Status | Count |",
        "|--------|-------|",
        f"| CLEAN (no changes needed) | {clean} |",
        f"| AUTO_FIXED | {auto_fixed} |",
        f"| NEEDS_MANUAL_FIX | {manual} |",
        f"| Skipped (excluded) | {skipped} |",
        "",
        f"**Total color remappings performed:** {len(all_color_changes)}",
        "",
    ]

    # Exclusions
    excluded = [r for r in all_results if r.skipped]
    if excluded:
        lines.extend([
            "## Exclusions",
            "",
        ])
        for r in excluded:
            lines.append(f"- **{r.relative_path}**: {r.skip_reason}")
        lines.append("")

    # Color Remapping Summary
    if remap_counts:
        lines.extend([
            "## Color Remapping Summary",
            "",
            "| Original | Mapped To | Brand Name | Occurrences |",
            "|----------|-----------|------------|-------------|",
        ])
        for key in sorted(remap_counts.keys()):
            old, new = key.split(" -> ")
            name = color_name(new)
            lines.append(f"| `{old}` | `{new}` | {name} | {remap_counts[key]} |")
        lines.append("")

    # Per-category details
    for cat_name, cat_results in [("Shapes", by_cat["shapes"]),
                                   ("Freestyle", by_cat["freestyle"]),
                                   ("Banners", by_cat["banners"])]:
        if not cat_results:
            continue

        active = [r for r in cat_results if not r.skipped]
        lines.extend([
            f"## {cat_name} ({len(active)} files)",
            "",
            "| File | Status | Colors Remapped | ClipPath | Mask | Stroke | Notes |",
            "|------|--------|-----------------|----------|------|--------|-------|",
        ])

        for r in sorted(active, key=lambda x: x.relative_path):
            notes_parts = []
            if r.viewbox_fix:
                notes_parts.append(f"ViewBox: {r.viewbox_fix}")
            if r.validation_failures:
                notes_parts.append(f"Validation: {'; '.join(r.validation_failures[:3])}")
            if r.stroke_notes:
                # Summarize stroke notes
                stroke_summary = [n for n in r.stroke_notes if "WARNING" in n or "manual" in n.lower()]
                if stroke_summary:
                    notes_parts.append(stroke_summary[0][:60])

            notes = "; ".join(notes_parts) if notes_parts else ""

            lines.append(
                f"| {r.relative_path} | {r.status} | {len(r.color_changes)} "
                f"| {'Yes' if r.has_clippath else ''} "
                f"| {'Yes' if r.has_mask else ''} "
                f"| {'Yes' if r.has_stroke else ''} "
                f"| {notes} |"
            )

        lines.append("")

    # Manual Review Required
    manual_items = [r for r in all_results if r.status == "NEEDS_MANUAL_FIX"]
    if manual_items:
        lines.extend([
            "## Manual Review Required",
            "",
        ])
        for r in manual_items:
            lines.append(f"### {r.relative_path} ({r.category})")
            if r.validation_failures:
                lines.append("**Validation failures:**")
                for f in r.validation_failures:
                    lines.append(f"- {f}")
            if r.stroke_notes:
                lines.append("**Stroke notes:**")
                for n in r.stroke_notes:
                    lines.append(f"- {n}")
            lines.append("")

    report_text = "\n".join(lines) + "\n"
    output_path.write_text(report_text)
    print(f"\nAudit report written to: {output_path}")


# ── Main ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI SVG Audit & Cleanup")
    parser.add_argument("--shapes", action="store_true", help="Process shape tiles")
    parser.add_argument("--freestyle", action="store_true", help="Process freestyle illustrations")
    parser.add_argument("--banners", action="store_true", help="Process banner compositions")
    parser.add_argument("--all", action="store_true", help="Process all categories")
    parser.add_argument("--dry-run", action="store_true", help="Log changes without writing files")
    parser.add_argument("--report-only", action="store_true", help="Generate report without cleaning")
    args = parser.parse_args()

    if args.all:
        args.shapes = args.freestyle = args.banners = True

    if not (args.shapes or args.freestyle or args.banners):
        parser.error("Specify at least one category: --shapes, --freestyle, --banners, or --all")

    categories = []
    if args.shapes:
        categories.append("shapes")
    if args.freestyle:
        categories.append("freestyle")
    if args.banners:
        categories.append("banners")

    all_results: list[FileResult] = []

    for category in categories:
        files = discover_files(category)
        print(f"\n{'='*60}")
        print(f"Processing {category}: {len(files)} files")
        print(f"{'='*60}")

        for filepath in files:
            if args.report_only:
                root = parse_svg(filepath)
                result = audit_file(root, filepath, category)
                # Still count color issues
                for color in result.fill_colors_found:
                    r = normalize_color(color)
                    if r.was_remapped:
                        result.color_changes.append(ColorChange("(audit)", "fill", color, r.normalized))
                if result.has_stroke:
                    result.status = "NEEDS_MANUAL_FIX" if category == "freestyle" else result.status
            else:
                result = clean_file(filepath, category, dry_run=args.dry_run)

            all_results.append(result)

            # Print per-file summary
            status_icon = {"CLEAN": "  ", "AUTO_FIXED": "\u2713 ", "NEEDS_MANUAL_FIX": "! "}
            icon = status_icon.get(result.status, "  ")
            changes = len(result.color_changes)
            suffix = f" ({changes} color remaps)" if changes else ""
            vb_note = f" [viewBox fix]" if result.viewbox_fix else ""
            stroke_note = " [has strokes]" if result.has_stroke else ""
            print(f"  {icon}{result.relative_path:40s} {result.status}{suffix}{vb_note}{stroke_note}")

    # Add entry for excluded files
    for excl in EXCLUDE_FILES:
        excl_result = FileResult(
            filepath=INPUT_SHAPES / "Lines" / excl,
            category="shapes",
            relative_path=f"Lines/{excl}",
            skipped=True,
            skip_reason="Reference file: non-standard viewBox (240x460), purple stroke #8A38F5",
        )
        all_results.append(excl_result)

    # Generate report
    generate_report(all_results, REPORT_PATH)

    # Print final summary
    active = [r for r in all_results if not r.skipped]
    print(f"\n{'='*60}")
    print(f"DONE: {len(active)} files processed")
    print(f"  CLEAN: {sum(1 for r in active if r.status == 'CLEAN')}")
    print(f"  AUTO_FIXED: {sum(1 for r in active if r.status == 'AUTO_FIXED')}")
    print(f"  NEEDS_MANUAL_FIX: {sum(1 for r in active if r.status == 'NEEDS_MANUAL_FIX')}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
