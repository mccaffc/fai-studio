#!/usr/bin/env python3
"""
build_dominant_direction.py — add `dominant_direction` to tiles-manifest-v2.json.

The supplement (FAI-Composition-Logic-Supplement.md) requires every tile to
carry a `dominant_direction` describing the direction the shape's visual energy
pushes toward:

    left / right / up / down   asymmetric, implies movement along one axis
    center                     centripetal (concentrated toward the middle)
    outward                    centrifugal (radiates toward the edges)
    neutral                    no directional bias (solid / perfectly balanced)

We compute it from a combination of:
  * `edge_coverage`  (per-edge fraction already in the manifest), and
  * a fresh raster pass measuring the foreground centroid + radial spread.

All existing fields are preserved; only `dominant_direction` is added (and a
`fg_centroid` / `raster_fill` diagnostic pair, which the generator's calibrated
visual weight also uses). Tiles that fail to render or contain no foreground are
flagged into a `quarantine` list and given dominant_direction "neutral" plus a
`"renderable": false` marker so the generator can exclude them.

Run (from the project root):
    DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib:/opt/homebrew/opt/cairo/lib \
      $HOME/.cache/fai-deck-venv/bin/python scripts/build_dominant_direction.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from svg_raster import analyse_foreground  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
MANIFEST = BASE / "tiles-manifest-v2.json"
TILES_DIR = BASE / "output" / "shapes-clean"

# Classification thresholds (centroid offsets are about the tile centre, 0.5).
OFFSET_STRONG = 0.12      # centroid this far off-centre => directional
EDGE_DOMINANCE = 0.45     # one edge this much more covered than its opposite
CENTER_SPREAD = 0.13      # low radial spread + central centroid => "center"
OUTWARD_SPREAD = 0.20     # high radial spread on a symmetric tile => "outward"
SYMMETRIC = {"both", "rotational"}


def read_bg(svg_path: Path) -> str:
    txt = svg_path.read_text()
    m = re.search(r'<rect[^>]*fill="(#[0-9A-Fa-f]{6})"', txt)
    return (m.group(1) if m else "#F3F3F3").upper()


def classify(tile: dict, geo: dict) -> str:
    """Map raster geometry + edge coverage to one of the seven directions.

    Signal model (in priority order):

      1. center / outward  — a tile whose mass sits near the tile centre on
         BOTH axes is non-directional. We split it by where that mass lives
         radially: concentrated toward the middle => "center"; pushed out to
         the rim => "outward". `neutral` is reserved for balanced shapes with
         no radial story (near-solid fills, even stripe fields).

      2. left / right / up / down — the centroid offset is the primary tell.
         Edge-coverage asymmetry only *reinforces* the same axis (it never
         flips the axis the centroid chose), which prevents a saturated single
         edge from overriding a clearly off-centre centre of mass.
    """
    cov = tile.get("edge_coverage", {})
    centroid = geo.get("centroid")
    if not centroid or geo.get("n_fg", 0) == 0:
        return "neutral"

    cx, cy = centroid
    dx = cx - 0.5  # + => right
    dy = cy - 0.5  # + => down

    # Edge-coverage asymmetry (+ => pushes toward right / bottom).
    h_edge = cov.get("right", 0.0) - cov.get("left", 0.0)
    v_edge = cov.get("bottom", 0.0) - cov.get("top", 0.0)

    mean_r = geo.get("mean_radius", 0.0)   # avg foreground distance from centre
    std_r = geo.get("std_radius", 0.0)     # spread of that distance
    edge_cov_sum = sum(cov.get(k, 0.0) for k in ("top", "right", "bottom", "left"))

    central = abs(dx) < OFFSET_STRONG and abs(dy) < OFFSET_STRONG

    # --- 1. center / outward / neutral for centred tiles ------------------
    if central:
        # A radiating / rim-heavy shape (touches several edges, mass far from
        # centre) reads outward. A concentrated core reads center. Otherwise
        # it is a balanced, non-radial field => neutral.
        touches_many_edges = sum(1 for k in ("top", "right", "bottom", "left") if cov.get(k, 0.0) > 0.5) >= 3
        if mean_r >= 0.33 and (touches_many_edges or std_r >= CENTER_SPREAD):
            return "outward"
        if mean_r <= 0.26 and std_r <= CENTER_SPREAD:
            return "center"
        # Strongly multi-edge but mid-radius: still radial energy => outward.
        if edge_cov_sum >= 2.4:
            return "outward"
        return "neutral"

    # --- 2. directional ----------------------------------------------------
    # Reinforce the chosen axis with same-sign edge asymmetry (capped small).
    h_score = abs(dx) + 0.20 * max(0.0, (h_edge if dx >= 0 else -h_edge))
    v_score = abs(dy) + 0.20 * max(0.0, (v_edge if dy >= 0 else -v_edge))

    if h_score >= v_score:
        return "right" if dx > 0 else "left"
    return "down" if dy > 0 else "up"


def main() -> int:
    manifest = json.loads(MANIFEST.read_text())
    tiles = manifest["tiles"]

    from collections import Counter

    counts: Counter = Counter()
    quarantine: list[dict] = []

    for tile in tiles:
        svg_path = TILES_DIR / tile["filename"]
        renderable = True
        note = None
        geo = {"centroid": None, "n_fg": 0}

        if not svg_path.exists():
            renderable = False
            note = "file missing in output/shapes-clean"
        else:
            try:
                bg = read_bg(svg_path)
                geo = analyse_foreground(str(svg_path), bg, n=96)
            except Exception as exc:  # pragma: no cover - defensive
                renderable = False
                note = f"raster failed: {exc}"

        if renderable and geo.get("n_fg", 0) == 0:
            renderable = False
            note = "empty foreground (no shape rendered)"

        if not renderable:
            tile["dominant_direction"] = "neutral"
            tile["renderable"] = False
            tile["quarantine_reason"] = note
            quarantine.append({"id": tile["id"], "filename": tile["filename"], "reason": note})
            continue

        direction = classify(tile, geo)
        tile["dominant_direction"] = direction
        tile["renderable"] = True
        tile["raster_fill"] = geo["fill_fraction"]
        if geo.get("centroid"):
            tile["fg_centroid"] = list(geo["centroid"])
        tile.pop("quarantine_reason", None)
        counts[direction] += 1

    manifest["direction_distribution"] = dict(counts)
    manifest["quarantine"] = quarantine
    manifest["dominant_direction_method"] = (
        "centroid(0.7)+edge_coverage(0.3) axis pull; symmetric+central tiles "
        "split into center/outward by mean foreground radius"
    )
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")

    print("dominant_direction distribution:")
    for k, v in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {k:>8}: {v}")
    print(f"quarantined: {len(quarantine)}")
    for q in quarantine:
        print(f"  - {q['id']} ({q['filename']}): {q['reason']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
