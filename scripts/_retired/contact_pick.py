import os, re, glob, math, sys
ROOT=os.path.join(os.path.dirname(__file__),"..","output","shapes-clean")
COD="#121212";BONE="#EDE6D6";ORANGE="#FF4F00";GRAY="#8A8A8A"
MX=40;COLS=12;TILE=128;GAP=8
fams=sys.argv[1].split(",") if len(sys.argv)>1 else ["Lines","Open","Curve","Centric","Cascade","Ramp","Float"]
def inner(p):
    t=open(p).read();m=re.search(r"<svg[^>]*>(.*)</svg>",t,re.S);return m.group(1) if m else ""
W=MX*2+COLS*TILE+(COLS-1)*GAP
body=[];y=104
for fam in fams:
    files=sorted(glob.glob(os.path.join(ROOT,fam,"*.svg")))
    body.append(f'<text x="{MX}" y="{y}" font-family="Helvetica,Arial" font-size="18" font-weight="bold" fill="{ORANGE}">{fam} · {len(files)}</text>');y+=12
    for i,f in enumerate(files):
        r,c=divmod(i,COLS);x=MX+c*(TILE+GAP);ty=y+r*(TILE+20);sc=TILE/200.0
        body.append(f'<g transform="translate({x},{ty}) scale({sc:.4f})">{inner(f)}</g>')
        body.append(f'<text x="{x+2}" y="{ty+TILE+12}" font-family="Helvetica,Arial" font-size="10" fill="{GRAY}">{os.path.splitext(os.path.basename(f))[0]}</text>')
    y+=math.ceil(len(files)/COLS)*(TILE+20)+26
H=y+20
svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="{COD}"/><text x="{MX}" y="60" font-family="Helvetica,Arial" font-size="26" font-weight="bold" fill="{BONE}">ARC + OVERLAP CANDIDATES</text>'+"\n".join(body)+"</svg>"
open(os.path.join(ROOT,"..","contact-pick.svg"),"w").write(svg);print(f"{W}x{H}")
