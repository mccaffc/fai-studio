# P5 — Composition Criteria (Gates + Scores) + Core-Four Sizes

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** (1) Four composition criteria beyond canon-fidelity — focal dominance, asymmetric balance, negative-space clustering, rhythm quality — calibrated on the 50, wired as curation gates + displayed scores. (2) Grid generalization to the core four sizes (2×3, 3×3, 3×1, 1×6 + keep 1×3), each passing its own visual gate.

**Architecture:** A pure `composition.ts` metrics module (plan → four scores); calibration harness prints the 50's distributions; **Claude sets thresholds from those distributions** (the honest-rubric discipline — the canon must pass before anything gates). generateBanner's retry loop gains a soft-gate: prefer candidates passing all four, fall back to best-scoring. Grid generalization: COLS/ROWS become plan-level config (`arrangement`), position-keyed stats become relative (row-band/edge fractions), templates scale counts by cell area; per-size visual gates decide which arrangements ship enabled.

## Global Constraints
Branch `feat/corpus-grammar-p5` off p4. No Co-Authored-By. Engine purity. **Sonnet is the delegation floor — never haiku (workspace rule, 2026-07-02).** Determinism everywhere; same (seed, knobs, arrangement) → identical output. All 264 tests green except assertions explicitly extended. Calibration law: no criterion may gate until ≥90% of the 50 pass it at the chosen threshold (report per-criterion pass rates; Claude signs thresholds).

Arrangements (id → cols×rows): `banner` 6×3 (default) · `portrait` 2×3 · `square` 3×3 · `strip` 3×1 · `column` 1×6 · `column-short` 1×3. Canvas = cols·320 × rows·320.

## Delegation
Codex (xhigh): Tasks 0, 2. Sonnet: Tasks 1, 3. Claude: thresholds (Task 0 gate), per-size visual gates (Task 4), wrap (Task 5). Per-task reviews (sonnet floor); final opus review.

---

### Task 0: Composition metrics + calibration  **[Codex; Claude signs thresholds]**
Create src/engine/corpus/composition.ts + test/engine-corpus/composition.test.ts + tools/grammar/calibrate-composition.ts (CLI `grammar:calibrate`).

```typescript
export interface CompositionScores {
  focalDominance: number;   // largest form/figure visual area ÷ second-largest (∞-safe: cap 5; 0 when <2 forms — see calibration)
  balance: number;          // 1 − |ink-mass centroid offset|, penalized toward 0 for BOTH dead-center (<0.04 offset) and far-edge (>0.35); asymmetric sweet spot scores high
  negativeSpaceCluster: number; // quiet cells (plain + light-ground low-ink): share in the largest 1-2 connected clusters vs scattered
  rhythmQuality: number;    // repetition-with-variation entropy over (tile,rotation,flip) triples: peak between monotone (1 unique) and noise (all unique)
}
export function scoreComposition(plan: BannerPlan, tiles: Record<string, EngineTile>): CompositionScores;
```
Visual area: cells weighted by tile inkShare-like coverage (approximate from TILES elements? too heavy — use GRAMMAR.tileCatalog-adjacent: carry a per-tile coverage number in the baked data if absent; else cell-count area). Exact formulas are the implementer's craft BUT each must be: pure, deterministic, grid-size-agnostic (no 6×3 constants), and documented with the intent above.
Calibration CLI: score all 50 (corpus.json → plans via cells/forms as-is) + 200 sampled plans; print per-criterion distributions (p10/p50/p90) side by side. **STOP after calibration output — Claude reads it and supplies thresholds; the implementer then encodes them as `COMPOSITION_FLOORS` with a comment crediting the calibration.** Tests: metric unit tests on synthetic plans (a monotone plan scores low rhythm; an all-unique plan scores low rhythm; a dead-center-symmetric plan scores low balance; etc.), determinism, grid-agnostic (same plan logic on a synthetic 3×3).

### Task 1: Curation wiring + scores display  **[sonnet]**
index.ts: retry loop soft-gates on COMPOSITION_FLOORS (prefer all-pass candidates; best-effort fallback flagged in scores); CorpusResult.scores gains the four numbers; describePlan mentions failures. Studio scores line shows them compactly (dom/bal/neg/rhy). Tests: a floors-failing forced case falls back gracefully; display renders. All suites green; audit 5/5 (extend audit to print composition means).

### Task 2: Grid generalization  **[Codex]**
- types/config: `arrangement?: ArrangementId` on CorpusConfig + BannerPlan carries cols/rows (already has, hardcoded 6/3 — make real).
- sample.ts: kill COLS/ROWS constants → per-plan dims; plain.positions stats remapped to (colFrac, rowBand) relative weights; friezeRows → relative (bottom/top/middle band); region/serpent/patch/figure bounds already parametric — verify; template form counts scale by cellCount/18; ground-scheme generators grid-generic (verify checker/banded/zoned on 1×6 — banded-cols on a 1-wide column degenerates → fall back uniform; handle degenerate cases explicitly).
- render/score/forms/composition: verify grid-agnostic (forms/detect already take plan dims? forms iterates plan.cells with col/row — check its neighbor logic uses plan.cols not constant).
- programs/patches/figures: fit rules handle small grids (a 1×6 can host 1×1 figures and no 4×2 patches — natural).
- Tests: determinism per arrangement; every arrangement × 10 seeds → all cells resolved, palette law (program mode) holds, quilt-pass ≥ 60% per arrangement (report per-arrangement rates — the gate decides shipping); renderer emits correct canvas dims; composition metrics computed on all sizes.

### Task 3: Studio arrangement select + export  **[sonnet]**
Arrangement select (Banner default + the five others, labeled with dims); canvas container adapts aspect; export pipeline uses plan dims (check flatten/export hardcodes 1920×960 — fix to cols·320×rows·320); saved items carry arrangement. jsdom tests.

### Task 4: Per-size visual gates  **[Claude only]**
Sheets per arrangement (10 samples each, mixed templates + one program row). Judge each size separately: ships enabled / ships flagged-experimental / cut. Also re-gate 6×3 with composition floors live (expect median lift). GATE.md iteration 5 with per-size verdicts. Iterate constants where a size fails.

### Task 5: Final review + wrap  **[Claude]**
Opus whole-branch review → fixes → fast-forward PR #4 chain → README/memory → report.

## Self-review
Calibration law prevents dishonest gating (the quilt-test lesson, institutionalized); grid-agnostic metric requirement keeps criteria valid across Task 2's sizes; degenerate ground-scheme handling named; per-size gate = per-size shipping decision, not all-or-nothing.
