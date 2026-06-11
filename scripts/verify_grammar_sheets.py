#!/usr/bin/env python3
"""Generate grammar QA sheets beside canonical references and assert structure."""
from __future__ import annotations

import io
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fai_banner as fb  # noqa: E402


BASE = Path(__file__).resolve().parent.parent
REF_DIR = BASE / "output" / "banners-clean"
OUT_DIR = BASE / "output" / "grammar-verify"
TEMPLATES = ["mirror_monument", "frieze_stack", "ring_field", "field_split", "eye_row"]


def svg_to_image(svg_text: str, size=(480, 240)) -> Image.Image:
    import cairosvg

    png = cairosvg.svg2png(bytestring=svg_text.encode("utf-8"), output_width=size[0], output_height=size[1])
    return Image.open(io.BytesIO(png)).convert("RGB")


def ref_image(path: Path, size=(480, 240)) -> Image.Image:
    return svg_to_image(path.read_text(), size)


def make_sheet(color_mode: str, seed: int) -> list[dict]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tiles, _ = fb.load_tiles(fb.DEFAULT_MANIFEST)
    generated = []
    for i, tmpl in enumerate(TEMPLATES):
        banner = fb.generate_banner(tiles, color_mode=color_mode, template=tmpl, seed=seed + i, n_candidates=180)
        stats = fb.grammar_stats(banner)
        assert fb.grammar_passes(banner), (color_mode, tmpl, stats)
        svg = fb.render_svg(banner, fb.DEFAULT_TILES_DIR, (960, 480))
        stem = OUT_DIR / f"{color_mode}-{i+1:02d}-{tmpl}"
        stem.with_suffix(".svg").write_text(svg)
        fb.write_png(svg, stem.with_suffix(".png"), (960, 480))
        generated.append({"template": tmpl, "stats": stats, "svg": svg})

    refs = sorted(REF_DIR.glob("*.svg"))[: len(TEMPLATES)]
    thumb = (360, 180)
    pad, gap, label_h = 32, 18, 42
    cols = len(TEMPLATES)
    width = pad * 2 + cols * thumb[0] + (cols - 1) * gap
    height = pad * 2 + 2 * thumb[1] + 2 * label_h + 58
    sheet = Image.new("RGB", (width, height), "#121212")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    draw.text((pad, 14), f"FAI references vs grammar - {color_mode}", fill="#F3F3F3", font=font)
    draw.text((pad, 34), "top: canonical references / bottom: regenerated grammar", fill="#D9D9D6", font=font)

    y_ref = pad + 42
    y_gen = y_ref + thumb[1] + label_h
    for i in range(cols):
        x = pad + i * (thumb[0] + gap)
        if i < len(refs):
            sheet.paste(ref_image(refs[i], thumb), (x, y_ref))
            draw.text((x, y_ref + thumb[1] + 8), refs[i].stem, fill="#D9D9D6", font=font)
        gen = generated[i]
        sheet.paste(svg_to_image(gen["svg"], thumb), (x, y_gen))
        s = gen["stats"]
        draw.text((x, y_gen + thumb[1] + 8), gen["template"], fill="#F3F3F3", font=font)
        draw.text(
            (x, y_gen + thumb[1] + 23),
            f"cov {s['coverage_fraction']:.3f} cells {s['inked_cell_fraction']:.3f} white {s['white_fraction']:.3f} accent-run {s['max_accent_run']}",
            fill="#D9D9D6",
            font=font,
        )

    out = OUT_DIR / f"{color_mode}-references-vs-grammar.png"
    sheet.save(out)
    print(out)
    for gen in generated:
        print(f"{color_mode} {gen['template']} {gen['stats']}")
    return [g["stats"] for g in generated]


def main() -> int:
    make_sheet("full", 20260610)
    make_sheet("duotone", 20260710)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
