# P2 — Corpus Engine: Two-Layer Renderer + Structural Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move corpus-grammar generation into the shipping engine (`src/engine/corpus/`, zero-dependency, browser-safe), close the structural-scale gap (canon-length serpentine runs, real multi-cell figures), render plans as two-layer SVG, and wire a Corpus mode into the studio.

**Architecture:** A build step bakes `corpus/grammar.json` + the 85 used tiles' parsed geometries into generated TS data modules under `src/engine/corpus/data/` (committed; drift-tested against the source artifacts). The P1 sampler, forms detection (trimmed), and scorer move INTO the engine as pure modules — `tools/grammar/` re-imports from the engine, never the reverse. New renderer: ground-mosaic layer + tile layer (transforms, role-based recolor, seam guard) → SVG string. Public API mirrors the existing engine (`generateBanner`, `reroll`, `variations`, `recolorPlan`) so `src/studio/` integrates as a mode beside the legacy generator. Curation ships as sample-until-quilt-pass (full MAP-Elites deferred — YAGNI until the gate says otherwise).

**Tech Stack:** TypeScript ESM; vitest; esbuild data-gen CLI (repo pattern); no new dependencies; engine stays DOM/fs-free.

## Global Constraints

- Branch: `feat/corpus-grammar-p2` off `feat/corpus-grammar-p1`. Local clone `~/fai-studio-dev`; push to origin. **No Co-Authored-By trailer on any commit.**
- `src/engine/corpus/**` MUST be zero-dependency and side-effect-free: no `node:*` imports, no `fs`, no `Date.now()`/`Math.random()` (mulberry32 only), no imports from `tools/**` (enforced by a test that greps the import graph).
- `tools/grammar/sample.ts`/`score.ts` become thin re-exports of the engine modules (single source of truth; their tests keep passing unchanged).
- Brand palette (exact 7): `#121212 #FFFFFF #F3F3F3 #D9D9D6 #FF4F00 #FFA300 #4997D0`. Renderer output may contain no other fill.
- Chevron law: the tile catalog contains no chevron primitives (verified P1 final review); the legacy `render/logo-guard.ts` continues to protect the legacy path; the corpus renderer adds an output assertion (test-level) that no two adjacent same-direction `angle`-family wedge pairs form a fast-forward read — conservative check, documented.
- Determinism: same (seed, knobs) → byte-identical SVG. Recolor NEVER re-rolls geometry.
- Corpus facts binding calibration (from grammar v2 stats): form sizes reach 15 with distribution `{2:97-ish scale, …, 15:+}` — read live from grammar data, do not hardcode; canonical serpents TURN CORNERS (direction changes mid-run).
- Existing studio/site build must stay green throughout (`npm run build`).

## Delegation Workflow

As P0/P1: **Codex** (gpt-5.5 xhigh; cd-to-repo + workspace-write/--full-auto; if the channel stalls twice, controller implements directly) for Tasks 1, 2, 3; **sonnet** for Tasks 0, 4, 6; **Claude only** for Tasks 5 and 7 (visual gates) and all aesthetic adjudications; **Gemini** independent audit after Task 4. Reviews per task; final whole-branch review (opus) before presenting.

## File Structure

```
tools/grammar/gen-engine-data.ts     # CLI: grammar.json + tile SVGs → generated data modules
src/engine/corpus/
  data/grammar.ts                    # GENERATED: const GRAMMAR (typed, no I/O)
  data/tiles.ts                      # GENERATED: 85 tiles' parsed recolorable geometries
  rng.ts                             # mulberry32 (moved)
  sample.ts                          # sampler (moved from tools/grammar, de-nodified)
  forms.ts                           # trimmed pure detectForms + orientEdges
  score.ts                           # rubric scorer (moved)
  render.ts                          # two-layer plan → SVG
  index.ts                           # generateBanner / reroll / variations / recolorPlan / describePlan
src/studio/corpus-mode.ts            # studio wiring (mode toggle, feed, knobs)
test/engine-corpus/*.test.ts         # purity, determinism, render, scale, API
```

---

### Task 0: Branch + data-generation build step

**Files:**
- Create: `tools/grammar/gen-engine-data.ts`; generated `src/engine/corpus/data/grammar.ts`, `src/engine/corpus/data/tiles.ts`
- Modify: `package.json` (script `"gen:engine-data": "esbuild tools/grammar/gen-engine-data.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-tools/gen-engine-data.mjs && node dist-tools/gen-engine-data.mjs"`)
- Test: `test/engine-corpus/data.test.ts`

**Interfaces:**
- `data/grammar.ts` exports `export const GRAMMAR: EngineGrammar` — structurally the P1 `Grammar` minus `builtAt`/`stats.economy` (trim what the engine doesn't consume: keep stats.adjacency, stats.groundSchemes.counts, stats.forms (incl. sizes + friezeRows), stats.plain.positions, stats.tiles, stats.tileRotations, stats.tileFlipShare, stats.inkByGround; templates; tileCatalog incl. profiles; palette). Type `EngineGrammar` declared in the generated file itself (self-contained).
- `data/tiles.ts` exports `export const TILES: Record<string, EngineTile>` where `EngineTile = { family: string; dominantDirection?: string; background: boolean; elements: TileElement[] }`, `TileElement = { kind: 'rect'|'circle'|'ellipse'|'path'; role: 'fg'|'cutout'; x?,y?,w?,h?,cx?,cy?,r?,rx?,ry?,d?; fillRule? }` — parsed via the mine pipeline (preprocess + parseSvgElements + background/cutout classification identical to `render-recon.ts`'s recolor rule), coordinates in the tile's native 200×200 space. Background element omitted (ground shows through); `role:'cutout'` = paints ground color.
- Generation is deterministic; both files carry a `// GENERATED by gen:engine-data — do not edit` header + a content hash of the source artifacts.
- Drift test: `data.test.ts` re-runs the generation logic's pure core against `corpus/grammar.json` + tile files and asserts the committed modules' hashes match (catches stale regeneration).

- [ ] **Step 1:** `git checkout -b feat/corpus-grammar-p2 && git push -u origin feat/corpus-grammar-p2`
- [ ] **Step 2:** Implement CLI + run `npm run gen:engine-data`; commit generated modules.
- [ ] **Step 3:** Drift test red→green; `npm test` green; tsc clean. Commit `engine: corpus data modules + generation step`.

---

### Task 1: Port sampler/forms/score into the engine  **[Delegate: Codex]**

**Files:**
- Create: `src/engine/corpus/rng.ts`, `sample.ts`, `forms.ts`, `score.ts` (moved/adapted); `test/engine-corpus/purity.test.ts`
- Modify: `tools/grammar/sample.ts`, `tools/grammar/score.ts` → thin re-exports (`export * from '../../src/engine/corpus/sample.js'` + the grammar-loading convenience wrappers tools' CLIs need); `tools/grammar/rng.ts` re-export.

**Interfaces:**
- Engine `samplePlan(grammar: EngineGrammar, seed: number, knobs?: SampleKnobs): BannerPlan` — `BannerPlan` = the BannerRecon shape, type declared in engine (`src/engine/corpus/types.ts`, structurally identical so tools' tests pass unchanged via re-export type aliasing).
- `forms.ts`: `detectForms(plan, tiles: Record<string, EngineTile>)` — adapted to consume `TILES` metadata instead of the Node manifest (edges come from GRAMMAR.tileCatalog; family from TILES). `orientEdges` moves here; `tools/mine/forms.ts` re-imports `orientEdges` from the engine to avoid duplication (tools may import src; never the reverse).
- Purity test: greps every file under `src/engine/corpus/` for `node:`, `require(`, `from '../../../tools`, `Math.random`, `Date.now` — all forbidden; and imports `sample.ts` in a bare context asserting no top-level throw.
- ALL existing tests must stay green UNCHANGED (137) — the re-export shims preserve tools' surfaces (grammar-loading helpers stay in tools).

- [ ] Steps: move, adapt imports, shim tools, purity test red→green, `npm test` 137+ green, tsc clean, commit `engine: corpus sampler/forms/scorer (zero-dep port; tools re-export)`.

---

### Task 2: Structural scale — serpentine runs + real figures  **[Delegate: Codex]**

**Files:**
- Modify: `src/engine/corpus/sample.ts`
- Test: `test/engine-corpus/scale.test.ts`

**Interfaces & binding behavior:**
- **Run length from the mined distribution:** target length drawn from `GRAMMAR.stats.forms.sizes` (weighted; sizes ≥2), not the current grow-1-3-steps. Growth continues while target unmet and continuity candidates exist.
- **Serpentine growth:** at each step, direction may TURN (draw next direction ∈ {continue, turn-cw, turn-ccw} weighted {0.6, 0.2, 0.2}); a turn requires the profile-join contract to hold on the NEW axis (placementsJoin dir='v' when turning from horizontal, etc.). Runs may wrap the grid only via actual adjacency (no torus).
- **Figures 2–6 cells:** `plannedFigureSize` draws from template `figureShare` range × 18, clamped [2,6]; region growth stays connected (existing flood logic).
- **Template gating:** serpentine bias applies to pipe-field/arc-mosaic (the connected-surface templates); repeat-rhythm/checker-motif keep short-run behavior (their canon is rhythm, not serpents).
- Diagnostics gain `longestRun` (cells); audit prints its mean/max.
- Tests: with grammar loaded, sampling 40 pipe-field seeds yields ≥25% of plans with `longestRun ≥ 6` and at least one plan `≥ 8` (calibration targets — from the canon's distribution tail); repeat-rhythm plans keep `longestRun ≤ 6`; determinism preserved; template feature-range tests still pass; audit gates still 5/5.

- [ ] Steps: TDD; recalibrate steering constants if template ranges break (never test tolerances); `npm run grammar:audit` 5/5; commit `engine: serpentine run growth + figures 2-6 (mined size distribution)`.

---

### Task 3: Two-layer renderer  **[Delegate: Codex]**

**Files:**
- Create: `src/engine/corpus/render.ts`
- Test: `test/engine-corpus/render.test.ts`

**Interfaces:**
```typescript
export interface RenderOptions { cellPx?: number /*=320*/; seamGuard?: boolean /*=true*/; nodeIds?: boolean /*=false*/ }
export function renderPlanSvg(plan: BannerPlan, tiles: Record<string, EngineTile>, opts?: RenderOptions): string;
```
- Layer 1: full-canvas ground rect + per-cell ground rects where ≠ global. Layer 2: per tile cell a `<g transform="translate(x y) scale(cellPx/200) [rotate/flip about center]">` carrying the tile's elements — `role:'fg'` filled `cell.ink`, `role:'cutout'` filled `cell.ground`. Transform composition MUST match the mask convention (flip-first-then-rotate: `translate(cx cy) rotate(θ) scale(sx 1) translate(-100 -100)` with sx=−1 on flip — mirror validate-sheet's canvas order exactly; prove by round-trip test below).
- Freeform cells: deterministic organic blob path (port the recon renderer's placeholder), ink-filled — placeholder until figures get real geometry (P3+ or hand-drawn library; documented).
- Seam guard: 0.6px stroke matching fill on tile elements (as legacy engine).
- Output: `<svg xmlns … width=1920 height=960 viewBox="0 0 1920 960">`, fills uppercase hex from the 7 only.
- **Round-trip test (the load-bearing one):** for 12 seeds, rasterize `renderPlanSvg(plan)` via the existing Node harness (test may use canvas — test code is not engine code) and compare per-cell against `renderRecon(plan, null, manifest)` canvas output: mean per-cell exact-pixel agreement ≥ 0.97 (they should be near-identical drawings of the same plan; this proves SVG transform composition matches the validated canvas convention).
- Plus: no non-brand fill in output (regex); determinism (same plan → identical string); recolor stability (recolorPlan then render: geometry substring unchanged apart from fill attrs).

- [ ] Steps: TDD (round-trip test first); commit `engine: two-layer corpus renderer (plan → SVG)`.

---

### Task 4: Engine public API + curation-lite

**Files:**
- Create: `src/engine/corpus/index.ts`, `src/engine/corpus/types.ts`
- Test: `test/engine-corpus/api.test.ts`

**Interfaces:**
```typescript
export interface CorpusConfig { seed?: number; template?: string; accent?: string; density?: number; figures?: boolean;
                                maxAttempts?: number /*=8: sample-until-quilt-pass*/ }
export interface CorpusResult { svg: string; plan: BannerPlan; scores: RubricScores; seed: number; attempts: number }
export function generateBanner(config?: CorpusConfig): CorpusResult;        // uses baked GRAMMAR/TILES
export function reroll(prev: CorpusResult): CorpusResult;                    // next seed, same knobs
export function variations(prev: CorpusResult, n: number): CorpusResult[];  // seed+1..seed+n, same knobs
export function recolorPlan(prev: CorpusResult, accent: string): CorpusResult; // re-zone accents ONLY, geometry frozen
export function describePlan(plan: BannerPlan): string;                     // human-readable one-liner
```
- `generateBanner` retries up to maxAttempts until `!scores.quiltFail` (deterministic: attempt i uses seed+i·1e6); returns best-scoring attempt if none pass (flagged in scores).
- `recolorPlan`: re-runs ONLY the accent-zoning + budget passes with a new accent on a deep-copied plan (cell geometry/tiles/rotations untouched — test asserts tile/rotation/flip identical).
- Gemini audit after commit: independent read of the API + 30-generation distribution/latency snapshot (generateBanner must run < 50ms/plan in Node — it's all pure math; report actual).

- [ ] Steps: TDD; `npm run build` still green (site bundles engine — confirm corpus module tree-shakes or adds acceptably; report bundle delta); commit `engine: corpus public API (generate/reroll/variations/recolor) + quilt-pass curation`.

---

### Task 5: Engine-output visual gate  **[Claude only]**

- [ ] Batch-render 30 mixed + 10 pipe-field CorpusResults via a small Node harness (reuse sheet montage code pointing at `renderPlanSvg` output rasterized by librsvg), sheets to `corpus/samples/engine-*`.
- [ ] CLAUDE reviews: (a) SVG output visually identical to P1's canvas recon (transform proof holds at full res); (b) serpentine scale visible — do pipe-field samples now carry ≥6-cell flowing passages?; (c) would-show rate vs P1's 50%. Record in GATE.md (iteration 2). Iterate Task 2/3 constants if regressed; exit at would-show ≥ 50% AND visible serpents in most pipe-field samples.

---

### Task 6: Studio Corpus mode

**Files:**
- Create: `src/studio/corpus-mode.ts`
- Modify: `src/studio/main.ts`, `index.html` (mode toggle), `src/studio/styles.css` (minimal)
- Test: `test/studio-corpus.test.ts` (jsdom wiring: mode switch renders corpus SVG into canvas container; spacebar reroll calls engine reroll; knobs map to CorpusConfig; export path receives the corpus SVG unchanged)

Behavior: a "Corpus" | "Classic" toggle (Corpus default); Corpus panel exposes template select (6 + auto), accent select (3 + auto), density slider, figures checkbox, seed display + copy; spacebar rerolls; variations tray + save tray + SVG/PNG export reuse existing studio plumbing (the corpus SVG feeds the same flatten/export pipeline). Scores line (conn/line/dens + quilt badge) under the canvas. Legacy mode untouched.

- [ ] Steps: TDD on wiring; `npm run dev` manual smoke by controller; `npm run build` green; commit `studio: Corpus mode (grammar-engine generation, default)`.

---

### Task 7: Studio visual gate + wrap  **[Claude only]**

- [ ] Controller drives the built studio (vite preview + screenshot or headless render), verifies Corpus mode end-to-end (generate/reroll/knobs/export), reviews exported SVG/PNG samples once more.
- [ ] Final whole-branch review (opus) with ledger carry-forwards; fix wave if needed.
- [ ] Update GATE.md (final), README (Corpus mode + engine API), `FAI Brand/AGENTS.md` pointer if wording changed, memory files; push; open PR for the phase chain; present sheets + studio to Chris.

## Self-review notes
- Spec coverage: §6 two-layer renderer (T3), §7 generation+knobs (T4), §8 curate-lite (T4; MAP-Elites deferred YAGNI), §9 studio (T6), P2-queue items: scale (T2), logo-guard note (constraints; render-level check in T3 tests), template-axis reconciliation folded into T2 calibration, forms re-validation covered by T2 tests re-running detectForms post-mutation.
- Types consistent: EngineGrammar/EngineTile (T0) → sample/forms/score (T1) → render (T3) → API (T4) → studio (T6).
- No placeholders; binding numbers stated or sourced from grammar data by name.
