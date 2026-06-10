#!/usr/bin/env python3
"""
svg_raster.py — tiny dependency-light SVG rasteriser + PNG decoder.

Wraps cairosvg for SVG->PNG and decodes the PNG to RGBA bytes WITHOUT Pillow
(the fai-deck venv only ships cairosvg). Used by the tile-geometry analyser and
the contact-sheet tool so they can reason about foreground pixels.

cairosvg needs the Homebrew cairo dylibs; callers are expected to launch with
    DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path
from typing import Optional

import cairosvg


def svg_to_png_bytes(
    svg_path: Optional[str] = None,
    svg_bytes: Optional[bytes] = None,
    width: int = 64,
    height: int = 64,
) -> bytes:
    if svg_path is not None:
        return cairosvg.svg2png(url=str(svg_path), output_width=width, output_height=height)
    return cairosvg.svg2png(bytestring=svg_bytes, output_width=width, output_height=height)


def decode_png(data: bytes) -> tuple[bytearray, int, int, int]:
    """Decode a (cairosvg-produced) PNG to (pixels, width, height, channels)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    idat = b""
    width = height = ctype = 0
    while pos < len(data):
        ln = struct.unpack(">I", data[pos : pos + 4])[0]
        typ = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            width, height, _bitd, ctype = struct.unpack(">IIBB", chunk[:10])
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    ch = 4 if ctype == 6 else 3
    stride = width * ch
    out = bytearray()
    prev = bytearray(stride)
    p = 0
    for _y in range(height):
        f = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out += line
        prev = line
    return out, width, height, ch


def analyse_foreground(
    svg_path: str,
    bg_hex: str,
    n: int = 96,
) -> dict:
    """Rasterise a tile and measure its foreground (non-background) pixels.

    Returns fill_fraction, centroid (cx, cy in 0..1), and the spread / radial
    profile used to distinguish centre vs outward shapes.
    """
    bg = bg_hex.lstrip("#")
    br, bgc, bb = int(bg[0:2], 16), int(bg[2:4], 16), int(bg[4:6], 16)
    px, w, h, ch = decode_png(svg_to_png_bytes(svg_path=svg_path, width=n, height=n))

    cnt = 0
    sx = sy = 0.0
    fg = []  # (nx, ny) in -0.5..0.5 about centre
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * ch
            r, g, b = px[i], px[i + 1], px[i + 2]
            if abs(r - br) + abs(g - bgc) + abs(b - bb) > 60:
                cnt += 1
                sx += x
                sy += y
                fg.append(((x + 0.5) / w - 0.5, (y + 0.5) / h - 0.5))

    if cnt == 0:
        return {"fill_fraction": 0.0, "centroid": None, "spread": 0.0, "n_fg": 0}

    cx = sx / cnt / w
    cy = sy / cnt / h
    # spatial spread (std of radius from tile centre, normalised)
    rs = [(dx * dx + dy * dy) ** 0.5 for dx, dy in fg]
    mean_r = sum(rs) / len(rs)
    var_r = sum((r - mean_r) ** 2 for r in rs) / len(rs)
    return {
        "fill_fraction": round(cnt / (w * h), 4),
        "centroid": (round(cx, 4), round(cy, 4)),
        "mean_radius": round(mean_r, 4),
        "std_radius": round(var_r ** 0.5, 4),
        "n_fg": cnt,
    }
