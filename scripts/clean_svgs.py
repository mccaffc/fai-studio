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
    parser = etree.XMLParser(remove_comments=True, remove_blank_text=False)
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
    stroke_notes = handle_strokes(root, category)

    # Validate final state
    validation_failures = validate_final(root)

    # Determine status
    result.color_changes = color_changes
    result.viewbox_fix = viewbox_fix
    result.metadata_stripped = metadata_stripped
    result.stroke_notes = stroke_notes
    result.validation_failures = validation_failures

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
