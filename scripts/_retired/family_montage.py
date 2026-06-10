#!/usr/bin/env python3
"""Montage: one representative tile per shape-family, labeled, on Cod Gray.
Render: qlmanage -t -s 1560 -o . family-montage.svg"""
import os, re, glob

ROOT = os.path.join(os.path.dirname(__file__), "..", "output", "shapes-clean")
COD = "#121212"; BONE = "#EDE6D6"; ORANGE = "#FF4F00"; GRAY = "#8A8A8A"
W = H = 1560; MX = 50

fams = sorted([d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT, d))])
def inner(path):
    t = open(path).read()
    m = re.search(r"<svg[^>]*>(.*)</svg>", t, re.S)
    return m.group(1) if m else ""

cols = 5
cell = 262; gap = 24; labelh = 44
S = [f'<rect x="0" y="0" width="{W}" height="{H}" fill="{COD}"/>']
S.append(f'<text x="{MX}" y="56" font-family="Helvetica,Arial" font-size="34" font-weight="bold" fill="{BONE}" letter-spacing="1">FAI SHAPE FAMILIES</text>')
S.append(f'<text x="{MX}" y="82" font-family="Helvetica,Arial" font-size="15" fill="{ORANGE}">17 families · 141 tiles · one representative shown per family</text>')
top = 110
for i, fam in enumerate(fams):
    files = sorted(glob.glob(os.path.join(ROOT, fam, "*.svg")))
    if not files:
        continue
    rep = files[len(files)//2]  # middle, avoid degenerate first
    r, c = divmod(i, cols)
    x = MX + c*(cell+gap)
    y = top + r*(cell+labelh+gap)
    scale = cell/200.0
    S.append(f'<g transform="translate({x},{y}) scale({scale:.4f})">{inner(rep)}</g>')
    S.append(f'<text x="{x}" y="{y+cell+20}" font-family="Helvetica,Arial" font-size="16" font-weight="bold" fill="{BONE}">{fam}</text>')
    S.append(f'<text x="{x+cell}" y="{y+cell+20}" text-anchor="end" font-family="Helvetica,Arial" font-size="14" fill="{GRAY}">{len(files)}</text>')

svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n' + "\n".join(S) + "\n</svg>\n"
out = os.path.join(os.path.dirname(__file__), "..", "output", "family-montage.svg")
open(out, "w").write(svg)
print("wrote", out)
