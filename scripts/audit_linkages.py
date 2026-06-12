#!/usr/bin/env python3
"""
audit_linkages.py — per-family linkage demos for the FAI Pattern Studio rebuild.

For each of the 7 proposed families: hand-built multi-tile assemblies showing how
tiles LINK into larger forms (pipes connect, quarter-discs complete circles,
pills stack into columns...), followed by a 6x3 demo banner showing how the
family "cashes out" at banner scale.

  DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib \
    $HOME/.cache/fai-deck-venv/bin/python scripts/audit_linkages.py
  -> output/audit/linkages.svg / .png
"""
from __future__ import annotations
import html
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
TILES = BASE / "output" / "shapes-clean"
OUT = BASE / "output" / "audit"

GROUND = "#121212"
WHITE = "#F3F3F3"
ORANGE = "#FF4F00"
YELLOW = "#FFA300"
BLUE = "#4997D0"
WOLF = "#D9D9D6"
SHEET_BG = "#1d1d1f"
LABEL = "#9a9a9a"

FILL_RE = re.compile(r'fill\s*=\s*"(#[0-9A-Fa-f]{3,6})"')
_CACHE: dict[str, str] = {}

# Procedural extras used by family 7 (and a couple of demo banners).
# Drawn in 0..200, INK placeholder, designed to CONNECT when tiled
# (bars are full-bleed so repetition = continuous lattice).
NEW = {
    "hash-connect": (
        '<rect x="36" y="0" width="24" height="200" fill="INK"/>'
        '<rect x="140" y="0" width="24" height="200" fill="INK"/>'
        '<rect x="0" y="36" width="200" height="24" fill="INK"/>'
        '<rect x="0" y="140" width="200" height="24" fill="INK"/>'
    ),
    "plus": '<rect x="78" y="20" width="44" height="160" fill="INK"/><rect x="20" y="78" width="160" height="44" fill="INK"/>',
    "window": '<rect x="22" y="22" width="156" height="156" fill="INK"/><rect x="58" y="58" width="84" height="84" fill="GROUND"/>',
    "diamond-frame": '<polygon points="100,12 188,100 100,188 12,100" fill="none" stroke="INK" stroke-width="16"/>',
    "nested-frames": '<rect x="14" y="14" width="172" height="172" fill="none" stroke="INK" stroke-width="14"/><rect x="58" y="58" width="84" height="84" fill="none" stroke="INK" stroke-width="14"/>',
    "target": '<circle cx="100" cy="100" r="92" fill="INK"/><circle cx="100" cy="100" r="62" fill="GROUND"/><circle cx="100" cy="100" r="34" fill="INK"/>',
    "dot": '<circle cx="100" cy="100" r="26" fill="INK"/>',
}


def tile_inner(fam: str, tid: str) -> str:
    """Inner SVG of a legacy tile with fills tokenized to INK/GROUND."""
    key = f"{fam}/{tid}"
    if key not in _CACHE:
        text = (TILES / fam / f"{tid}.svg").read_text()

        def repl(m):
            hx = m.group(1).upper()
            return 'fill="GROUND"' if hx in ("#F3F3F3", "#FFFFFF") else 'fill="INK"'

        text = FILL_RE.sub(repl, text)
        start = text.find(">", text.find("<svg")) + 1
        _CACHE[key] = text[start: text.rfind("</svg>")].strip()
    return _CACHE[key]


def cell_svg(spec, x: float, y: float, s: float) -> str:
    """spec: None | (src, rot, flipx, ink). src: 'Fam/id' or 'new:key'."""
    out = [f'<rect x="{x}" y="{y}" width="{200*s}" height="{200*s}" fill="{GROUND}"/>']
    if spec is None:
        return out[0]
    src, rot, flipx, ink = spec
    if src.startswith("new:"):
        inner = NEW[src[4:]]
    else:
        fam, tid = src.split("/")
        inner = tile_inner(fam, tid)
    inner = inner.replace("INK", ink).replace("GROUND", GROUND)
    t = f"translate({x},{y}) scale({s})"
    if rot:
        t += f" rotate({rot},100,100)"
    if flipx:
        t += " translate(200,0) scale(-1,1)"
    out.append(f'<g transform="{t}">{inner}</g>')
    return "".join(out)


def grid_svg(rows, x: float, y: float, cell: float) -> str:
    parts = []
    for r, row in enumerate(rows):
        for c, spec in enumerate(row):
            parts.append(cell_svg(spec, x + c * cell, y + r * cell, cell / 200.0))
    return "".join(parts)


def W_(src, rot=0, flipx=False):  # white ink
    return (src, rot, flipx, WHITE)


def O_(src, rot=0, flipx=False):  # orange
    return (src, rot, flipx, ORANGE)


def Y_(src, rot=0, flipx=False):  # yellow
    return (src, rot, flipx, YELLOW)


def B_(src, rot=0, flipx=False):  # blue
    return (src, rot, flipx, BLUE)


def G_(src, rot=0, flipx=False):  # timberwolf gray
    return (src, rot, flipx, WOLF)


# ════════════════════════════════════════════════════════════════════
# FAMILY SECTIONS: (title, [(assembly_label, rows)...], (banner_label, rows))
# rows = list of rows of cell specs (None = empty ground cell)
# ════════════════════════════════════════════════════════════════════

F1 = ("1 · Triangles & Chevrons", [
    ("valley across 2 cells", [[O_("Ramp/04"), O_("Ramp/04", flipx=True)]]),
    ("peak (flipped pair)", [[O_("Ramp/04", 180, True), O_("Ramp/04", 180)]]),
    ("chevron frieze", [[O_("Angle/05"), O_("Angle/05"), O_("Angle/05"), O_("Angle/05")]]),
    ("pinwheel 2×2", [[O_("Angle/03"), O_("Angle/03", 90)],
                      [O_("Angle/03", 270), O_("Angle/03", 180)]]),
    ("long slope", [[O_("Ramp/02"), O_("Ramp/01")]]),
], ("demo banner — big angular field, orange leads", [
    [O_("Ramp/04"), O_("Ramp/04", flipx=True), None, W_("Angle/05"), W_("Angle/05"), None],
    [O_("Angle/03"), O_("Angle/03", 90), O_("Ramp/07"), None, O_("Angle/10"), W_("Ramp/05")],
    [O_("Angle/03", 270), O_("Angle/03", 180), None, W_("Ramp/03"), O_("Ramp/04", 180, True), O_("Ramp/04", 180)],
]))

F2 = ("2 · Bars & Colonnades (stripes + pipework)", [
    ("L-pipe: bars → bend → bars", [
        [W_("Lines/03"), None],
        [W_("Lines/04"), W_("Lines/03", 90, True)],
    ]),
    ("striped target 2×2", [
        [W_("Lines/13"), W_("Lines/13", 90)],
        [W_("Lines/13", 270), W_("Lines/13", 180)],
    ]),
    ("colonnade row", [[W_("Merge/02"), W_("Merge/02"), W_("Merge/02")]]),
    ("S-bend pipe", [
        [W_("Lines/13")],
        [W_("Lines/04", 0, True)],
    ]),
], ("demo banner — pipe maze à la 049", [
    [W_("Lines/03"), W_("Lines/13", 90), None, O_("Lines/13"), O_("Lines/13", 90), B_("new:dot")],
    [W_("Lines/04"), W_("Lines/03", 90, True), W_("Lines/13", 90, False), O_("Lines/13", 270), O_("Lines/13", 180), None],
    [None, W_("Merge/02"), W_("Lines/03"), Y_("Lines/03"), None, W_("Lines/13", 270)],
]))

F3 = ("3 · Arcs & Sweeps", [
    ("giant ground-circle 2×2", [
        [W_("Curve/04"), W_("Curve/04", 90)],
        [W_("Curve/04", 270), W_("Curve/04", 180)],
    ]),
    ("cascade skyline", [[W_("Cascade/04"), W_("Cascade/03"), W_("Cascade/02"), W_("Cascade/01")]]),
    ("mirrored sweep pair", [[W_("Curve/09"), W_("Curve/09", 0, True)]]),
    ("corner blooms", [[W_("Centric/04"), W_("Centric/04", 90)]]),
], ("demo banner — big sweeps, 024 scale", [
    [O_("Curve/04"), O_("Curve/04", 90), W_("Cascade/04"), W_("Cascade/03"), B_("Centric/03"), None],
    [O_("Curve/04", 270), O_("Curve/04", 180), None, W_("Curve/09"), W_("Curve/10"), B_("Centric/02", 90)],
    [None, W_("Curve/03"), W_("Curve/03", 90), None, O_("Cascade/06"), O_("Cascade/05")],
]))

F4 = ("4 · Discs & Dots", [
    ("full circle from 2 semis", [
        [W_("Circle/09", 180)],
        [W_("Circle/09")],
    ]),
    ("center disc 2×2", [
        [W_("Circle/14", 270), W_("Circle/14")],
        [W_("Circle/14", 180), W_("Circle/14", 90)],
    ]),
    ("dome + dot rhythm", [[W_("Circle/09"), B_("Circle/05"), W_("Circle/09"), Y_("Circle/05")]]),
], ("demo banner — owl scale, discs lead", [
    [O_("Circle/14", 270), O_("Circle/14"), W_("Circle/14", 270), W_("Circle/14"), None, B_("Circle/05")],
    [O_("Circle/14", 180), O_("Circle/14", 90), W_("Circle/14", 180), W_("Circle/14", 90), Y_("Circle/12"), None],
    [None, W_("Circle/09"), W_("Circle/09"), None, W_("Circle/10"), W_("Circle/10")],
]))

F5 = ("5 · Capsules & Lenses", [
    ("pill column (caps kiss)", [
        [W_("Float/06")],
        [W_("Float/06")],
    ]),
    ("owl eyes (mirrored pair)", [[W_("Open/04"), W_("Open/04", 0, True)]]),
    ("bowtie stack", [
        [W_("Composition/01")],
        [W_("Composition/02")],
    ]),
    ("pill row", [[O_("Float/06"), W_("Float/03"), B_("Float/02"), Y_("Float/06")]]),
], ("demo banner — pill towers à la 006", [
    [O_("Float/06"), None, W_("Float/06"), B_("new:dot"), Y_("Float/06"), None],
    [O_("Float/06"), W_("Open/04"), W_("Open/04", 0, True), None, Y_("Float/06"), B_("Float/05")],
    [O_("Float/06"), None, W_("Float/01"), O_("new:dot"), Y_("Float/06"), None],
]))

F6 = ("6 · Waves & Scallops", [
    ("wave band (mirrored pair)", [[W_("Wave/07"), W_("Wave/07", 0, True)]]),
    ("scallop fence", [[W_("Composition/06"), W_("Composition/06"), W_("Composition/06")]]),
    ("mirror brackets", [[W_("Mirror/04"), W_("Mirror/04", 0, True)]]),
    ("teardrop pair", [[W_("Wave/05"), W_("Wave/05", 0, True)]]),
], ("demo banner — organic field à la 008", [
    [G_("Wave/06"), G_("Wave/06", 0, True), None, O_("Wave/02"), O_("Wave/02", 0, True), None],
    [W_("Wave/05"), W_("Wave/05", 0, True), O_("Mirror/04"), O_("Mirror/04", 0, True), W_("Wave/01"), G_("Wave/04")],
    [W_("Composition/06"), W_("Composition/06"), W_("Composition/06"), W_("Composition/06"), W_("Composition/06"), W_("Composition/06")],
]))

F7 = ("7 · Crosses, Frames & Grids", [
    ("continuous lattice 2×2", [
        [W_("new:hash-connect"), W_("new:hash-connect")],
        [W_("new:hash-connect"), W_("new:hash-connect")],
    ]),
    ("window wall", [[W_("new:window"), W_("new:window"), W_("new:window")]]),
    ("checker + plus", [[W_("Joint/08"), O_("new:plus"), W_("Joint/08")]]),
    ("globe linework", [[W_("Shape/01"), W_("Shape/02")]]),
], ("demo banner — open framework field", [
    [W_("new:hash-connect"), W_("new:hash-connect"), None, O_("new:plus"), W_("new:window"), None],
    [W_("new:hash-connect"), W_("new:hash-connect"), B_("new:target"), None, W_("new:diamond-frame"), W_("Shape/01")],
    [None, Y_("new:plus"), None, W_("new:nested-frames"), W_("Joint/08"), None],
]))


def build():
    FAMILIES = [F1, F2, F3, F4, F5, F6, F7]
    W = 1660
    M = 36
    ACELL = 92          # assembly cell px
    BCELL = 130         # demo banner cell px
    body = []
    y = M + 30

    for title, assemblies, (blabel, brows) in FAMILIES:
        body.append(
            f'<text x="{M}" y="{y}" fill="{WHITE}" font-family="Helvetica,Arial,sans-serif" '
            f'font-size="26" font-weight="800">{html.escape(title)}</text>'
        )
        y += 18
        # assemblies laid out horizontally, wrapping if needed
        x = M
        row_h = 0
        for label, rows in assemblies:
            aw = len(rows[0]) * ACELL
            ah = len(rows) * ACELL
            if x + aw > W - M:
                x = M
                y += row_h + 44
                row_h = 0
            body.append(grid_svg(rows, x, y, ACELL))
            body.append(
                f'<rect x="{x}" y="{y}" width="{aw}" height="{ah}" fill="none" stroke="#3a3a3a"/>'
                f'<text x="{x}" y="{y+ah+18}" fill="{LABEL}" font-family="Helvetica,Arial,sans-serif" '
                f'font-size="13">{html.escape(label)}</text>'
            )
            x += aw + 36
            row_h = max(row_h, ah)
        y += row_h + 50
        # demo banner
        bw = len(brows[0]) * BCELL
        bh = len(brows) * BCELL
        body.append(grid_svg(brows, M, y, BCELL))
        body.append(
            f'<rect x="{M}" y="{y}" width="{bw}" height="{bh}" fill="none" stroke="#4a4a4a" stroke-width="1.5"/>'
            f'<text x="{M}" y="{y+bh+20}" fill="{ORANGE}" font-family="Helvetica,Arial,sans-serif" '
            f'font-size="14" font-weight="600">{html.escape(blabel)}</text>'
        )
        y += bh + 64

    H = y + M
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
        f'<rect width="{W}" height="{H}" fill="{SHEET_BG}"/>'
        f'<text x="{M}" y="{M}" fill="{WHITE}" font-family="Helvetica,Arial,sans-serif" '
        f'font-size="20" font-weight="800">FAI PATTERN STUDIO — LINKAGES: HOW EACH FAMILY FUSES INTO LARGER FORMS</text>'
        + "".join(body) + "</svg>"
    )
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "linkages.svg").write_text(svg)
    print(f"wrote {OUT/'linkages.svg'} ({W}x{H})")
    try:
        import cairosvg
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(OUT / "linkages.png"),
                         output_width=W, output_height=H)
        print(f"wrote {OUT/'linkages.png'}")
    except Exception as e:
        print(f"PNG skipped: {e}")


if __name__ == "__main__":
    build()
