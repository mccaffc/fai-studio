#!/usr/bin/env python3
"""
fai_sanitize_tiles.py — one-time (idempotent) tile-library hygiene pass.

Two problems in output/shapes-clean/<Family>/NN.svg, both inherited from the
Figma/Illustrator export pipeline:

  1. Scientific-notation float noise. Boolean-op'd paths (Cascade, Centric,
     Angle, Circle, ...) carry coordinates like `8.74228e-06` and
     `3.49691e-05` — all < 1e-3, i.e. values that are really 0 but were left as
     floating-point dust. cairosvg tolerates them, but InDesign and stricter
     SVG parsers can choke. We round them to clean integers/short decimals.
     Geometry is unchanged (verified identical rendered fill fraction to 4 dp).

  2. Adobe-Illustrator CSS-class fills. The 11 Composition/*.svg files put
     their colours in a <defs><style> .st0/.st1 block instead of inline
     `fill="..."`. We inline those fills and drop the dead <defs>, so every
     tile is a flat list of inline-filled foreground elements — the form the
     generator and any downstream tool expects.

Idempotent: running twice is a no-op on already-clean files.

Run (cairo dylibs not required — this is pure text):
    $HOME/.cache/fai-deck-venv/bin/python scripts/fai_sanitize_tiles.py
    # add --dry-run to report without writing
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_tile_render import _resolve_css_classes, sanitize_svg_text  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
TILES_DIR = BASE / "output" / "shapes-clean"


def clean_text(text: str) -> str:
    text = _resolve_css_classes(text)
    text = sanitize_svg_text(text)
    return text


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    files = sorted(TILES_DIR.glob("*/*.svg"))
    changed = []
    for f in files:
        orig = f.read_text()
        new = clean_text(orig)
        if new != orig:
            changed.append(f)
            if not args.dry_run:
                f.write_text(new)

    verb = "would change" if args.dry_run else "cleaned"
    print(f"{len(changed)}/{len(files)} files {verb}")
    for f in changed:
        print(f"  {f.relative_to(BASE)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
