#!/usr/bin/env python3
"""6-set partition v02 — primary family first, tiles previewed in program color,
representatives chosen by visual_weight (boldest), not degenerate '01' tiles.
Render: qlmanage -t -s 1600 -o . sets-montage.svg"""
import os, re, glob, json

ROOT = os.path.join(os.path.dirname(__file__), "..", "output", "shapes-clean")
MAN  = os.path.join(os.path.dirname(__file__), "..", "tiles-manifest-v2.json")
COD="#121212"; BONE="#EDE6D6"; GRAY="#8A8A8A"
W=H=1600; MX=46

# set, program color, families (FIRST = primary)
SETS = [
 ("FAI  (parent)",            "#FF4F00", ["Angle","Circle","Composition"]),
 ("Technology & Statecraft",  "#FFA300", ["Lines","Ramp","Square"]),
 ("American Governance",      "#4997D0", ["Merge","Mirror","Rectangle"]),
 ("Artificial Intelligence",  "#7150D6", ["Open","Centric","Shape"]),
 ("Energy & Infrastructure",  "#2EA84F", ["Wave","Cascade","Curve"]),
 ("Science & Innovation",     "#D63A8C", ["Float","Joint"]),
]

# weight lookup: "Family/NN.svg" -> visual_weight
weights = {}
for t in json.load(open(MAN))["tiles"]:
    weights[t["filename"]] = t.get("visual_weight", 0)
def wkey(fam, path):
    return weights.get(f"{fam}/{os.path.basename(path)}", 0)

def esc(s): return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
def inner(path, color):
    t=open(path).read(); m=re.search(r"<svg[^>]*>(.*)</svg>", t, re.S)
    return (m.group(1) if m else "").replace("#121212", color)

def samples(fams, n=6):
    """primary family contributes its 2-3 boldest; supports 1 each; fill by weight."""
    picks=[]
    for fi,fam in enumerate(fams):
        files=sorted(glob.glob(os.path.join(ROOT,fam,"*.svg")), key=lambda p: wkey(fam,p), reverse=True)
        take = 3 if fi==0 else 1
        for p in files[:take]:
            picks.append((fam,p))
    # if room, add more from primary
    if len(picks) < n and fams:
        fam=fams[0]
        more=sorted(glob.glob(os.path.join(ROOT,fam,"*.svg")), key=lambda p: wkey(fam,p), reverse=True)[3:]
        for p in more:
            if len(picks)>=n: break
            picks.append((fam,p))
    return picks[:n]

S=[f'<rect width="{W}" height="{H}" fill="{COD}"/>']
S.append(f'<text x="{MX}" y="50" font-family="Helvetica,Arial" font-size="32" font-weight="bold" fill="{BONE}" letter-spacing="1">FAI SHAPE SETS — v02</text>')
S.append(f'<text x="{MX}" y="76" font-family="Helvetica,Arial" font-size="15" fill="#FF4F00">primary family first (bold) · tiles in program color · boldest tiles shown</text>')

top=104; band_h=232; labelw=330; cell=150; gap=14
for i,(name,color,fams) in enumerate(SETS):
    y=top+i*(band_h+10)
    S.append(f'<rect x="{MX}" y="{y}" width="8" height="{band_h-30}" fill="{color}"/>')
    S.append(f'<text x="{MX+24}" y="{y+30}" font-family="Helvetica,Arial" font-size="21" font-weight="bold" fill="{color}">{esc(name)}</text>')
    fam_lbl = f"{fams[0]} (primary)" + ("  ·  " + " · ".join(fams[1:]) if len(fams)>1 else "")
    S.append(f'<text x="{MX+24}" y="{y+56}" font-family="Helvetica,Arial" font-size="14" fill="{BONE}">{esc(fam_lbl)}</text>')
    tot=sum(len(glob.glob(os.path.join(ROOT,f,"*.svg"))) for f in fams)
    S.append(f'<text x="{MX+24}" y="{y+78}" font-family="Helvetica,Arial" font-size="13" fill="{GRAY}">{len(fams)} families · {tot} tiles</text>')
    tx0=MX+labelw
    for j,(fam,p) in enumerate(samples(fams,6)):
        tx=tx0+j*(cell+gap); ty=y; sc=cell/200.0
        S.append(f'<g transform="translate({tx},{ty}) scale({sc:.4f})">{inner(p,color)}</g>')
        S.append(f'<text x="{tx}" y="{ty+cell+16}" font-family="Helvetica,Arial" font-size="11" fill="{GRAY}">{fam}</text>')

svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">\n'+"\n".join(S)+"\n</svg>\n"
out=os.path.join(os.path.dirname(__file__),"..","output","sets-montage.svg")
open(out,"w").write(svg); print("wrote",out)
