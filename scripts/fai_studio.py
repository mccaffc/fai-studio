#!/usr/bin/env python3
"""Minimal Flask studio for testing the FAI banner generator."""
from __future__ import annotations

import argparse
import base64
import json
import os
import random
import sys
from pathlib import Path

from flask import Flask, jsonify, request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fai_banner as fb  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
TILES_DIR = BASE / "output" / "shapes-clean"
MANIFEST = BASE / "tiles-manifest-v2.json"

try:
    import cairosvg  # noqa: F401

    HAS_CAIROSVG = True
except Exception:
    HAS_CAIROSVG = False

app = Flask(__name__)
TILES, _MANIFEST = fb.load_tiles(MANIFEST)

RATIFIED = [
    ("International Orange", "#FF4F00", False),
    ("Cod Gray", "#121212", False),
    ("White", "#FFFFFF", False),
    ("Smoke White", "#F3F3F3", False),
    ("Chrome Yellow", "#FFA300", False),
    ("Celestial Blue", "#4997D0", False),
    ("Timberwolf", "#D9D9D6", False),
    ("Iris Violet", "#7150D6", True),
    ("Telemagenta", "#D63A8C", True),
    ("Signal Green", "#2EA84F", True),
    ("Slate Indigo", "#3A4A6B", True),
]

HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FAI Banner Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500&display=swap" rel="stylesheet">
  <style>
    :root { --ink:#121212; --accent:#FF4F00; --line:#d9d9d6; --soft:#f3f3f3; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"IBM Plex Sans", Arial, sans-serif; color:var(--ink); background:#fff; }
    header { padding:28px 34px 18px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:end; gap:24px; }
    .mark { font-family:"IBM Plex Serif", Georgia, serif; font-size:24px; letter-spacing:.02em; }
    .sub { font-family:"IBM Plex Mono", monospace; font-size:12px; color:#666; }
    main { padding:30px 34px 46px; max-width:1500px; margin:0 auto; }
    form { display:grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap:18px; align-items:end; }
    label { display:grid; gap:7px; font-size:12px; font-family:"IBM Plex Mono", monospace; text-transform:uppercase; letter-spacing:.04em; }
    input, select, button { border:1px solid var(--ink); border-radius:0; background:#fff; color:var(--ink); min-height:40px; padding:8px 10px; font:500 14px "IBM Plex Sans", Arial, sans-serif; }
    button { background:var(--accent); border-color:var(--accent); color:#fff; cursor:pointer; }
    button:disabled { background:#aaa; border-color:#aaa; cursor:wait; }
    .wide { grid-column: span 2; }
    .tag { display:none; margin-top:4px; width:max-content; border:1px solid var(--accent); color:var(--accent); padding:2px 5px; font:500 10px "IBM Plex Mono", monospace; }
    .tag.show { display:inline-block; }
    #status { margin:22px 0; min-height:22px; font-family:"IBM Plex Mono", monospace; color:#666; font-size:12px; }
    #grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap:28px; }
    .result { border-top:2px solid var(--ink); padding-top:12px; }
    .banner { aspect-ratio:2/1; background:#fff; border:1px solid var(--line); overflow:hidden; }
    .banner svg { width:100%; height:100%; display:block; }
    .meta { display:flex; justify-content:space-between; gap:12px; align-items:baseline; margin-top:10px; }
    .name { font-weight:600; }
    .score { font-family:"IBM Plex Mono", monospace; color:var(--accent); }
    .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
    .chip { border:1px solid var(--line); padding:3px 6px; font:12px "IBM Plex Mono", monospace; background:var(--soft); }
    .links { display:flex; gap:14px; margin-top:10px; font-size:13px; }
    a { color:var(--ink); text-decoration-color:var(--accent); text-underline-offset:3px; }
    @media (max-width: 860px) { form { grid-template-columns:1fr 1fr; } .wide { grid-column:span 2; } header { align-items:start; flex-direction:column; } }
  </style>
</head>
<body>
  <header><div class="mark">FAI</div><div class="sub">Banner composition studio</div></header>
  <main>
    <form id="controls">
      <label>Color mode<select name="color_mode" id="mode">
        <option value="full">full</option><option value="duotone">duotone</option><option value="vertical">vertical</option><option value="extended">extended</option>
      </select></label>
      <label class="wide">Vertical hex<select id="vertical_select"></select><span id="proposal" class="tag">PROPOSAL</span></label>
      <label class="wide">Free hex<input name="vertical_hex" id="vertical_hex" placeholder="#4997D0"></label>
      <label>Template<select name="template"><option value="">any</option></select></label>
      <label>Seed<input name="seed" inputmode="numeric" placeholder="random"></label>
      <label>Candidates<input name="candidates" type="number" min="1" max="600" value="240"></label>
      <label>Keep<input name="keep" type="number" min="1" max="8" value="4"></label>
      <button id="go" type="submit">Generate</button>
    </form>
    <div id="status"></div>
    <section id="grid"></section>
  </main>
<script>
const ratified = __RATIFIED__;
const templates = __TEMPLATES__;
const hasPng = __HAS_PNG__;
const extras = ["#7150D6", "#D63A8C", "#2EA84F", "#3A4A6B"];
const sel = document.querySelector("#vertical_select");
for (const [name, hex, proposal] of ratified) {
  const opt = document.createElement("option");
  opt.value = hex; opt.textContent = `${name} ${hex}${proposal ? "  PROPOSAL" : ""}`; opt.dataset.proposal = proposal ? "1" : "";
  sel.appendChild(opt);
}
const free = document.querySelector("#vertical_hex");
const tag = document.querySelector("#proposal");
sel.value = "#4997D0"; free.value = sel.value;
sel.addEventListener("change", () => { free.value = sel.value; tag.classList.toggle("show", sel.selectedOptions[0].dataset.proposal === "1"); });
free.addEventListener("input", () => { const v = free.value.trim().toUpperCase(); tag.classList.toggle("show", !ratified.some(x => x[1] === v && !x[2])); });
const tmpl = document.querySelector("[name=template]");
for (const t of templates) { const opt = document.createElement("option"); opt.value = t; opt.textContent = t; tmpl.appendChild(opt); }
function dl(svg, name) {
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}
document.querySelector("#controls").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const mode = form.get("color_mode");
  const verticalHex = free.value.trim();
  const payload = {
    color_mode: mode,
    vertical_hex: verticalHex,
    template: form.get("template") || null,
    seed: form.get("seed") ? Number(form.get("seed")) : null,
    candidates: Math.min(600, Math.max(1, Number(form.get("candidates") || 240))),
    keep: Math.min(8, Math.max(1, Number(form.get("keep") || 4))),
    extra_hex: mode === "extended" ? extras : []
  };
  if (mode === "vertical" && !ratified.some(x => x[1] === verticalHex && !x[2])) payload.allow_unratified_hex = true;
  if (mode === "extended") payload.allow_unratified_hex = true;
  const go = document.querySelector("#go"), status = document.querySelector("#status"), grid = document.querySelector("#grid");
  go.disabled = true; status.textContent = "Generating..."; grid.innerHTML = "";
  try {
    const res = await fetch("/generate", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "generation failed");
    status.textContent = `${data.banners.length} banners from ${data.candidates} candidates`;
    grid.innerHTML = data.banners.map((b, i) => `
      <article class="result">
        <div class="banner">${b.svg}</div>
        <div class="meta"><span class="name">${b.template}</span><span class="score">${b.scores.total.toFixed(3)}</span></div>
        <div class="chips">${Object.entries(b.scores).filter(([k]) => !["total","candidate_index","base_seed","candidates"].includes(k)).map(([k,v]) => `<span class="chip">${k.slice(0,3)} ${Number(v).toFixed(2)}</span>`).join("")}</div>
        <div class="links"><a download="fai-banner-${i+1}.svg" href="${dl(b.svg, i)}">Download SVG</a>${hasPng ? `<a href="/png/${b.id}" download="fai-banner-${i+1}.png">Download PNG</a>` : ""}</div>
      </article>`).join("");
  } catch (err) { status.textContent = err.message; }
  finally { go.disabled = false; }
});
</script>
</body></html>"""

PNG_CACHE: dict[str, str] = {}


@app.get("/")
def index():
    html = (
        HTML.replace("__RATIFIED__", json.dumps(RATIFIED))
        .replace("__TEMPLATES__", json.dumps(sorted(fb.TEMPLATES)))
        .replace("__HAS_PNG__", "true" if HAS_CAIROSVG else "false")
    )
    return html


@app.post("/generate")
def generate():
    data = request.get_json(force=True) or {}
    color_mode = data.get("color_mode", "full")
    vertical_hex = (data.get("vertical_hex") or None)
    extra_hex = data.get("extra_hex") or []
    if color_mode == "extended" and extra_hex and not data.get("allow_unratified_hex"):
        return jsonify(error="--extra-hex requires proposal approval"), 400
    candidates = min(600, max(1, int(data.get("candidates") or 240)))
    keep = min(8, max(1, int(data.get("keep") or 4)))
    seed = data.get("seed")
    seed = int(seed) if seed is not None else random.randint(0, 2**31 - 1)
    banners = fb.generate_many(
        TILES,
        color_mode=color_mode,
        vertical_hex=vertical_hex,
        template=(lambda t: None if not t or t in ("any", "all") else t)(data.get("template")),
        seed=seed,
        n_candidates=candidates,
        keep=keep,
        extra_hexes=extra_hex,
    )
    out = []
    PNG_CACHE.clear()
    for i, banner in enumerate(banners):
        svg = fb.render_svg(banner, TILES_DIR, (960, 480))
        bid = f"{seed}-{i}"
        PNG_CACHE[bid] = base64.b64encode(svg.encode()).decode()
        out.append({"id": bid, "template": banner.template, "scores": banner.scores, "svg": svg})
    return jsonify(seed=seed, candidates=candidates, banners=out, has_png=HAS_CAIROSVG)


@app.get("/png/<bid>")
def png(bid: str):
    if not HAS_CAIROSVG or bid not in PNG_CACHE:
        return ("not available", 404)
    import cairosvg
    from flask import Response

    svg = base64.b64decode(PNG_CACHE[bid]).decode()
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=960, output_height=480)
    return Response(png, mimetype="image/png")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    args = ap.parse_args(argv)
    app.run(host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
