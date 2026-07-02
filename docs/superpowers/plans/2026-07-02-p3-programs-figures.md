# P3 — Program Palettes + Corpus Figure Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Program-specific banners — neutrals-only (Cod Gray/Smoke White/Timberwolf) + exactly one program hue — selectable in engine + studio; (2) replace freeform placeholder blobs with real figures extracted from the corpus; (3) pay down the tracked P3 debt (bundle split, type consolidation, shared detectForms core, corpus save-tray).

**Architecture:** Program mode is a **deterministic post-sampling palette transform** (`applyProgramPalette(plan, hue)`): geometry frozen, all accent inks/grounds → the program hue, `#FFFFFF` → `#F3F3F3`, `#FF4F00` eliminated, contrast-guarded. The figure library is mined from the corpus (freeform forms' original vector geometry, normalized per-region) into a generated data module; the sampler assigns a figure asset to each freeform region and the renderer places it recolored — blobs remain only as final fallback.

**Tech Stack:** unchanged (TS ESM, vitest, esbuild CLIs, zero-dep engine).

## Global Constraints

- Branch `feat/corpus-grammar-p3` off `feat/corpus-grammar-p2`. **No Co-Authored-By trailer.** Engine purity rules unchanged.
- **Program registry (LOCKED brand values — exact):** Technology & Statecraft `#FFA300` · American Governance `#8265DB` · Artificial Intelligence `#D63A8C` · Energy & Infrastructure `#268B41` · Science & Innovation `#4997D0` · Frontier Legal Defense `#3A4A6B`.
- **Program-banner palette law:** fills ⊆ {`#121212`, `#F3F3F3`, `#D9D9D6`, programHue}. No `#FFFFFF`, no `#FF4F00`, no second accent. The renderer brand-fill test extends to: the 7 master fills OR (program mode) the 3 neutrals + the config's hue — nothing else, ever.
- Contrast guard: programHue as INK requires ground ∈ {#121212, #F3F3F3, #D9D9D6} with WCAG-ish ratio ≥ 1.7 (reuse the engine's existing contrast helper if present; else implement lum-ratio); dark hues (Frontier Indigo) must not land on Cod Gray grounds — remap that cell's ground to Smoke White (deterministic rule, not rng).
- recolorPlan/rezone semantics extend to program hues (geometry frozen).
- Figure library: assets extracted ONLY from corpus freeform cells (provenance recorded: banner/form id); library data module generated + drift-tested like tiles; total data budget ≤ 250KB source — curate count to fit (Claude picks which figures make the cut — aesthetic judgment).
- Chevron law untouched. Classic mode untouched. All existing tests stay green except assertions this plan explicitly extends (renderer brand regex, blob-specific tests).

## Delegation Workflow

Codex (credits restored — gpt-5.5 xhigh, proven invocation) for Tasks 2, 3; sonnet for Tasks 0, 1, 5; **Claude only**: figure curation (Task 2 step: which figures ship), all visual gates (Task 4), adjudications. Gemini: post-Task-3 independent audit. Per-task reviews; final opus whole-branch review.

## File Structure

```
src/engine/corpus/programs.ts        # registry + applyProgramPalette + contrast guard
src/engine/corpus/data/figures.ts    # GENERATED figure library
tools/grammar/gen-figures.ts         # extraction CLI (corpus freeform forms → assets)
tools/grammar/gen-engine-data.ts     # extended: emits figures.ts too (or gen-figures separate — implementer's call, drift-tested either way)
src/studio/corpus-mode.ts            # program select
test/engine-corpus/programs.test.ts  # palette law, contrast, determinism, recolor interplay
test/engine-corpus/figures.test.ts   # library integrity, placement, render
```

---

### Task 0: Program palette engine  **[sonnet]**

**Files:** create src/engine/corpus/programs.ts + test/engine-corpus/programs.test.ts; modify types.ts (CorpusConfig.program?: ProgramId), index.ts (thread through generateBanner/reroll/variations/recolorPlan/describePlan), render.test.ts brand regex extension.

**Interfaces:**
```typescript
export type ProgramId = 'technology-statecraft' | 'american-governance' | 'artificial-intelligence'
                      | 'energy-infrastructure' | 'science-innovation' | 'frontier-legal-defense';
export const PROGRAMS: Record<ProgramId, { name: string; hue: string }>;
export function applyProgramPalette(plan: BannerPlan, hue: string): BannerPlan; // pure, deep-copies
```
Transform rules (deterministic, in order): (1) global+cell grounds: #FFFFFF→#F3F3F3, #FF4F00→hue-as-ground only if it was an accent ground zone else #F3F3F3; other accents-as-ground → hue; (2) inks: any accent (#FF4F00/#4997D0/#FFA300) → hue; #FFFFFF → #F3F3F3; (3) contrast pass per cell: if ink===ground → ink flips to the neutral maximizing contrast; if hue-on-#121212 fails the 1.7 floor (compute per hue) → cell ground → #F3F3F3; (4) never introduces #FFFFFF/#FF4F00. generateBanner applies it AFTER scoring? NO — scores must reflect the shipped plan: apply BEFORE scorePlan (accentShare then counts hue cells — verify scorer's accent set: it uses NEUTRAL_INKS complement, so hue counts as accent — good). describePlan appends `· program <name>`.

**Tests:** palette-law regex over rendered SVG for all 6 programs × 4 seeds (only 3 neutrals + hue); Frontier Indigo case: no indigo-ink-on-codgray cell; determinism; recolorPlan(prev, otherHue) under program mode swaps hue only; quilt/curation unaffected (scores computed post-transform); config echo carries program.

---

### Task 1: Studio program select  **[sonnet]**

Corpus panel gains "Program" select (None + 6, names not hexes; swatch dot via CSS). Selecting a program disables the accent select (single-hue law) and regenerates; None restores. Persisted with the rest of config. jsdom tests: select renders 7 options; choosing one produces svg with the hue + no #FF4F00; accent select disabled state.

---

### Task 2: Figure library extraction  **[Codex + Claude curation]**

**Files:** tools/grammar/gen-figures.ts (+ npm script `gen:figures`), generated src/engine/corpus/data/figures.ts, test/engine-corpus/figures.test.ts (integrity part).

Extraction: for every corpus banner form of kind 'figure' AND every freeform cell-group (connected freeform cells, even if ungrouped): capture those cells' ORIGINAL foreground elements (mine pipeline: preprocess→parse→segment on corpus/reference/banners), crop to the region's bounding box in cell units (w×h cells), normalize coordinates to a `viewBox 0 0 (w*200) (h*200)` space, classify roles by the region's dominant ink (fg) vs ground-colored (cutout) — same recolor semantics as tiles. Emit:
```typescript
export interface FigureAsset { id: string; source: string /*'043/form-1'*/; w: number; h: number /*cells*/;
                               elements: TileElement[]; inkShare: number }
export const FIGURES: FigureAsset[];
```
Dedupe near-identical assets (mask IoU ≥ 0.95 at 64px — reuse mine rasterization). Print a contact sheet (`corpus/samples/figures-sheet.png`) of ALL candidates rendered standalone. **Claude curation step (mine):** review the sheet, pick the ships (target 15–25, ≤250KB), record picks + rationale in the report; regenerate with a curated id whitelist embedded in the CLI (committed).

**Integrity tests:** every asset renders (elements non-empty, coordinates within viewBox), ids unique, provenance non-empty, data size ≤ 250KB.

---

### Task 3: Figure placement + render  **[Codex]**

**Files:** modify src/engine/corpus/sample.ts (figure regions get `figureId` — drawn from FIGURES weighted by fit: asset w×h must fit the region's bounding box, prefer exact shape match, deterministic), types.ts (CellPlan.figureId?: string on the region's anchor cell + region extent), render.ts (place the asset: one `<g>` spanning the region, elements recolored fg→region ink / cutout→region ground; blob fallback ONLY when no asset fits), score/forms untouched (figure regions unchanged structurally).

**Tests:** determinism; a figure-field seed places ≥1 FIGURES asset (assert figureId set + asset group in svg); recolor/program transforms recolor figure elements too; fallback path still works when FIGURES filtered to empty (test with injected empty library via an exported hook or parameter — no module mocking hacks; make the library a parameter with default).

Post-commit: **Gemini independent audit** — 40 plans across templates: distribution drift vs P2 baseline (figures shouldn't perturb non-figure templates), program-mode palette-law sweep (6 hues × 20 seeds, zero violations), latency still <5ms.

---

### Task 4: Visual gates  **[Claude only]**

Sheets: (a) figure-field × 10 with real figures; (b) program sweep — one sheet per 3 programs × mixed templates; (c) pipe-field regression sheet (unchanged expectation). Judge: figures read as canon-family (the corpus's own figures recolored — they should); program banners read as disciplined neutrals+hue (the FLD-indigo case especially); no regression in pattern quality. Record iteration 3 in GATE.md; exit at would-show ≥60% overall AND program sheets pass the palette read. Iterate constants if not.

---

### Task 5: Debt paydown  **[sonnet]**

(1) Dynamic-import split: `main.ts` lazy-loads corpus-mode (`await import`) so Classic visitors don't pay the ~56KB gzip data cost; loading state in the canvas while it resolves; verify Vite chunking (report chunk sizes). (2) EngineGrammar/TileEdgeProfiles type consolidation (single declaration, generated files import — wait, generated must stay self-contained: instead generated files remain the source and hand-written types.ts re-exports THEIR types; kill the `as unknown as` casts). (3) detectForms shared core (parameterized edge-accessor; engine + tools variants call it). (4) Corpus save-tray: SavedItem kind 'corpus' storing {config, seed}; regenerate-on-open (deterministic — tiny storage); tray visible in corpus mode. Tests for each; all suites green.

---

### Task 6: Final review + wrap  **[Claude]**

Final opus whole-branch review (ledger carry-forwards attached) → fix wave if needed → GATE.md final → README/memory updates → push → PR (stacked on #4 or updated if #4 merged by then) → present sheets to Chris.

## Self-review notes
- Program palette law is enforced at THREE layers: transform rules, contrast pass, extended render regex test — belt/braces/gate.
- Figure provenance keeps the "expand from the 50" doctrine — no synthesized figures.
- Scores post-transform keeps curation honest under program mode.
- Types consistent: ProgramId/FigureAsset defined once; CellPlan extension named.
