#!/usr/bin/env python3
"""
Phase 3: FAI Contact Sheet Generator

Generates a static HTML page displaying banner thumbnails with metadata,
energy labels, seed numbers, and color distribution bars.

Usage:
    python generate_contact_sheet.py --input output/banners-generated/ --output output/contact-sheets/contact-sheet.html
    python generate_contact_sheet.py  # uses defaults
"""

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from collections import Counter

# ── Resolve imports ──────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fai_colors import BRAND_COLORS

# ── Constants ────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = BASE_DIR / "output" / "banners-generated"
DEFAULT_OUTPUT_DIR = BASE_DIR / "output" / "contact-sheets"

COLOR_TOKEN_TO_HEX = BRAND_COLORS.copy()

ENERGY_BADGE_COLORS = {
    "low":    ("#F3F3F3", "#121212"),  # light bg, dark text
    "medium": ("#FFA300", "#121212"),  # yellow bg, dark text
    "high":   ("#FF4F00", "#FFFFFF"),  # orange bg, white text
}


# ── Helpers ──────────────────────────────────────────────
def svg_to_data_uri(svg_path: Path) -> str:
    """Read an SVG file and return a base64 data URI for inline embedding."""
    svg_bytes = svg_path.read_bytes()
    b64 = base64.b64encode(svg_bytes).decode("ascii")
    return f"data:image/svg+xml;base64,{b64}"


def load_sidecar(json_path: Path) -> dict:
    """Load a banner's JSON sidecar metadata."""
    with open(json_path) as f:
        return json.load(f)


def compute_color_distribution(cells: list[dict]) -> dict[str, int]:
    """Count foreground color usage across cells."""
    return dict(Counter(c["fg_name"] for c in cells))


def compute_bg_distribution(cells: list[dict]) -> dict[str, int]:
    """Count background color usage across cells."""
    return dict(Counter(c["bg_name"] for c in cells))


# ── HTML Generation ──────────────────────────────────────
def generate_html(banners: list[dict]) -> str:
    """Generate the complete contact sheet HTML."""

    total = len(banners)
    by_energy = Counter(b["energy"] for b in banners)

    # Build banner cards
    cards_html = []
    for i, b in enumerate(banners):
        cards_html.append(_render_card(b, i + 1))

    cards_joined = "\n".join(cards_html)

    # Summary bar
    summary_parts = [f"<strong>{total}</strong> banners"]
    for e in ("low", "medium", "high"):
        if by_energy.get(e, 0) > 0:
            badge_bg, badge_fg = ENERGY_BADGE_COLORS[e]
            summary_parts.append(
                f'<span class="energy-badge" style="background:{badge_bg};color:{badge_fg};'
                f'border:1px solid #ccc;">{e}: {by_energy[e]}</span>'
            )

    summary_html = " &nbsp; ".join(summary_parts)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FAI Banner Contact Sheet</title>
<style>
  :root {{
    --bg: #FAFAFA;
    --card-bg: #FFFFFF;
    --border: #E0E0E0;
    --text: #121212;
    --text-muted: #666;
    --brand-orange: #FF4F00;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 24px;
    line-height: 1.5;
  }}
  .header {{
    max-width: 1400px;
    margin: 0 auto 24px;
    padding-bottom: 16px;
    border-bottom: 2px solid var(--brand-orange);
  }}
  .header h1 {{
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }}
  .header .subtitle {{
    font-size: 14px;
    color: var(--text-muted);
    margin-top: 4px;
  }}
  .summary-bar {{
    max-width: 1400px;
    margin: 0 auto 24px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 14px;
  }}
  .energy-badge {{
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }}
  .filter-bar {{
    max-width: 1400px;
    margin: 0 auto 24px;
    display: flex;
    gap: 8px;
  }}
  .filter-btn {{
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card-bg);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s;
  }}
  .filter-btn:hover {{ border-color: var(--brand-orange); }}
  .filter-btn.active {{
    background: var(--brand-orange);
    color: white;
    border-color: var(--brand-orange);
  }}
  .grid {{
    max-width: 1400px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
    gap: 20px;
  }}
  .card {{
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    transition: box-shadow 0.2s;
  }}
  .card:hover {{ box-shadow: 0 4px 12px rgba(0,0,0,0.08); }}
  .card-img {{
    width: 100%;
    aspect-ratio: 2 / 1;
    object-fit: cover;
    display: block;
    border-bottom: 1px solid var(--border);
  }}
  .card-body {{
    padding: 12px 16px;
  }}
  .card-title {{
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }}
  .card-title .name {{
    font-size: 14px;
    font-weight: 600;
    font-family: 'SF Mono', 'Menlo', monospace;
  }}
  .card-title .seed {{
    font-size: 12px;
    color: var(--text-muted);
    font-family: 'SF Mono', 'Menlo', monospace;
  }}
  .color-bar {{
    display: flex;
    height: 18px;
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 6px;
    border: 1px solid var(--border);
  }}
  .color-bar .segment {{
    position: relative;
    transition: flex 0.2s;
  }}
  .color-bar .segment:hover {{
    opacity: 0.8;
  }}
  .meta-row {{
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
  }}
  .meta-tag {{
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 10px;
    background: #F0F0F0;
    color: var(--text-muted);
    font-weight: 500;
  }}
  .color-legend {{
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
  }}
  .color-legend .swatch {{
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(0,0,0,0.15);
    vertical-align: middle;
    margin-right: 2px;
  }}
  .hidden {{ display: none !important; }}
</style>
</head>
<body>

<div class="header">
  <h1>FAI Banner Contact Sheet</h1>
  <div class="subtitle">Auto-generated banner compositions &mdash; Foundation for American Innovation</div>
</div>

<div class="summary-bar">
  {summary_html}
</div>

<div class="filter-bar">
  <button class="filter-btn active" onclick="filterEnergy('all')">All</button>
  <button class="filter-btn" onclick="filterEnergy('low')">Low</button>
  <button class="filter-btn" onclick="filterEnergy('medium')">Medium</button>
  <button class="filter-btn" onclick="filterEnergy('high')">High</button>
</div>

<div class="grid" id="banner-grid">
{cards_joined}
</div>

<script>
function filterEnergy(level) {{
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('.card').forEach(card => {{
    if (level === 'all' || card.dataset.energy === level) {{
      card.classList.remove('hidden');
    }} else {{
      card.classList.add('hidden');
    }}
  }});
}}
</script>

</body>
</html>"""


def _render_card(banner: dict, index: int) -> str:
    """Render a single banner card HTML."""
    energy = banner["energy"]
    seed = banner["seed"]
    filename = banner["filename"]
    data_uri = banner["data_uri"]
    fg_dist = banner["fg_distribution"]
    bg_dist = banner["bg_distribution"]
    total_cells = 18

    # Energy badge
    badge_bg, badge_fg = ENERGY_BADGE_COLORS[energy]
    badge = (
        f'<span class="energy-badge" style="background:{badge_bg};color:{badge_fg};'
        f'border:1px solid rgba(0,0,0,0.1);">{energy}</span>'
    )

    # Color bar (foreground distribution)
    bar_segments = []
    for color_name in sorted(fg_dist.keys()):
        count = fg_dist[color_name]
        pct = (count / total_cells) * 100
        hex_val = COLOR_TOKEN_TO_HEX.get(color_name, "#CCC")
        # Add a subtle border for light colors
        border = "border-right:1px solid rgba(0,0,0,0.1);" if hex_val in ("#FFFFFF", "#F3F3F3", "#D9D9D6") else ""
        bar_segments.append(
            f'<div class="segment" style="flex:{count};background:{hex_val};{border}" '
            f'title="{color_name}: {count} tiles ({pct:.0f}%)"></div>'
        )
    color_bar_html = "\n".join(bar_segments)

    # Color legend
    legend_items = []
    for color_name in sorted(fg_dist.keys()):
        count = fg_dist[color_name]
        hex_val = COLOR_TOKEN_TO_HEX.get(color_name, "#CCC")
        short_name = color_name.replace("_", " ").title()
        legend_items.append(
            f'<span><span class="swatch" style="background:{hex_val}"></span>'
            f'{short_name} ({count})</span>'
        )
    legend_html = "\n".join(legend_items)

    # Unique color counts
    n_fg_colors = len(fg_dist)
    n_bg_colors = len(bg_dist)

    return f"""  <div class="card" data-energy="{energy}">
    <img class="card-img" src="{data_uri}" alt="Banner {index}" loading="lazy">
    <div class="card-body">
      <div class="card-title">
        <span class="name">#{index:03d} &mdash; {filename}</span>
        {badge}
      </div>
      <div class="color-bar">{color_bar_html}</div>
      <div class="color-legend">{legend_html}</div>
      <div class="meta-row">
        <span class="meta-tag">seed: {seed}</span>
        <span class="meta-tag">{n_fg_colors} fg colors</span>
        <span class="meta-tag">{n_bg_colors} bg colors</span>
      </div>
    </div>
  </div>"""


# ── Discovery & Loading ──────────────────────────────────
def discover_banners(input_dir: Path) -> list[dict]:
    """Find all generated banners with their sidecars and build display data."""
    banners = []

    # Find all SVG files
    svg_files = sorted(input_dir.glob("banner-*.svg"))

    for svg_path in svg_files:
        json_path = svg_path.with_suffix(".json")

        if not json_path.exists():
            print(f"  Warning: no sidecar for {svg_path.name}, skipping")
            continue

        sidecar = load_sidecar(json_path)
        data_uri = svg_to_data_uri(svg_path)

        fg_dist = compute_color_distribution(sidecar.get("cells", []))
        bg_dist = compute_bg_distribution(sidecar.get("cells", []))

        banners.append({
            "filename": svg_path.name,
            "energy": sidecar.get("energy", "unknown"),
            "seed": sidecar.get("seed", 0),
            "dimensions": sidecar.get("dimensions", [1920, 960]),
            "color_bias": sidecar.get("color_bias"),
            "generated_at": sidecar.get("generated_at", ""),
            "data_uri": data_uri,
            "fg_distribution": fg_dist,
            "bg_distribution": bg_dist,
            "cells": sidecar.get("cells", []),
        })

    return banners


# ── Main ─────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="FAI Contact Sheet Generator")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_DIR,
                        help="Directory containing generated banners and sidecars")
    parser.add_argument("--output", type=Path, default=None,
                        help="Output HTML file path")
    args = parser.parse_args()

    input_dir = args.input
    if not input_dir.is_dir():
        print(f"Error: input directory not found: {input_dir}")
        sys.exit(1)

    # Discover banners
    print(f"Scanning: {input_dir}")
    banners = discover_banners(input_dir)

    if not banners:
        print("No banners found (looked for banner-*.svg with .json sidecars)")
        sys.exit(1)

    print(f"Found {len(banners)} banners")

    # Generate HTML
    html = generate_html(banners)

    # Write output
    output_dir = DEFAULT_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.output:
        output_path = args.output
    else:
        output_path = output_dir / "contact-sheet.html"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html, encoding="utf-8")

    print(f"Contact sheet written to: {output_path}")
    print(f"  Open in browser: file://{output_path}")


if __name__ == "__main__":
    main()
