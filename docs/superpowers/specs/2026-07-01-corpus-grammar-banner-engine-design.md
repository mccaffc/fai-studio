# FAI Studio — Corpus-Grammar Banner Engine (Design)

**Date:** 2026-07-01
**Status:** Approved design; next step is an implementation plan.
**Repo:** `FAI/fai-studio` (deploys to https://mccaffc.github.io/fai-studio/)

## 1. Problem & diagnosis

FAI Studio generates decorative banners for the FAI brand. Three generation
paradigms have existed, none of which delivers the aesthetic FAI needs:

1. **Procedural engine (live in prod, `src/engine/`)** — a good *hand* (rich
   primitive/recipe library, deterministic, brand-safe) with no *brain*: it
   fills a grid cell-by-cell, so results read as a **quilt** of independent
   tiles. Weak line-work, no continuous figure-ground flow.
2. **Model-led (`ai-lab/`)** — a good *brain* (an LLM composes to a brief) with
   a crippled *hand* (a ~16-element JSON renderer). It optimizes for focal
   restraint + negative space, which produces **posters** (one hero icon in a
   void) — *not compelling decorative patterns.* Rejected as the ship path.
3. **Legacy Python (`FAI Brand/04-Illustrations/`, reference-only)** — tile +
   template + score; fill-every-cell → quilt; superseded.

**The canonical aesthetic** is defined by the 50 hand-made reference banners
(`FAI Brand/04-Illustrations/output/banners-clean/001–050.svg`) and, for *feel*
only, the 21 freestyle illustrations. First-hand study of all 50 yields the
grammar:

- **Signature move:** continuous line-work (concentric-arc "pipe" runs, parallel
  bands) that **flows across cells unbroken while the backing color changes
  square by square.** Continuity of a foreground pattern over a *shifting ground*.
- **Connectedness:** a few big forms span the surface so it reads as **one
  designed field**, not 18 tiles and not one hero in empty space.
- **Density:** full, edge-to-edge, rich repetition-with-variation. Never sparse.
- **Figure-ground:** a big organic curved form appears in a **minority** of
  pieces (optional, not forced).
- **Range:** purely decorative → evocative.
- **Palette:** disciplined — Cod Gray ground, Smoke White line-work, Timberwolf,
  one lead accent (International Orange default; Celestial Blue / Chrome Yellow
  with reason).

**Structural finding:** the banner SVGs are flattened (no groups/transforms/tile
IDs), but the geometry is legible: a full-canvas ground rect, then per-cell
`320×320` ground rects, then foreground paths — on a clean **6×3 grid of 320px
cells**, all on the 8px system (bands at 32px pitch, arcs at 32px steps).
Line-work is frequently a **figure-ground inversion** (ground-color paths over a
contrasting cell). The corpus *already is* a two-layer model, and because every
banner was assembled from the known 141-tile library, its grammar can be
**mined** by matching flattened geometry back to the tiles.

## 2. Scope

**In scope:** generating **decorative banner/pattern fields** (the 50-banner
aesthetic) — headers, deck/section backgrounds, social fields.

**Out of scope:** representational freestyle icons (bird, bulb, eye, sun); those
remain hand-made. The freestyle set is a reference for feel only.

## 3. Strategy (decided)

Build a **corpus-driven grammar** as the *core* (the "expand from the 50"
mandate, weighted heavy), rendered through a **two-layer, connection-first**
engine (the "hand"). Deterministic, static, no LLM in the shipped product. The
LLM art-director path is **deferred** (kept as an experiment, not on the ship
path).

The 50 canonical banners are treated as the ground truth: they are both the
**scoring rubric's calibration target** and the **seed corpus** for the grammar.

## 4. The rubric (definition of "compelling", made enforceable)

The scoring function and the definition of done are the same thing. Each metric
is computed on a rendered candidate; the 50 must score high and known quilts low.

- **Connectedness** — share of surface owned by forms spanning ≥2 cells; foreground
  edge-match rate across seams. Hard **quilt-test** reject if too many isolated
  single-cell tiles.
- **Line-work presence** — line/pipe fields present at hero weight in most outputs,
  with real run-length (≥3 cells).
- **Ground-mosaic independence** — count of ground changes occurring *beneath a
  continuous foreground* (the signature move).
- **Density** — active coverage within the corpus's measured range (not sparse,
  not a solid slab).
- **Figure-ground (optional)** — a big organic form present in a *minority* of
  outputs, matching corpus frequency (not forced every time).
- **Palette discipline** — core neutrals + one lead accent; adjacency and share
  match corpus stats. Chevron-law guard retained (`render/logo-guard.ts`).

## 5. The corpus grammar (core)

Two artifacts, both derived from the 50.

### 5a. Mining pass (offline, one-time)
A Node tool that reconstructs each banner into a structured grid by matching
flattened geometry against `shapes-clean/`:

- Segment each banner into its 18 cells (6×3 × 320px).
- Per cell, recover `{ tile, rotation, groundColor, role }` by matching the cell's
  path-set against the tile library (accounting for rotation and recolor).
- Detect multi-cell forms (runs, big figures) from cross-cell continuity.
- Emit `corpus.json`: a machine-readable description of all 50 banners.
- Emit a **validation contact sheet** re-rendering each reconstruction beside the
  original so the mapping's faithfulness is visually confirmed.

Hand-cataloging by eye becomes *validation*, not the primary method.

### 5b. Generative grammar (from `corpus.json`)
- **Composition templates** — the recurring whole-banner skeletons actually
  present (e.g. horizontal pipe-run field; figure-anchored + frieze base;
  checker-ground with continuous arcs; mirrored halves). Sampled, not invented.
- **Runs & motifs** — multi-cell building blocks (arc-pipe run of length *n*;
  band field; half-disc frieze; organic curve over a 2×2), each with an
  **edge-matching contract** so it tiles seamlessly.
- **Ground-mosaic schemes** — how the ground layer varies beneath (checker,
  block-gradient, warm/cool zoned, single ground) — an *independent* layer.
- **Adjacency & palette transition tables** — real corpus statistics for what
  follows what and which colors sit together.

Generation = pick template → populate with runs/motifs honoring edge-matching →
lay a ground-mosaic scheme underneath → apply palette per corpus stats.

## 6. Two-layer connection-first renderer (the hand)

- **Ground layer** (mosaic of per-cell/region color blocks) renders first;
  **pattern layer** (foreground forms) renders on top, resolved *independently* of
  the ground.
- **Edge-matching contracts** let a run stride seamlessly across neighbors
  regardless of their ground (Wang-tile style) — the mechanism behind
  "lines across shifting backing fields."
- **Figure-ground inversion is first-class:** a pattern element may be painted in
  the ground color over a contrasting cell. Color is resolved by *role per layer*,
  never baked per shape.
- **Reuse + extend the existing engine:** the 44 primitives + superforms become
  the motif vocabulary, augmented by mined runs. Keep `logo-guard`, flatten, and
  SVG/PNG export. Seed → SVG stays deterministic; recolor never re-rolls geometry.

## 7. Generation loop

`generate(seed, config)` samples a template from the corpus distribution, places
runs/motifs under edge contracts, assigns a ground-mosaic scheme, resolves palette
per corpus stats, and renders the two layers. A small set of **corpus-bounded
knobs** (density, lead accent, figure on/off, symmetry, line-vs-shape emphasis)
lives in `tuning.ts` — numbers, not logic. `reroll`/`variations` yield a family.

## 8. Curation & verification (generate-many → rank-few)

- Generate N candidates, score against the §4 rubric, drop quilt-test and
  brand-gate failures, surface the top few.
- **Calibration:** the 50 must score high, known quilts low — the honesty check on
  the rubric (reusing the project's existing calibration discipline).
- **Optional MAP-Elites archive** — bin by density × line/shape × figure × palette,
  keep best per bin, so the studio surfaces variety, not near-dupes.
- **Paper-verified loop + Harmony FAI gates** (palette, chevron, 8px grid) on the
  curated picks, per house design process.

## 9. Studio UX & shipping

- Stays the **static client-side studio on the existing GitHub Pages deploy**;
  `corpus.json` + grammar ship as static data. **No backend, no key.**
- **Creative-director / curator model:** live canvas (spacebar reroll), a curated
  feed of pre-scored strong candidates, variations tray, in-place recolor,
  print-safe SVG/PNG/clipboard export.
- **`ai-lab` retired from the shipping path** (kept as an experiment); old Python
  stays reference-only.
- **"Shipped" =** the studio produces banners that pass the rubric and that Chris
  will drop into real FAI materials without touch-up.

## 10. Module boundaries (design for isolation)

Each is independently testable, communicates through a defined interface:

- **mine** (offline Node) — banners + tiles → `corpus.json` + validation sheet.
- **grammar** — `corpus.json` → templates, runs/motifs (with edge contracts),
  ground schemes, palette tables + a sampler.
- **engine/render** — grammar selection → two-layer SVG. Zero-dependency, no DOM/fs
  (browser/Node/Worker), matching the current engine's contract.
- **score** — rendered candidate → rubric metrics + pass/fail.
- **studio** — UI over generate/score/export.

## 11. Testing

- Determinism: same seed → identical SVG.
- Edge-matching: runs connect across seams (geometric assertion on emitted paths).
- Color-mode isolation and logo-guard (retain existing tests).
- Rubric calibration: the 50 score above threshold; a fixture set of quilts scores
  below.
- Mining fidelity: reconstruction diff against originals within tolerance.

Heavy build/test in a **local clone**, pushed back via the Store git hub — not on
the Store mount.

## 12. Phasing

- **P0 — Mine:** corpus-mining tool → `corpus.json` for all 50 + validation sheet.
- **P1 — Grammar:** templates, runs/motifs w/ edge contracts, ground schemes,
  palette tables from `corpus.json`.
- **P2 — Renderer:** two-layer connection-first renderer + `generate()` rewrite;
  determinism + edge-matching tests.
- **P3 — Score & curate:** rubric scoring + quilt-test + calibration against the 50.
- **P4 — Studio:** wire curated feed, variations, recolor, export; Paper spot-check
  + brand gates.
- **P5 — Ship:** deploy, update `AGENTS.md`/README/memory, retire `ai-lab` from the
  prod path.

## 13. Risks

- **Mining fidelity** — flattened geometry may not match tiles cleanly for every
  cell; mitigation: tolerance + visual validation sheet + hand-correction of
  stragglers. It is acceptable for mining to recover *most* cells and hand-label
  the rest.
- **Edge-matching seams** — sub-pixel gaps at seams; mitigation: the existing seam
  guard + explicit edge contracts + geometric tests.
- **Rubric honesty** — a metric that the 50 fail would be wrong; calibration gate
  catches this before it drives generation.
- **Variety collapse** — recombination could feel repetitive; mitigation: MAP-Elites
  coverage + enough templates/runs mined from the corpus.

## 14. Non-goals

- No representational icon generation.
- No live LLM in the shipped product (deferred).
- No new deploy target; reuse GitHub Pages.
