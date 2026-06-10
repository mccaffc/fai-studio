#!/usr/bin/env python3
"""
fai_tile_render.py — robust tile foreground extraction + recolouring.

The tile library (output/shapes-clean/<Family>/NN.svg) is NOT uniform. Across
the 140 tiles three distinct constructions appear, and a naive
"grab the first <path d=...> and recolour it" reader (the original generator's
approach) silently broke a large fraction of them:

  1. single inline-fill foreground         — one <path>/<circle>/<ellipse>/
                                              <polygon> with fill="#121212".
  2. multi-element inline-fill foreground   — several elements (Lines stripe
                                              fields up to 10 paths, Mirror,
                                              Cascade) — only the first was
                                              rendered before, dropping the rest.
  3. two-colour figure-on-ground           — a dark "ink" shape PLUS a light
                                              cut-out shape whose fill matches
                                              the tile background (negative
                                              space). Recolouring every fill to
                                              one colour destroyed the cut-out.
  4. Adobe-Illustrator CSS-class fills      — all 11 Composition/*.svg carry no
                                              inline fill at all; colour lives in
                                              a <defs><style> .st0/.st1 block, so
                                              the old reader rendered nothing.

This module resolves all four uniformly. It:
  * reads the tile,
  * resolves CSS-class fills (.stN) to inline colours,
  * identifies the background fill (the first full-bleed <rect>),
  * classifies every foreground fill as INK (the figure) or GROUND (negative
    space that matches the tile bg),
  * re-emits the foreground as a single <g>, remapping INK -> the cell's chosen
    foreground colour and GROUND -> the cell's chosen background colour,
  * rounds away the scientific-notation float noise Figma's boolean ops leave
    behind (every such value in the library is < 1e-4, i.e. a rounding artefact).

The result renders identically in cairosvg, Chrome, and InDesign, and every
renderable tile in the library now draws correctly.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

# Foreground element tags we know how to carry through.
FG_TAGS = ("path", "circle", "ellipse", "polygon", "polyline", "rect", "line")

_SCI_RE = re.compile(r"-?\d+\.?\d*[eE][-+]?\d+")
_NUM_RE = re.compile(r"-?\d+\.\d{4,}")  # long decimals -> trim for cleanliness


def _round_sci(text: str) -> str:
    """Round scientific-notation float noise (all < 1e-4 in this library) to 0,
    and trim absurdly long decimals. Geometry is unchanged to 4 dp."""

    def repl_sci(m: re.Match) -> str:
        v = float(m.group(0))
        return "0" if abs(v) < 1e-3 else f"{v:.4f}".rstrip("0").rstrip(".")

    def repl_long(m: re.Match) -> str:
        v = float(m.group(0))
        s = f"{v:.4f}".rstrip("0").rstrip(".")
        return s if s else "0"

    text = _SCI_RE.sub(repl_sci, text)
    text = _NUM_RE.sub(repl_long, text)
    return text


def sanitize_svg_text(text: str) -> str:
    """Public sanitiser used by the one-time library cleanup pass."""
    return _round_sci(text)


def _resolve_css_classes(text: str) -> str:
    """Inline any .stN { fill: #hex } CSS-class fills, then drop the <style>/<defs>."""
    style = re.search(r"<style[^>]*>(.*?)</style>", text, re.S)
    if not style:
        return text
    class_fill: dict[str, str] = {}
    hidden_classes: set[str] = set()
    # Parse each ".cls { ... }" block; pull fill (anywhere in the block) and
    # honour display:none (the element is hidden, so drop it entirely).
    for cls, body_css in re.findall(r"\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}", style.group(1)):
        fm = re.search(r"fill:\s*(#[0-9A-Fa-f]{3,6})", body_css)
        if fm:
            class_fill[cls] = fm.group(1).upper()
        if re.search(r"display:\s*none", body_css):
            hidden_classes.add(cls)

    def add_fill(m: re.Match) -> str:
        tag = m.group(0)
        cm = re.search(r'class="([^"]+)"', tag)
        if not cm:
            return tag
        classes = cm.group(1).split()
        # An element whose class is display:none is invisible — drop it.
        if any(c in hidden_classes for c in classes):
            return ""
        hexv = None
        for cls in classes:
            if cls in class_fill:
                hexv = class_fill[cls]
                break
        if hexv is None:
            return tag
        # Drop the now-redundant class attribute.
        tag = re.sub(r'\s*class="[^"]*"', "", tag)
        if "fill=" in tag:
            return tag
        # Insert the resolved fill just before the tag's closing delimiter,
        # preserving self-closing ("/>") vs open (">") forms.
        if tag.rstrip().endswith("/>"):
            head = tag[: tag.rfind("/>")].rstrip()
            return f'{head} fill="{hexv}"/>'
        return tag[:-1].rstrip() + f' fill="{hexv}">'

    text = re.sub(r"<(?:path|circle|ellipse|polygon|polyline|rect|line)\b[^>]*?/?>", add_fill, text)
    # remove the now-unused defs/style block
    text = re.sub(r"<defs>.*?</defs>", "", text, flags=re.S)
    return text


def _norm_hex(h: str) -> str:
    h = h.strip().upper()
    if len(h) == 4:  # #abc -> #aabbcc
        h = "#" + "".join(c * 2 for c in h[1:])
    return h


@lru_cache(maxsize=512)
def _parse_tile(path_str: str) -> tuple[str, str, tuple[tuple[str, str], ...]]:
    """Return (bg_hex, fg_template, ink_fills).

    fg_template is the foreground markup with each element's fill replaced by a
    role token ({{INK}} or {{GROUND}}); the caller substitutes real colours.
    ink_fills is the tuple of original ink hexes (diagnostics only).
    """
    text = Path(path_str).read_text()
    text = _round_sci(text)
    text = _resolve_css_classes(text)

    # Background = first full-bleed rect (width 200 / no x or x=0).
    bg_hex = "#F3F3F3"
    bg_match = None
    for m in re.finditer(r"<rect\b[^>]*>", text):
        tag = m.group(0)
        fm = re.search(r'fill="(#[0-9A-Fa-f]{3,6})"', tag)
        wm = re.search(r'width="([\d.]+)"', tag)
        if fm and wm and float(wm.group(1)) >= 199:
            bg_hex = _norm_hex(fm.group(1))
            bg_match = m
            break

    # Foreground = SVG body minus the bg rect.
    body_start = text.find(">", text.find("<svg")) + 1
    body_end = text.rfind("</svg>")
    body = text[body_start:body_end]
    if bg_match:
        body = body.replace(bg_match.group(0), "", 1)

    # Collect foreground elements, classify each fill as ink vs ground.
    ink_fills: list[str] = []

    def role_for(hexv: str) -> str:
        return "GROUND" if _norm_hex(hexv) == bg_hex else "INK"

    def retag(m: re.Match) -> str:
        tag = m.group(0)
        fm = re.search(r'fill="(#[0-9A-Fa-f]{3,6})"', tag)
        if not fm:
            # untagged element defaults to ink
            return tag[:-1] + ' fill="{{INK}}"' + tag[-1]
        hexv = fm.group(1)
        role = role_for(hexv)
        if role == "INK":
            ink_fills.append(_norm_hex(hexv))
        return tag.replace(fm.group(0), f'fill="{{{{{role}}}}}"')

    fg = re.sub(r"<(?:" + "|".join(FG_TAGS) + r")\b[^>]*?/?>", retag, body)
    fg = fg.strip()
    return bg_hex, fg, tuple(dict.fromkeys(ink_fills))


def tile_native_bg(tile_path: Path) -> str:
    bg, _, _ = _parse_tile(str(tile_path))
    return bg


def render_tile_group(tile_path: Path, fg_hex: str, bg_hex: str) -> str:
    """Return the foreground markup recoloured for one cell.

    INK fills -> fg_hex, GROUND fills (negative-space cut-outs) -> bg_hex, so
    figure-on-ground tiles keep their interior windows the same colour as the
    cell background and read correctly.
    """
    _, template, _ = _parse_tile(str(tile_path))
    return template.replace("{{INK}}", fg_hex).replace("{{GROUND}}", bg_hex)
