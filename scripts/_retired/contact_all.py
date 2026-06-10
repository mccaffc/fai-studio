#!/usr/bin/env python3
"""Full contact sheet: every tile, grouped by family, labeled, monochrome on Cod Gray.
Render: qlmanage -t -s 2400 -o . contact-all.svg"""
import os, re, glob, math, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "output", "shapes-clean")
COD="#121212"; BONE="#EDE6D6"; ORANGE="#FF4F00"; GRAY="#8A8A8A"
MX=40; COLS=11; TILE=110; GAP=8; HEADER=34

fams = sorted([d for d in os.listdir(ROOT) if os.path.isdir(os.path.join(ROOT,d))])
# optional: argv[1]=start, argv[2]=end (family slice), argv[3]=outfile suffix
if len(sys.argv) >= 3:
    fams = fams[int(sys.argv[1]):int(sys.argv[2])]
suffix = sys.argv[3] if len(sys.argv) >= 4 else ""
def inner(p):
    t=open(p).read(); m=re.search(r"<svg[^>]*>(.*)</svg>", t, re.S); return m.group(1) if m else ""

W = MX*2 + COLS*TILE + (COLS-1)*GAP
body=[]; y=110
for fam in fams:
    files=sorted(glob.glob(os.path.join(ROOT,fam,"*.svg")))
    body.append(f'<text x="{MX}" y="{y}" font-family="Helvetica,Arial" font-size="17" font-weight="bold" fill="{ORANGE}">{fam}</text>')
    body.append(f'<text x="{MX+200}" y="{y}" font-family="Helvetica,Arial" font-size="13" fill="{GRAY}">{len(files)} tiles</text>')
    y += 12
    for i,f in enumerate(files):
        r,c = divmod(i, COLS)
        x = MX + c*(TILE+GAP); ty = y + r*(TILE+22)
        sc = TILE/200.0
        body.append(f'<g transform="translate({x},{ty}) scale({sc:.4f})">{inner(f)}</g>')
        num = os.path.splitext(os.path.basename(f))[0]
        body.append(f'<text x="{x+2}" y="{ty+TILE+13}" font-family="Helvetica,Arial" font-size="10" fill="{GRAY}">{fam[:3].lower()}/{num}</text>')
    rows = math.ceil(len(files)/COLS)
    y += rows*(TILE+22) + 30

H = y + 30
head=[f'<rect width="{W}" height="{H}" fill="{COD}"/>',
      f'<text x="{MX}" y="52" font-family="Helvetica,Arial" font-size="30" font-weight="bold" fill="{BONE}">FAI TILES — full contact sheet</text>',
      f'<text x="{MX}" y="76" font-family="Helvetica,Arial" font-size="14" fill="{ORANGE}">141 tiles · 17 families · monochrome (form only)</text>']
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n'+"\n".join(head+body)+"\n</svg>\n"
out=os.path.join(os.path.dirname(__file__),"..","output",f"contact-{suffix}.svg")
open(out,"w").write(svg); print("wrote",out,f"({W}x{H})")
