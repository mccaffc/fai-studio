#!/usr/bin/env python3
"""
fai_contact.py — one tool for every contact / montage sheet.

Replaces the five overlapping scripts that used to live here:
    contact_all.py, contact_pick.py, family_montage.py,
    sets_montage.py, generate_contact_sheet.py

Two subcommands:

  tiles    A static SVG (+ optional PNG) contact sheet of the tile library.
           Group by family, label each tile with its id + dominant_direction,
           optionally recolour the foreground, and optionally restrict to a
           family list. Covers the old contact_all / contact_pick /
           family_montage / sets_montage use cases.

           # whole library, labelled, on Cod Gray
           fai_contact.py tiles --out output/contact-tiles
           # one representative (boldest) per family
           fai_contact.py tiles --per-family 1 --out output/contact-families
           # a chosen family slice, recoloured orange
           fai_contact.py tiles --families Circle,Wave,Curve --recolor "#FF4F00"

  banners  A contact sheet of generated banners with per-banner total + sub
           scores beneath each thumbnail (the supplement's annotated contact
           sheet). Generates a fresh batch or reads an existing folder of SVGs.

           # generate + sheet in one go
           fai_contact.py banners --color-mode full --count 12 \
               --out output/contact-banners
           # sheet an existing folder
           fai_contact.py banners --input output/banners-rebuilt \
               --out output/contact-banners

Always launch with the cairo dylibs when using --png:
    DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib \
      $HOME/.cache/fai-deck-venv/bin/python scripts/fai_contact.py ...
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fai_banner as fb  # noqa: E402
from fai_tile_render import render_tile_group, tile_native_bg  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
TILES_DIR = BASE / "output" / "shapes-clean"
MANIFEST = BASE / "tiles-manifest-v2.json"

COD = "#121212"
BONE = "#EDE6D6"
GRAY = "#8A8A8A"
ORANGE = "#FF4F00"
FONT = "Helvetica,Arial,sans-serif"


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def tile_inner(path: Path, recolor: str | None, frame_bg: str) -> str:
    """Return the tile's full recoloured foreground markup.

    Uses the same robust extractor as the banner renderer, so multi-element,
    circle/ellipse, figure-on-ground, and CSS-class tiles all draw correctly.
    Ink takes `recolor` (or the tile's native ink, here forced light so tiles
    read on the dark contact frame); negative-space cut-outs take the frame bg.
    """
    ink = recolor or "#EDE6D6"
    try:
        return render_tile_group(path, ink, frame_bg)
    except Exception:
        return ""


def maybe_png(svg_text: str, out_stem: Path, width: int) -> None:
    import cairosvg

    cairosvg.svg2png(bytestring=svg_text.encode(), write_to=str(out_stem.with_suffix(".png")), output_width=width)


# ---------------------------------------------------------------------------
# tiles subcommand
# ---------------------------------------------------------------------------
def cmd_tiles(args) -> int:
    manifest = json.loads(MANIFEST.read_text())
    by_family: dict[str, list[dict]] = {}
    for t in manifest["tiles"]:
        if t.get("renderable") is False:
            continue
        by_family.setdefault(t["shape_family"], []).append(t)

    families = sorted(by_family)
    if args.families:
        wanted = [f.strip() for f in args.families.split(",")]
        families = [f for f in families if f.lower() in {w.lower() for w in wanted}]
        # normalise capitalisation to the on-disk family names
        lut = {f.lower(): f for f in by_family}
        families = [lut[w.lower()] for w in wanted if w.lower() in lut]

    # ordering within a family: boldest first (raster_fill desc)
    def fill_of(t):
        return t.get("raster_fill", t.get("visual_weight", 0))

    cols = args.cols
    cell = 128
    gap = 12
    pad = 48
    label_h = 30
    header = 92

    rows_svg = []
    y = header
    for fam in families:
        tiles = sorted(by_family[fam], key=fill_of, reverse=True)
        if args.per_family:
            tiles = tiles[: args.per_family]
        rows_svg.append(
            f'<text x="{pad}" y="{y}" font-family="{FONT}" font-size="18" '
            f'font-weight="bold" fill="{ORANGE}">{esc(fam)} · {len(tiles)}</text>'
        )
        y += 16
        for i, t in enumerate(tiles):
            col = i % cols
            if col == 0 and i > 0:
                y += cell + label_h
            tx = pad + col * (cell + gap)
            ty = y
            sc = cell / 200.0
            frame_bg = "#1C1C1C"
            inner = tile_inner(TILES_DIR / t["filename"], args.recolor, frame_bg)
            # subtle tile frame so light tiles are visible on Cod Gray
            rows_svg.append(f'<rect x="{tx}" y="{ty}" width="{cell}" height="{cell}" fill="{frame_bg}"/>')
            rows_svg.append(f'<g transform="translate({tx},{ty}) scale({sc:.4f})">{inner}</g>')
            label = t["id"]
            direction = t.get("dominant_direction", "")
            rows_svg.append(
                f'<text x="{tx}" y="{ty+cell+13}" font-family="{FONT}" font-size="10" '
                f'fill="{BONE}">{esc(label)}</text>'
            )
            rows_svg.append(
                f'<text x="{tx}" y="{ty+cell+25}" font-family="{FONT}" font-size="9" '
                f'fill="{GRAY}">{esc(direction)}</text>'
            )
        y += cell + label_h + 18

    width = pad * 2 + cols * cell + (cols - 1) * gap
    height = y + pad
    head = (
        f'<rect width="{width}" height="{height}" fill="{COD}"/>'
        f'<text x="{pad}" y="46" font-family="{FONT}" font-size="30" font-weight="bold" '
        f'fill="{BONE}" letter-spacing="1">FAI TILE LIBRARY</text>'
        f'<text x="{pad}" y="70" font-family="{FONT}" font-size="13" fill="{GRAY}">'
        f'{sum(len(by_family[f]) for f in families)} tiles · {len(families)} families · '
        f'label = id / dominant_direction</text>'
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n{head}\n' + "\n".join(rows_svg) + "\n</svg>\n"
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".svg").write_text(svg)
    print(f"wrote {out.with_suffix('.svg')} ({width}x{height})")
    if args.png:
        maybe_png(svg, out, min(width, 2400))
        print(f"wrote {out.with_suffix('.png')}")
    return 0


# ---------------------------------------------------------------------------
# banners subcommand
# ---------------------------------------------------------------------------
def cmd_banners(args) -> int:
    tiles, _ = fb.load_tiles(MANIFEST)

    entries: list[tuple[str, dict, str]] = []  # (svg_text, scores, label)
    if args.input:
        folder = Path(args.input)
        for sp in sorted(folder.glob("*.svg")):
            entries.append((sp.read_text(), {}, sp.stem))
    else:
        banners = fb.generate_many(
            tiles,
            color_mode=args.color_mode,
            vertical_hex=args.vertical_hex,
            template=None,
            seed=args.seed,
            n_candidates=args.candidates,
            keep=args.count,
            extra_hexes=args.extra_hex,
        )
        for b in banners:
            svg = fb.render_svg(b, TILES_DIR, (640, 320))
            entries.append((svg, b.scores, f"{b.template} s={b.scores.get('base_seed')}"))

    cols = args.cols
    thumb_w, thumb_h = 360, 180
    gap = 22
    meta_h = 70
    pad = 40
    header = 80

    items = []
    x = y = 0
    width = pad * 2 + cols * thumb_w + (cols - 1) * gap
    n = len(entries)
    rows = (n + cols - 1) // cols
    height = header + pad + rows * (thumb_h + meta_h + gap)

    for idx, (svg_text, scores, label) in enumerate(entries):
        col = idx % cols
        row = idx // cols
        x = pad + col * (thumb_w + gap)
        y = header + row * (thumb_h + meta_h + gap)
        # embed the banner svg inner content scaled into the thumbnail
        inner = re.search(r"<svg[^>]*>(.*)</svg>", svg_text, re.S)
        body = inner.group(1) if inner else ""
        vb = re.search(r'viewBox="0 0 (\d+) (\d+)"', svg_text)
        bw, bh = (int(vb.group(1)), int(vb.group(2))) if vb else (640, 320)
        sc = thumb_w / bw
        items.append(f'<g transform="translate({x},{y}) scale({sc:.4f})">{body}</g>')
        items.append(f'<rect x="{x}" y="{y}" width="{thumb_w}" height="{bh*sc:.1f}" fill="none" stroke="#333" stroke-width="1"/>')
        ty = y + thumb_h + 18
        items.append(f'<text x="{x}" y="{ty}" font-family="{FONT}" font-size="12" fill="{BONE}">{esc(label)}</text>')
        if scores:
            line1 = (
                f"total {scores['total']:.3f}   "
                f"anc {scores['anchor']:.2f}  rhy {scores['rhythm']:.2f}  "
                f"dir {scores['direction']:.2f}  wei {scores['weight']:.2f}"
            )
            line2 = (
                f"neg {scores['negative']:.2f}  tem {scores['temperature']:.2f}  "
                f"fam {scores['family']:.2f}  her {scores['hero']:.2f}  tmp {scores.get('template', 0):.2f}"
            )
            items.append(f'<text x="{x}" y="{ty+18}" font-family="{FONT}" font-size="11" fill="{GRAY}">{esc(line1)}</text>')
            items.append(f'<text x="{x}" y="{ty+33}" font-family="{FONT}" font-size="11" fill="{GRAY}">{esc(line2)}</text>')

    head = (
        f'<rect width="{width}" height="{height}" fill="{COD}"/>'
        f'<text x="{pad}" y="46" font-family="{FONT}" font-size="28" font-weight="bold" fill="{BONE}">'
        f'FAI BANNER CONTACT SHEET</text>'
        f'<text x="{pad}" y="66" font-family="{FONT}" font-size="12" fill="{GRAY}">'
        f'{n} banners · scores per supplement axes</text>'
    )
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}">\n{head}\n' + "\n".join(items) + "\n</svg>\n"
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".svg").write_text(svg)
    print(f"wrote {out.with_suffix('.svg')} ({width}x{height})")
    if args.png:
        maybe_png(svg, out, min(width, 2400))
        print(f"wrote {out.with_suffix('.png')}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="FAI contact / montage sheets")
    sub = ap.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tiles", help="tile-library contact sheet")
    t.add_argument("--families", default=None, help="comma list to restrict (e.g. Circle,Wave)")
    t.add_argument("--per-family", type=int, default=None, help="show only N boldest per family")
    t.add_argument("--recolor", default=None, help="recolour foreground to this hex")
    t.add_argument("--cols", type=int, default=11)
    t.add_argument("--out", default=str(BASE / "output" / "contact-tiles"))
    t.add_argument("--png", action="store_true")
    t.set_defaults(func=cmd_tiles)

    b = sub.add_parser("banners", help="banner contact sheet with scores")
    b.add_argument("--input", default=None, help="folder of existing banner SVGs (else generate)")
    b.add_argument("--color-mode", choices=["full", "duotone", "vertical", "extended"], default="full")
    b.add_argument("--vertical-hex", default=None)
    b.add_argument("--extra-hex", action="append", default=[])
    b.add_argument("--allow-unratified-hex", action="store_true")
    b.add_argument("--count", type=int, default=12)
    b.add_argument("--candidates", type=int, default=160)
    b.add_argument("--seed", type=int, default=None)
    b.add_argument("--cols", type=int, default=3)
    b.add_argument("--out", default=str(BASE / "output" / "contact-banners"))
    b.add_argument("--png", action="store_true")
    b.set_defaults(func=cmd_banners)

    args = ap.parse_args(argv)
    if getattr(args, "cmd", None) == "banners" and args.color_mode == "extended" and args.extra_hex and not args.allow_unratified_hex:
        print("error: --extra-hex requires --allow-unratified-hex", file=sys.stderr)
        return 2
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
