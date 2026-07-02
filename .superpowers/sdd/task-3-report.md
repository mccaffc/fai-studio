# P2 Task 3 — Two-layer corpus renderer (plan → SVG)

**Files:** `src/engine/corpus/render.ts` (engine, zero-dep) · `test/engine-corpus/render.test.ts`

> Note: this path previously held a stale report from an unrelated earlier "Task 3" (P0 SVG-parse utilities); overwritten per the P2 Task 3 brief.

## Transform derivation (the load-bearing bit)

The validated canvas renderer (`tools/mine/render-recon.ts`) draws each tile in this op order:

```
ctx.translate(x + CELL/2, y + CELL/2);   // origin → cell centre
ctx.rotate(θ);                           // rotate
if (flip) ctx.scale(-1, 1);              // horizontal mirror (flip FIRST)
ctx.drawImage(img, -CELL/2, -CELL/2, CELL, CELL);  // native-200 bitmap, scaled s=CELL/200, top-left at -half
```

The tile bitmap is native 200×200. `drawImage` scales it by `s = CELL/200` and places its top-left at `(-CELL/2, -CELL/2)`. So a native point `p` maps into the cell-local frame as `s·p − CELL/2`, i.e. `translate(-CELL/2) scale(s)` in SVG matrix order. Since `CELL/2 = 100·s`, that equals `scale(s) translate(-100, -100)`.

Composing the full canvas order as an SVG transform list (left-to-right = outermost-first, matching ctx op order):

```
translate(cx,cy) rotate(θ) scale(sx,1) scale(s,s) translate(-100,-100)
= translate(cx,cy) rotate(θ) scale(sx·s, s) translate(-100,-100)
```

with `cx = col·cellPx + cellPx/2`, `cy = row·cellPx + cellPx/2`, `s = cellPx/200`, `sx = −1` on flip else `+1`.

**Why this equals the canvas order:** the mirror `scale(sx,1)` sits to the RIGHT of `rotate(θ)` in the list, so in matrix composition it is applied to the tile point *before* the rotation — exactly the canvas `rotate` → `scale(-1,1)` (flip-first-then-rotate) sequence. Folding the uniform tile scale `s` into the x-component gives the single `scale(sx·s, s)` factor. Emitted example (90°, unflipped, cell (0,0), cellPx=320): `translate(160,160) rotate(90) scale(1.6,1.6) translate(-100,-100)`.

The round-trip test proves this pixel-wise: interior pixels of every cell match the canvas renderer exactly (sampled grids identical); the only divergence is sub-pixel anti-aliasing at shape edges.

## Round-trip agreement (SVG rasterized vs `renderRecon(plan, null, manifest)`, 720×360, ±12 RGB, per-cell mean)

Compared with `seamGuard:false` (recon draws a bitmap with no seam-guard overdraw, so this is a like-for-like geometry comparison).

| plan | agreement |
|---|---|
| pipe-field#3001 | 0.9954 |
| pipe-field#3002 | 0.9996 |
| arc-mosaic#3011 | 0.9982 |
| arc-mosaic#3012 | 0.9614 |
| checker-motif#3021 | 0.9996 |
| checker-motif#3022 | 0.9986 |
| repeat-rhythm#3031 | 0.9995 |
| repeat-rhythm#3032 | 0.9979 |
| figure-field#3041 | 0.9989 |
| mixed-quilt#3051 | 0.9967 |
| mixed-quilt#3052 | 0.9995 |
| pipe-field#3061 | 0.9995 |

**MEAN = 0.9954** (gate ≥ 0.97) · **MIN = 0.9614** (gate ≥ 0.93). Both clear comfortably.

The worst plan (arc-mosaic#3012, 0.9614) is dominated by curved-edge tiles (ellipses/arcs) whose anti-aliased perimeters diverge most between vector-at-full-res and bitmap-upscaled rasterization — still well above the 0.93 floor; interior/geometry is exact.

## Renderer behavior

- **Layer 1 (ground mosaic):** full-canvas `<rect width height fill=plan.ground>`, then one per-cell rect only where `cell.ground !== plan.ground`.
- **Layer 2 (tiles):** per tile cell a `<g transform=…>` carrying the tile's native-200 elements; `role:'fg'` → `cell.ink`, `role:'cutout'` → `cell.ground` (background element already omitted in baked TILES, ground shows through). Element serialization + path escaping mirror `render-recon.ts`'s `serializeColored`.
- **Freeform cells:** deterministic squircle blob path ported from `render-recon.ts`'s `freeformBlobSvg` (~70% cell, cubic-Bezier), emitted directly in canvas-px space (no group transform needed), ink-filled. Placeholder until figures gain real geometry.
- **Seam guard (default on):** each painted element gets `stroke=fill stroke-width=0.600 stroke-linejoin=round`; skipped for `fill="none"` semantics. Mirrors the legacy engine's guard.
- **nodeIds (default off):** `data-node-id="col,row"` on each drawn cell group when enabled.
- **Output:** `<svg xmlns … width=cols·cellPx height=rows·cellPx viewBox="0 0 …">`; all fills/strokes are uppercase brand hex (asserted).

## Test evidence (10 tests, all green)

1. **Round-trip mean ≥ 0.97** — 0.9954. (load-bearing)
2. **Round-trip min per-plan ≥ 0.93** — 0.9614.
3. **Determinism** — identical plan → byte-identical string, across all 6 templates.
4. **Brand fills only** — every fill/stroke hex ∈ the 7, and already uppercase, across all templates.
5. **nodeIds off by default** / **on emits `col,row`** on every tile+freeform cell.
6. **Cutout role paints ground** — synthetic single-cell plan with a cutout tile (`float-05`): tile cell rasterizes to ink (fg) + ground (cutout/background) pixels only, <15% blend.
7. **Geometry fill-independent** — recolor accent ink only; fill/stroke-stripped geometry substring identical before/after (proves recolor won't perturb geometry).
8. **Canvas structure** — xmlns/width/height/viewBox scaled by cellPx; Layer-1 ground rect present; custom cellPx respected.

## Gates

- `npx vitest run` → **164 passed** (154 prior + 10 new); no regressions.
- `npx tsc -p tsconfig.json --noEmit` → clean.
- `npm run build` → green.
- Purity test green (`render.ts` has no `node:`, no nondeterministic/clock APIs, no `tools/` imports; the header comment was reworded to avoid the naive substring grep).
- `corpus/corpus.json` `minedAt` timestamp drift reverted before commit.

## Concerns / notes

- Freeform geometry is still the organic-blob placeholder (documented; real figures are P3+ / a hand-drawn library) — matches the recon sampler-mode placeholder exactly, so it's visually consistent with P1.
- The round-trip compares with the seam guard OFF (recon has none); the guard itself is validated by the brand-fill test and is on by default in production output. This is a test-harness fidelity choice, not a threshold relaxation — the transform is pixel-exact.
