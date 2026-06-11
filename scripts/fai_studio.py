#!/usr/bin/env python3
"""Minimal Flask studio for the FAI composition engine (banners + deck pieces)."""
from __future__ import annotations

import argparse
import base64
import json
import os
import random
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

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

# Accent choices: the three ratified accent fills + the four proposal hues.
# (Grounds/neutrals are not accents and composed surfaces never use pure white.)
ACCENTS = [
    ("International Orange", "#FF4F00", False),
    ("Chrome Yellow", "#FFA300", False),
    ("Celestial Blue", "#4997D0", False),
    ("Iris Violet", "#8265DB", True),
    ("Telemagenta", "#D63A8C", True),
    ("Signal Green", "#268B41", True),
    ("Slate Indigo", "#3A4A6B", True),
]
PROPOSAL_HEXES = [h for _, h, p in ACCENTS if p]

# Display geometry per size (SVG render dims; cards use the same aspect).
SIZES = {
    "banner": {"dims": (960, 480), "label": "Banner · 6×3"},
    "strip": {"dims": (900, 300), "label": "Strip · 3×1"},
    "panel": {"dims": (480, 720), "label": "Panel · 2×3"},
    "square": {"dims": (600, 600), "label": "Square · 3×3"},
}

HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FAI Composition Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500&display=swap" rel="stylesheet">
  <style>
    :root { --ink:#121212; --accent:#FF4F00; --line:#d9d9d6; --soft:#f3f3f3; }
    * { box-sizing: border-box; }
    body { margin:0; font-family:"IBM Plex Sans", Arial, sans-serif; color:var(--ink); background:var(--soft); }
    header { padding:18px 34px; display:flex; justify-content:space-between; align-items:center; gap:24px; background:#121212; color:#f3f3f3; }
    .brand { display:flex; align-items:center; gap:14px; }
    .mark { width:34px; height:auto; display:block; }
    .sub { font-family:"IBM Plex Mono", monospace; font-size:12px; color:#f3f3f3; }
    main { padding:30px 34px 46px; max-width:1500px; margin:0 auto; }
    form { display:grid; grid-template-columns: repeat(4, minmax(170px, 1fr)); gap:18px 22px; align-items:start; }
    label { display:grid; gap:7px; font-size:12px; font-family:"IBM Plex Mono", monospace; text-transform:uppercase; letter-spacing:.04em; align-content:start; }
    input, select, button { border:1px solid var(--ink); border-radius:0; background:#fff; color:var(--ink); min-height:40px; padding:8px 10px; font:500 14px "IBM Plex Sans", Arial, sans-serif; width:100%; }
    select:disabled, input:disabled { background:var(--soft); color:#999; border-color:#bbb; }
    button { background:var(--accent); border-color:var(--accent); color:#fff; cursor:pointer; }
    button:disabled { background:#aaa; border-color:#aaa; cursor:wait; }
    .help { display:block; font:400 11px/1.35 "IBM Plex Sans", Arial, sans-serif; text-transform:none; letter-spacing:0; color:#666; min-height:30px; }
    .tag { display:none; margin-top:2px; width:max-content; border:1px solid var(--accent); color:var(--accent); padding:2px 5px; font:500 10px "IBM Plex Mono", monospace; }
    .tag.show { display:inline-block; }
    #custom_wrap { display:none; }
    #custom_wrap.show { display:grid; }
    .row2 { display:grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap:18px 22px; margin-top:18px; align-items:end; }
    #status { margin:22px 0; min-height:22px; font-family:"IBM Plex Mono", monospace; color:#666; font-size:12px; }
    #grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap:28px; align-items:start; }
    .result { border-top:2px solid var(--ink); padding-top:12px; }
    .frame { background:#fff; border:1px solid var(--line); overflow:hidden; display:flex; }
    .frame svg { width:100%; height:auto; display:block; }
    .meta { display:flex; justify-content:space-between; gap:12px; align-items:baseline; margin-top:10px; }
    .name { font-weight:600; }
    .score { font-family:"IBM Plex Mono", monospace; color:var(--accent); }
    .chips { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
    .chip { border:1px solid var(--line); padding:3px 6px; font:12px "IBM Plex Mono", monospace; background:#fff; }
    .links { display:flex; gap:14px; margin-top:10px; font-size:13px; }
    a { color:var(--ink); text-decoration-color:var(--accent); text-underline-offset:3px; }
    @media (max-width: 900px) { form, .row2 { grid-template-columns:1fr 1fr; } }
  </style>
</head>
<body>
  <header>
    <div class="brand"><img class="mark" src="/studio-assets/Logomark-White.svg" alt="FAI"></div>
    <div class="sub">Composition studio — banners &amp; deck pieces</div>
  </header>
  <main>
    <form id="controls">
      <label>Size<select name="size" id="size">
        <option value="banner">Banner · 6×3</option>
        <option value="strip">Strip · 3×1</option>
        <option value="panel">Panel · 2×3</option>
        <option value="square">Square · 3×3</option>
      </select><span class="help">Banner for web/social headers; strip, panel and square are deck-scale pieces.</span></label>
      <label>Color mode<select name="color_mode" id="mode">
        <option value="full">full</option><option value="duotone">duotone</option><option value="vertical">vertical</option><option value="extended">extended</option>
      </select><span class="help" id="mode_help">all ratified fills — your accent leads</span></label>
      <label>Accent<select id="accent"></select><span id="proposal" class="tag">PROPOSAL</span><span class="help" id="accent_help">Guaranteed to appear in the composition.</span></label>
      <label id="custom_wrap">Custom hex<input id="custom_hex" placeholder="#268B41"><span class="help">Proposal-work only — unratified colors never ship on master surfaces.</span></label>
      <label id="template_wrap">Template<select name="template"><option value="">any</option></select><span class="help">Banner archetypes. Pieces sample their own layouts.</span></label>
    </form>
    <div class="row2">
      <label>Seed<input name="seed" id="seed" inputmode="numeric" placeholder="random"></label>
      <label>Candidates<input name="candidates" id="candidates" type="number" min="1" max="600" value="240"></label>
      <label>Keep<input name="keep" id="keep" type="number" min="1" max="8" value="4"></label>
      <button id="go" type="submit" form="controls">Generate</button>
    </div>
    <div id="status"></div>
    <section id="grid"></section>
  </main>
<script>
const accents = __ACCENTS__;
const templates = __TEMPLATES__;
const hasPng = __HAS_PNG__;
const sel = document.querySelector("#accent");
for (const [name, hex, proposal] of accents) {
  const opt = document.createElement("option");
  opt.value = hex; opt.textContent = `${name} ${hex}`; opt.dataset.proposal = proposal ? "1" : "";
  sel.appendChild(opt);
}
const customOpt = document.createElement("option");
customOpt.value = "custom"; customOpt.textContent = "Custom hex…";
sel.appendChild(customOpt);
const customWrap = document.querySelector("#custom_wrap");
const customHex = document.querySelector("#custom_hex");
const tag = document.querySelector("#proposal");
function accentValue() {
  if (sel.value === "custom") return (customHex.value.trim().toUpperCase() || "#FF4F00");
  return sel.value;
}
function accentIsProposal() {
  if (sel.value === "custom") return true;
  return sel.selectedOptions[0].dataset.proposal === "1";
}
function refreshAccentUI() {
  customWrap.classList.toggle("show", sel.value === "custom");
  tag.classList.toggle("show", accentIsProposal());
}
sel.addEventListener("change", refreshAccentUI);
customHex.addEventListener("input", refreshAccentUI);

const tmpl = document.querySelector("[name=template]");
for (const t of templates) { const o = document.createElement("option"); o.value = t; o.textContent = t; tmpl.appendChild(o); }
const sizeSel = document.querySelector("#size");
const templateWrap = document.querySelector("#template_wrap");
function refreshSizeUI() { templateWrap.style.display = sizeSel.value === "banner" ? "" : "none"; }
sizeSel.addEventListener("change", refreshSizeUI);

const modeSel = document.querySelector("#mode");
const modeHelp = document.querySelector("#mode_help");
const accentHelp = document.querySelector("#accent_help");
function refreshModeUI() {
  const m = modeSel.value;
  modeHelp.textContent = {
    full: "all ratified fills — your accent leads",
    duotone: "Cod Gray + Smoke White + International Orange only",
    vertical: "one ground + Smoke White + your accent only",
    extended: "ratified fills + the proposal hues — your accent is guaranteed"
  }[m];
  const duo = m === "duotone";
  sel.disabled = duo; customHex.disabled = duo;
  accentHelp.textContent = duo ? "Duotone is always International Orange." : "Guaranteed to appear in the composition.";
}
modeSel.addEventListener("change", refreshModeUI);
refreshAccentUI(); refreshSizeUI(); refreshModeUI();

function dl(svg) { return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))); }

document.querySelector("#controls").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = modeSel.value;
  const accent = mode === "duotone" ? null : accentValue();
  const payload = {
    size: sizeSel.value,
    color_mode: mode,
    accent: accent,
    template: tmpl.value || null,
    seed: document.querySelector("#seed").value ? Number(document.querySelector("#seed").value) : null,
    candidates: Math.min(600, Math.max(1, Number(document.querySelector("#candidates").value || 240))),
    keep: Math.min(8, Math.max(1, Number(document.querySelector("#keep").value || 4)))
  };
  if (accent && accentIsProposal()) payload.allow_unratified_hex = true;
  if (mode === "extended") payload.allow_unratified_hex = true;
  const go = document.querySelector("#go"), status = document.querySelector("#status"), grid = document.querySelector("#grid");
  go.disabled = true; status.textContent = "Generating..."; grid.innerHTML = "";
  try {
    const res = await fetch("/generate", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "generation failed");
    status.textContent = `${data.banners.length} compositions from ${data.candidates} candidates`;
    grid.innerHTML = data.banners.map((b, i) => `
      <article class="result">
        <div class="frame">${b.svg}</div>
        <div class="meta"><span class="name">${b.template}</span><span class="score">${b.scores.total.toFixed(3)}</span></div>
        <div class="chips">${Object.entries(b.scores).filter(([k,v]) => !["total","candidate_index","base_seed","candidates","chosen_accent","grid_cols","grid_rows"].includes(k) && Number.isFinite(Number(v))).map(([k,v]) => `<span class="chip">${k.slice(0,3)} ${Number(v).toFixed(2)}</span>`).join("")}</div>
        <div class="links"><a download="fai-${data.size}-${i+1}.svg" href="${dl(b.svg)}">Download SVG</a>${hasPng ? `<a href="/png/${b.id}" download="fai-${data.size}-${i+1}.png">Download PNG</a>` : ""}</div>
      </article>`).join("");
  } catch (err) { status.textContent = err.message; }
  finally { go.disabled = false; }
});
</script>
</body></html>"""

PNG_CACHE: dict[str, tuple[str, tuple[int, int]]] = {}


@app.get("/")
def index():
    return (
        HTML.replace("__ACCENTS__", json.dumps(ACCENTS))
        .replace("__TEMPLATES__", json.dumps(fb.BANNER_TEMPLATES))
        .replace("__HAS_PNG__", "true" if HAS_CAIROSVG else "false")
    )


@app.get("/studio-assets/<path:name>")
def studio_assets(name: str):
    return send_from_directory(BASE / "studio-assets", name)


@app.post("/generate")
def generate():
    data = request.get_json(force=True) or {}
    size = data.get("size", "banner")
    if size not in SIZES:
        return jsonify(error=f"unknown size {size}"), 400
    color_mode = data.get("color_mode", "full")
    accent = data.get("accent") or data.get("vertical_hex") or None
    known = {h.upper() for _, h, _p in ACCENTS}
    if accent and accent.upper() not in known and not data.get("allow_unratified_hex"):
        return jsonify(error="custom accent hexes are proposal-work — approval flag required"), 400
    if color_mode == "extended" and not data.get("allow_unratified_hex"):
        return jsonify(error="extended mode uses proposal hues — approval flag required"), 400
    candidates = min(600, max(1, int(data.get("candidates") or 240)))
    keep = min(8, max(1, int(data.get("keep") or 4)))
    seed = data.get("seed")
    seed = int(seed) if seed is not None else random.randint(0, 2**31 - 1)
    extra = PROPOSAL_HEXES if color_mode == "extended" else []
    if size == "banner":
        banners = fb.generate_many(
            TILES, color_mode=color_mode, vertical_hex=accent,
            template=(lambda t: None if not t or t in ("any", "all") else t)(data.get("template")),
            seed=seed, n_candidates=candidates, keep=keep, extra_hexes=extra,
        )
        grid = None
    else:
        banners = fb.generate_pieces(
            TILES, size, color_mode=color_mode, vertical_hex=accent,
            seed=seed, n_candidates=candidates, keep=keep, extra_hexes=extra,
        )
        grid = fb.PIECE_GRIDS[size]
    dims = SIZES[size]["dims"]
    out = []
    PNG_CACHE.clear()
    for i, banner in enumerate(banners):
        svg = fb.render_svg(banner, TILES_DIR, dims, grid=grid)
        bid = f"{seed}-{i}"
        PNG_CACHE[bid] = (base64.b64encode(svg.encode()).decode(), dims)
        out.append({"id": bid, "template": banner.template, "scores": banner.scores, "svg": svg})
    return jsonify(seed=seed, candidates=candidates, size=size, banners=out, has_png=HAS_CAIROSVG)


@app.get("/png/<bid>")
def png(bid: str):
    if not HAS_CAIROSVG or bid not in PNG_CACHE:
        return ("not available", 404)
    import cairosvg
    from flask import Response

    b64, dims = PNG_CACHE[bid]
    svg = base64.b64decode(b64).decode()
    data = cairosvg.svg2png(bytestring=svg.encode(), output_width=dims[0] * 2, output_height=dims[1] * 2)
    return Response(data, mimetype="image/png")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8765)))
    args = ap.parse_args(argv)
    app.run(host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
