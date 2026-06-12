#!/usr/bin/env python3
"""
audit_grouping.py — one-off audit sheet for the FAI Pattern Studio rebuild.

Lays out the 140 legacy tiles GROUPED BY THE PROPOSED 7 CATEGORIES (not by
original family), recolored to the banner aesthetic (ink on Cod Gray), with a
handful of NEW Bauhaus shapes per family to show the "rounded out" vision.

  python scripts/audit_grouping.py            # -> output/audit/grouping.svg (+ .png)

Render PNG with cairo on the path:
  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib \
    $HOME/.cache/fai-deck-venv/bin/python scripts/audit_grouping.py
"""
from __future__ import annotations
import html
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
TILES = BASE / "output" / "shapes-clean"
OUT = BASE / "output" / "audit"

GROUND = "#121212"
INK = "#F3F3F3"
BRAND = "#FF4F00"
SHEET_BG = "#1d1d1f"
CARD_BORDER = "#3a3a3a"
LABEL = "#9a9a9a"

# ── Category definitions ────────────────────────────────────────────────
# Each: (name, subtitle, ink_color, members, new_shapes)
# members: list of (family, [ids] or "*" for whole family)
# new_shapes: list of (label, svg_inner)  — drawn 0..200, ink fill

def tri(pts, fill=None):
    return f'<polygon points="{pts}" fill="{fill or "INK"}"/>'

NEW = {
    "mega-tri":   '<polygon points="0,0 200,0 0,200" fill="INK"/>',
    "tri-fan":    '<polygon points="100,100 0,0 90,0" fill="INK"/><polygon points="100,100 110,0 200,0" fill="INK"/><polygon points="100,100 200,90 200,180" fill="INK"/>',
    "hatch-field":'<rect x="20" width="22" height="200" fill="INK"/><rect x="64" width="22" height="200" fill="INK"/><rect x="108" width="22" height="200" fill="INK"/><rect x="152" width="22" height="200" fill="INK"/>',
    "bold-bar":   '<rect x="74" width="52" height="200" fill="INK"/>',
    "rings-conc": '<path d="M0 200 A200 200 0 0 1 200 0 L160 0 A160 160 0 0 0 0 160 Z" fill="INK"/><path d="M0 120 A120 120 0 0 1 120 0 L80 0 A80 80 0 0 0 0 80 Z" fill="INK"/><path d="M0 40 A40 40 0 0 1 40 0 L0 0 Z" fill="INK"/>',
    "half-ring":  '<path d="M0 100 A100 100 0 0 1 200 100 L150 100 A50 50 0 0 0 50 100 Z" fill="INK"/>',
    "dot-grid":   ''.join(f'<circle cx="{40+x*60}" cy="{40+y*60}" r="20" fill="INK"/>' for x in range(3) for y in range(3)),
    "target":     '<circle cx="100" cy="100" r="92" fill="INK"/><circle cx="100" cy="100" r="62" fill="GROUND"/><circle cx="100" cy="100" r="34" fill="INK"/>',
    "h-pill":     '<rect x="6" y="60" width="188" height="80" rx="40" fill="INK"/>',
    "lens":       '<path d="M100 8 A150 150 0 0 1 100 192 A150 150 0 0 1 100 8 Z" fill="INK"/>',
    "sine":       '<path d="M0 70 C33 20 66 20 100 70 C133 120 166 120 200 70 L200 130 C166 180 133 180 100 130 C66 80 33 80 0 130 Z" fill="INK"/>',
    "scallop-row":'<path d="M0 120 A33 33 0 0 1 66 120 A33 33 0 0 1 132 120 A33 33 0 0 1 198 120 L200 200 L0 200 Z" fill="INK"/>',
    "plus":       '<rect x="78" y="20" width="44" height="160" fill="INK"/><rect x="20" y="78" width="160" height="44" fill="INK"/>',
    "window":     '<rect x="22" y="22" width="156" height="156" fill="INK"/><rect x="58" y="58" width="84" height="84" fill="GROUND"/>',
    "grid-3":     '<rect x="20" y="20" width="160" height="160" fill="none" stroke="INK" stroke-width="14"/><rect x="74" y="20" width="14" height="160" fill="INK"/><rect x="112" y="20" width="14" height="160" fill="INK"/><rect x="20" y="74" width="160" height="14" fill="INK"/><rect x="20" y="112" width="160" height="14" fill="INK"/>',
    "hash":       '<rect x="62" y="10" width="16" height="180" fill="INK"/><rect x="122" y="10" width="16" height="180" fill="INK"/><rect x="10" y="62" width="180" height="16" fill="INK"/><rect x="10" y="122" width="180" height="16" fill="INK"/>',
    "nested-frames":'<rect x="14" y="14" width="172" height="172" fill="none" stroke="INK" stroke-width="14"/><rect x="58" y="58" width="84" height="84" fill="none" stroke="INK" stroke-width="14"/>',
    "diamond-frame":'<polygon points="100,12 188,100 100,188 12,100" fill="none" stroke="INK" stroke-width="16"/>',
    "ring-band":  '<path d="M0 200 A200 200 0 0 1 200 0 L140 0 A140 140 0 0 0 0 140 Z" fill="INK"/>',
}

CATEGORIES = [
    ("1 · Triangles & Chevrons", "BRAND — big triangles predominate (orange/black)", BRAND, [
        ("Angle", "*"), ("Ramp", "*"),
        ("Joint", ["02", "03", "04", "05", "06", "07"]),
    ], ["mega-tri", "tri-fan"]),

    ("2 · Bars & Colonnades", "stripes, bars, colonnades + striped pipework — tracks that bend and connect", INK, [
        ("Lines", ["02", "03", "06", "07", "10", "12"]),
        ("Lines", ["01", "04", "08", "09", "13"]),
        ("Rectangle", "*"), ("Square", "*"),
        ("Merge", ["02", "03"]), ("Composition", ["08"]), ("Joint", ["01"]),
    ], ["hatch-field", "bold-bar", "rings-conc", "half-ring"]),

    ("3 · Arcs & Sweeps", "solid curve sweeps & cascades — the big-swoop builders", INK, [
        ("Curve", "*"), ("Cascade", "*"), ("Centric", "*"),
        ("Composition", ["04", "07", "09", "10"]), ("Merge", ["01"]),
    ], ["ring-band"]),

    ("4 · Discs & Dots", "solid round fills — discs, semicircles, quarter-discs, dots", INK, [
        ("Circle", "*"),
    ], ["dot-grid", "target"]),

    ("5 · Capsules & Lenses", "elongated round & eyes — pills, ellipses, vesica, bowties", INK, [
        ("Float", "*"), ("Open", "*"),
        ("Composition", ["01", "02", "03", "12"]),
    ], ["h-pill", "lens"]),

    ("6 · Waves & Scallops", "undulating & decorative edges — teardrops, domes, scallops", INK, [
        ("Wave", "*"), ("Mirror", "*"),
        ("Composition", ["05", "06", "11"]),
    ], ["sine", "scallop-row"]),

    ("7 · Crosses, Frames & Grids", "open frameworks — windows, grids, crosses (mostly NEW)", INK, [
        ("Lines", ["11"]), ("Shape", ["01", "02"]), ("Joint", ["08"]),
    ], ["plus", "window", "grid-3", "hash", "nested-frames", "diamond-frame"]),
]

FILL_RE = re.compile(r'fill\s*=\s*"(#[0-9A-Fa-f]{3,6})"')


def recolor(svg_text: str, ink: str) -> str:
    """Map the tile's ground fill -> GROUND, every other fill -> ink. Return inner content."""
    def repl(m):
        hx = m.group(1).upper()
        if hx in ("#F3F3F3", "#FFFFFF"):
            return f'fill="{GROUND}"'
        return f'fill="{ink}"'
    svg_text = FILL_RE.sub(repl, svg_text)
    # inner content between opening <svg ...> and </svg>
    start = svg_text.find(">", svg_text.find("<svg")) + 1
    end = svg_text.rfind("</svg>")
    return svg_text[start:end].strip()


def new_inner(svg_inner: str, ink: str) -> str:
    return svg_inner.replace("INK", ink).replace("GROUND", GROUND)


def members(spec, ink):
    """Yield (label, inner) for a category's existing tiles."""
    for family, ids in spec:
        fam_dir = TILES / family
        if ids == "*":
            files = sorted(fam_dir.glob("*.svg"))
        else:
            files = [fam_dir / f"{i}.svg" for i in ids]
        for f in files:
            if not f.exists():
                continue
            inner = recolor(f.read_text(), ink)
            yield (f"{family[:3].lower()}-{f.stem}", inner, False)


def build():
    W = 2040
    M = 40
    TILE = 138
    GAPX = 14
    GAPY = 30
    HEADER_H = 78
    cols = (W - 2 * M + GAPX) // (TILE + GAPX)

    body = []
    y = M + 44  # clear the sheet title
    for name, subtitle, ink, spec, news in CATEGORIES:
        # header
        body.append(
            f'<text x="{M}" y="{y+30}" fill="{BRAND if ink==BRAND else INK}" '
            f'font-family="Helvetica,Arial,sans-serif" font-size="30" font-weight="800">{html.escape(name)}</text>'
            f'<text x="{M}" y="{y+56}" fill="{LABEL}" font-family="Helvetica,Arial,sans-serif" '
            f'font-size="15">{html.escape(subtitle)}</text>'
        )
        y += HEADER_H
        items = list(members(spec, ink)) + [
            (k, new_inner(NEW[k], ink), True) for k in news
        ]
        col = 0
        x = M
        row_y = y
        for label, inner, is_new in items:
            if col == cols:
                col = 0
                x = M
                row_y += TILE + GAPY
            s = TILE / 200.0
            body.append(
                f'<rect x="{x}" y="{row_y}" width="{TILE}" height="{TILE}" fill="{GROUND}" '
                f'stroke="{BRAND if is_new else CARD_BORDER}" stroke-width="{2 if is_new else 1}"/>'
                f'<g transform="translate({x},{row_y}) scale({s})">{inner}</g>'
                f'<text x="{x}" y="{row_y+TILE+15}" fill="{BRAND if is_new else LABEL}" '
                f'font-family="Helvetica,Arial,sans-serif" font-size="12">'
                f'{label}{" ★NEW" if is_new else ""}</text>'
            )
            x += TILE + GAPX
            col += 1
        y = row_y + TILE + GAPY + 24

    H = y + M
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}">'
        f'<rect width="{W}" height="{H}" fill="{SHEET_BG}"/>'
        f'<text x="{M}" y="{M+4}" fill="{INK}" font-family="Helvetica,Arial,sans-serif" '
        f'font-size="22" font-weight="800">FAI PATTERN STUDIO — PROPOSED 7 FAMILIES</text>'
        + "".join(body) + "</svg>"
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "grouping.svg").write_text(svg)
    print(f"wrote {OUT/'grouping.svg'} ({W}x{H})")
    try:
        import cairosvg
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(OUT / "grouping.png"),
                         output_width=W, output_height=H)
        print(f"wrote {OUT/'grouping.png'}")
    except Exception as e:  # pragma: no cover
        print(f"PNG skipped: {e}")


if __name__ == "__main__":
    build()
