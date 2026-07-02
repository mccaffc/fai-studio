# P1 — Corpus Grammar + Sampler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distill `corpus/corpus.json` into a versioned generative grammar (`corpus/grammar.json`) and a seeded sampler that emits `BannerRecon`-shaped banner plans, rendered and verified against the corpus rubric.

**Architecture:** Three layers, all offline tooling for now (engine integration is P2/P4): **stats** (corpus → measured tables: family/tile frequencies, directional adjacency, ground-mosaic schemes, palette transitions, form specs), **templates** (per-banner feature vectors → clustered composition templates, human-named), **sampler** (seeded: template → ground mosaic → forms/runs honoring edge contracts → fill → palette → BannerRecon). Verification reuses the P0 reconstruction renderer (a sampled plan renders exactly like a mined banner) plus statistical calibration tests and Claude's visual gate.

**Tech Stack:** TypeScript ESM, vitest, esbuild bundle-then-node CLIs (established repo pattern), node-canvas/librsvg render (existing). No new dependencies.

## Global Constraints

- Branch: `feat/corpus-grammar-p1`, local clone `~/fai-studio-dev`. Heavy work local, never on the Store mount.
- **No `Co-Authored-By` trailer on any commit.**
- `src/engine/` untouched (P2 integrates). All P1 code in `tools/grammar/` (+ shared edits to `tools/mine/schema.ts` only where stated).
- Brand palette (exact): Cod Gray `#121212`, White `#FFFFFF`, Smoke White `#F3F3F3`, Timberwolf `#D9D9D6`, International Orange `#FF4F00`, Chrome Yellow `#FFA300`, Celestial Blue `#4997D0`. Grammar tables may only ever contain these.
- Never draw or recreate the FAI double-chevron logomark; sampler must call the existing `violatesLogomark` guard concept — P1 plans place tiles, so port the guard check to plan-level (tri/chevron adjacency) before render.
- Determinism: same seed → identical plan (mulberry32, as in `src/engine/rng.ts` — copy the 8-line function into tools/grammar/rng.ts; do not import across the src/tools boundary).
- Corpus facts to honor (measured 2026-07-02, the calibration targets):
  - distinct tiles/banner: mean 3.9 (economy of means)
  - dominant-family share: mean 0.67
  - family lead order: lines > circle > curve > wave
  - ink distribution: #121212 491 · #F3F3F3 116 · #FF4F00 77 · #4997D0 64 · #FFA300 53 · #D9D9D6 45
  - global grounds: #F3F3F3 37 · #D9D9D6 5 · #121212 4 · #FFFFFF 3 · #FF4F00 1
  - plain cells: 29/50 banners have zero; row distribution 39/39/18
  - forms per banner: avg 2.60 (58 frieze / 60 run / 12 figure; sizes mostly 2, tail to 8)
- P0 carry-forwards that bind P1 (from the final review):
  - `ink` attribution rests on loose H/V path-bbox pairing — Task 1 spot-verifies before palette tables are trusted.
  - Rotation stats: use rotations exactly as recorded in cells (for symmetric tiles the label is canonical-biased but the masks are identical — document, don't correct).
  - Freeform cells are **labeled figures**, not failures — they enter templates as figure features.
  - Consolidate the three ManifestTile copies into `tools/mine/schema.ts` (Task 0).

## Delegation Workflow

Same as P0: **Codex** (gpt-5.5 xhigh; cd-to-repo + workspace-write sandbox, never dangerous auto-approve) for the self-contained algorithmic tasks (Tasks 1, 4); **sonnet subagents** for mid-tier implementation (Tasks 3, 5, 6); **Claude only** for template induction naming (Task 2 step 4), all visual gates (Task 7), and every aesthetic adjudication. **Gemini** independent review after Task 4 (sampler correctness + distribution sanity).

## File Structure

```
tools/grammar/
  rng.ts            # mulberry32 copy (seeded determinism)
  stats.ts          # corpus → StatsTables (frequencies, adjacency, grounds, palette, forms)
  features.ts       # per-banner feature vector (for template induction)
  templates.ts      # template definitions + assignment of each banner to a template
  grammar-schema.ts # Grammar JSON types + version
  build-grammar.ts  # CLI: stats+templates → corpus/grammar.json
  sample.ts         # seeded sampler: grammar + seed + knobs → BannerRecon plan
  score.ts          # rubric metrics on a plan (connectedness, line-share, ground-shifts, density, palette)
  render-samples.ts # CLI: sample N plans → PNG sheets (reuses P0 recon renderer)
test/grammar/
  stats.test.ts  templates.test.ts  sample.test.ts  score.test.ts
corpus/grammar.json          # OUTPUT (versioned, committed)
corpus/samples/              # OUTPUT sample sheets (committed at gates)
tools/mine/render-recon.ts   # EXTRACTED from validate-sheet.ts (shared recon renderer)
```

---

### Task 0: Shared types + recon-renderer extraction

**Files:**
- Modify: `tools/mine/schema.ts` (add canonical `ManifestTile`), `tools/mine/forms.ts`, `tools/mine/tile-match.ts`, `tools/mine/validate-sheet.ts` (consume it)
- Create: `tools/mine/render-recon.ts` (extract `renderRecon` + `recoloredTile` + `serializeColored` + `tileBackgroundIndex` + manifest loading from validate-sheet.ts so the sampler harness can reuse them)
- Test: existing suite must stay green (pure refactor, no behavior change)

**Interfaces:**
- Produces in schema.ts:

```typescript
export interface ManifestTile {
  id: string;
  filename: string;
  shape_family: string;
  visual_weight?: number;
  edge_coverage: { top: number; right: number; bottom: number; left: number };
  dominant_direction?: string;
  renderable?: boolean;
  has_background_rect?: boolean;
  mined_from?: string;
}
```

- Produces in render-recon.ts (signatures preserved from validate-sheet):

```typescript
export function loadMergedManifest(): Map<string, ManifestTile & { baseDir: string }>;
export async function renderRecon(banner: BannerRecon, originalCells: CellSlice[] | null,
  manifest: Map<string, ManifestTile & { baseDir: string }>): Promise<Canvas>;
// originalCells: null for SAMPLED plans (no original to copy freeform cells from) —
// freeform cells in sampled plans render as a flat ink-colored organic placeholder
// (rounded blob path centered in cell) instead of magenta-tinted copies.
```

- [ ] **Step 1:** Add `ManifestTile` to schema.ts; re-point forms.ts and tile-match.ts local copies to import it (keep any extra local fields as intersections). Extract render-recon.ts; validate-sheet.ts imports from it.
- [ ] **Step 2:** `npx tsc -p tsconfig.json --noEmit` clean; `npm test` all green; `npm run mine:validate` still produces sheets (byte-compare report.json against the committed one — identical).
- [ ] **Step 3:** Commit `grammar: consolidate ManifestTile; extract shared recon renderer`.

---

### Task 1: Stats extraction  **[Delegate: Codex]**

**Files:**
- Create: `tools/grammar/stats.ts`, `test/grammar/stats.test.ts`

**Interfaces:**

```typescript
export interface StatsTables {
  schemaVersion: 1;
  families: Record<string, number>;              // tile-cell counts by family
  tiles: Record<string, number>;                  // counts by tile id
  tileRotations: Record<string, Record<string, number>>; // tile → '0'|'90'|'180'|'270' → count (flip folded: count flip separately)
  tileFlipShare: Record<string, number>;          // tile → fraction flipped
  adjacency: {                                    // directional co-occurrence of tile placements
    horizontal: Record<string, Record<string, number>>; // 'tile/rot/f' → right-neighbor 'tile/rot/f' → count
    vertical: Record<string, Record<string, number>>;   // downward
  };
  inkByGround: Record<string, Record<string, number>>;  // cell ground → ink → count (tile+freeform cells)
  globalGrounds: Record<string, number>;
  groundSchemes: {                                // per-banner ground-mosaic classification
    perBanner: Record<string, GroundScheme>;
    counts: Record<GroundSchemeKind, number>;
  };
  forms: { kinds: Record<string, number>; sizes: Record<string, number>;
           byFamily: Record<string, number>; friezeRows: Record<string, number> }; // which row friezes live in
  plain: { perBannerHistogram: Record<string, number>; byRow: [number, number, number];
           positions: Record<string, number> };   // 'col,row' → count
  economy: { distinctTilesPerBanner: number[]; dominantFamilyShare: number[] };
}
export type GroundSchemeKind = 'uniform' | 'checker' | 'banded-rows' | 'banded-cols' | 'zoned' | 'scatter';
export interface GroundScheme { kind: GroundSchemeKind; grounds: string[]; offGlobalCount: number }
export function computeStats(corpus: Corpus, manifest: Map<string, ManifestTile & { baseDir: string }>): StatsTables;
```

Ground-scheme classification rules (binding):
- `uniform`: 0–1 off-global cells. `checker`: ≥8 off-global cells and no two orthogonally-adjacent cells share an off-global ground OR alternation holds on ≥80% of adjacent pairs. `banded-rows`: each row internally uniform, ≥2 distinct row grounds. `banded-cols`: same by column. `zoned`: off-global cells form ≤3 orthogonally-connected regions of size ≥2. `scatter`: everything else. Apply in that order, first match wins.

Ink-attribution spot-check (the P0 carry-forward, part of this task):
- For 10 randomly seeded cells with `kind==='tile'` and ≥2 inks, re-rasterize the cell foreground per-ink (mask per fill color) and assert the recorded `ink` (inks[0]) has the largest pixel count. If >2 of 10 fail, STOP — report DONE_WITH_CONCERNS naming the failing banners (palette tables can't be trusted; controller decides).

- [ ] **Step 1:** Write failing tests: computeStats on a 2-banner synthetic corpus fixture (hand-built in the test: known families, one checker ground scheme, one uniform, one frieze) asserting exact table values; plus on the REAL corpus assert totals match the measured facts in Global Constraints (families.lines === 171, forms avg 2.60 ± exact counts 58/60/12, globalGrounds['#F3F3F3'] === 37).
- [ ] **Step 2:** Run, verify FAIL. Implement. Run, verify PASS (include the ink spot-check output in the report).
- [ ] **Step 3:** `npm test` green. Commit `grammar: corpus statistics extraction`.

---

### Task 2: Feature vectors + template induction  **[Claude only — judgment]**

**Files:**
- Create: `tools/grammar/features.ts`, `tools/grammar/templates.ts`, `test/grammar/templates.test.ts`

**Interfaces:**

```typescript
// features.ts
export interface BannerFeatures {
  id: string;
  groundScheme: GroundSchemeKind;
  dominantFamily: string; dominantShare: number;
  distinctTiles: number;
  formCounts: { run: number; frieze: number; figure: number };
  friezeRow: number | null;          // row of the largest frieze, if any
  figureShare: number;               // freeform cells / 18
  plainShare: number;
  accentInks: string[];              // non-neutral inks present, by coverage
  lineworkShare: number;             // lines+circle+curve+wave family cells / tile cells
}
export function computeFeatures(banner: BannerRecon, stats: StatsTables, manifest: ...): BannerFeatures;

// templates.ts
export interface Template {
  id: string;                        // e.g. 'pipe-field-checker'
  name: string;                      // human name (Claude assigns)
  bannerIds: string[];               // corpus members
  spec: {                            // sampled ranges, derived from members
    groundSchemes: GroundSchemeKind[];
    dominantFamilies: string[];
    distinctTiles: [number, number]; // min,max
    forms: { run: [number, number]; frieze: [number, number]; figure: [number, number] };
    figureShare: [number, number];
    plainShare: [number, number];
    lineworkShare: [number, number];
  };
}
export function assignTemplates(features: BannerFeatures[]): Template[]; // deterministic rule-based assignment
```

- [ ] **Step 1 (mechanical):** Implement features.ts (pure derivation from corpus + stats).
- [ ] **Step 2 (mechanical):** Print the 50 feature vectors as a table.
- [ ] **Step 3 (Claude judgment):** Cluster by eye + rules from the table AND the validation sheets: expect ~5–8 templates (working hypotheses from the P0 review: pipe/line field · figure-anchored field · checker-ground pattern · frieze-based rhythm · dense mixed field · freeform figure-field). Encode as deterministic assignment rules in templates.ts (every banner assigned exactly one template; rules readable and auditable).
- [ ] **Step 4:** Test: all 50 assigned; no template has <3 members unless explicitly justified in a comment (043-style freeform-field may be small); template spec ranges actually contain every member's features.
- [ ] **Step 5:** Commit `grammar: banner feature vectors + template induction (N templates)`.

---

### Task 3: Grammar schema + build CLI

**Files:**
- Create: `tools/grammar/grammar-schema.ts`, `tools/grammar/build-grammar.ts`
- Modify: `package.json` (script `"grammar:build": "esbuild tools/grammar/build-grammar.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-tools/build-grammar.mjs && node dist-tools/build-grammar.mjs"`)

**Interfaces:**

```typescript
export interface Grammar {
  schemaVersion: 1;
  builtAt: string;                   // CLI-stamped
  stats: StatsTables;
  templates: Template[];
  tileCatalog: Record<string, { family: string; edges: {top:number;right:number;bottom:number;left:number};
                                 rotations: Record<string, number>; flipShare: number }>;
  palette: { globalGrounds: Record<string, number>; inkByGround: Record<string, Record<string, number>>;
             accentOrder: string[] };  // ['#FF4F00','#4997D0','#FFA300'] by corpus frequency
}
```

- [ ] **Step 1:** Implement schema + CLI (compose Tasks 1–2 outputs; write `corpus/grammar.json` 2-space, deterministic modulo builtAt).
- [ ] **Step 2:** Run `npm run grammar:build`; determinism check (two runs, jq del(.builtAt), identical). `npm test` green.
- [ ] **Step 3:** Commit `grammar: grammar.json build (schema v1)` including the generated file.

---

### Task 4: The sampler  **[Delegate: Codex — the meaty one]**

**Files:**
- Create: `tools/grammar/rng.ts` (mulberry32 copy), `tools/grammar/sample.ts`, `test/grammar/sample.test.ts`

**Interfaces:**

```typescript
export interface SampleKnobs {
  template?: string;                 // template id; default: sample by corpus frequency
  accent?: string;                   // one of grammar.palette.accentOrder; default sampled
  density?: number;                  // 0..1, maps to plainShare within template range (inverted)
  figures?: boolean;                 // allow freeform figure cells; default per template
}
export function samplePlan(grammar: Grammar, seed: number, knobs?: SampleKnobs): BannerRecon;
// Deterministic: same (grammar, seed, knobs) → identical plan.
// Emits a fully-valid BannerRecon: id `sample-${seed}`, 6×3, every cell kind tile|plain|freeform,
// forms[] filled by re-running detectForms on the plan (import from tools/mine/forms.ts).
```

Sampling algorithm (binding order):
1. **Template**: knobs.template or weighted by member count.
2. **Global ground**: from grammar.palette.globalGrounds (frequency-weighted).
3. **Ground mosaic**: sample a GroundSchemeKind from template.spec.groundSchemes; lay per-cell grounds per that scheme's generator (checker alternates two grounds; banded-rows picks per-row; zoned grows 1–3 rectangular regions; uniform = global). Ground colors drawn from grammar inkByGround keys, restricted to the 7 brand fills.
4. **Dominant family + tile working set**: dominant family from template.spec.dominantFamilies (weighted by corpus family counts); draw distinctTiles from template range; select that many tiles weighted by grammar.tileCatalog counts, ≥60% from the dominant family.
5. **Forms first (connection-first):** sample form counts within template.spec ranges. Friezes: pick a frieze-capable tile (frieze row per stats.forms.friezeRows), fill the row's free cells with alternating flip. Runs: seed a cell, grow horizontally/vertically per the adjacency tables (sample next 'tile/rot/f' from the observed neighbors of the current placement; fall back to same-tile-alternating-flip when the table is sparse). Figures (if enabled): mark a connected 2–4 cell region freeform with a sampled accent ink.
6. **Fill remaining cells** from the working set: rotation sampled from tileCatalog.rotations, flip by flipShare; ink sampled from inkByGround[cellGround]; enforce ≤35% accent share across the plan; leave cells plain to hit the plainShare target (position-weighted by stats.plain.positions).
7. **Logomark guard**: reject/flip tri-family adjacent same-direction pairs (port the P0-engine rule at plan level: same primitive semantics — two chevron-notch/dart tiles pointing the same way, adjacent along the pointing axis).
8. **detectForms** on the finished plan → forms[]; matchRate = 1 by construction (informational).

- [ ] **Step 1:** Failing tests: determinism (same seed twice → deep-equal); every cell resolved; grounds all brand hexes; accent share ≤ 0.35; template knob respected (sampled plan's features fall inside the template's spec ranges — reuse computeFeatures from Task 2); adjacency honored (for a plan with a run, assert consecutive run cells appear as neighbors in grammar.adjacency.horizontal at least once, or are same-tile-alternating-flip fallbacks).
- [ ] **Step 2:** FAIL → implement → PASS. `npm test` green, tsc clean.
- [ ] **Step 3:** Commit `grammar: seeded sampler — grammar → BannerRecon plans`.
- [ ] **Step 4 (controller):** Dispatch Gemini independent review: sampler code + 20 sampled plans' feature table vs corpus stats — flag distribution drift or degenerate patterns.

---

### Task 5: Rubric scorer

**Files:**
- Create: `tools/grammar/score.ts`, `test/grammar/score.test.ts`

**Interfaces:**

```typescript
export interface RubricScores {
  connectedness: number;   // share of tile/freeform cells belonging to forms of size ≥2
  lineworkShare: number;   // lines+circle+curve+wave / tile cells
  groundShifts: number;    // count of adjacent same-form cells whose grounds differ (the signature move)
  density: number;         // 1 − plainShare
  accentShare: number;
  quiltFail: boolean;      // true if connectedness < 0.35 OR distinctTiles > 8 OR forms.length === 0
}
export function scorePlan(plan: BannerRecon, manifest: ...): RubricScores;
```

- [ ] **Step 1:** Failing tests: score the REAL corpus — assert the 50 banners' mean connectedness ≥ 0.5, mean density ≥ 0.85, and **zero corpus banners fail the quilt test except 043/047** (the freeform-field exemplars — if others fail, the thresholds are dishonest: STOP and report the distribution so the controller recalibrates rather than shipping a rubric the canon fails).
- [ ] **Step 2:** FAIL → implement → PASS (report the corpus score distribution table).
- [ ] **Step 3:** Commit `grammar: rubric scorer calibrated against the corpus`.

---

### Task 6: Sample-sheet harness

**Files:**
- Create: `tools/grammar/render-samples.ts`
- Modify: `package.json` (script `"grammar:samples": "esbuild tools/grammar/render-samples.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-tools/render-samples.mjs && node dist-tools/render-samples.mjs"`)

Behavior: `npm run grammar:samples -- --count 30 --seed 1000 [--template id]` → samples plans seeded seed..seed+count−1, scores each, renders via `renderRecon` (Task 0; freeform placeholder blobs), montages 10/sheet with per-plan caption (seed · template · scores · QUILT-FAIL flag), writes `corpus/samples/samples-{seed}-N.png` + `corpus/samples/report.json`.

- [ ] **Step 1:** Implement; run `--count 30 --seed 1000`.
- [ ] **Step 2:** `npm test` green. Commit `grammar: sample-sheet harness` (code only; sheets committed at the gate).

---

### Task 7: Claude visual gate + calibration loop  **[Claude only — the P1 gate]**

- [ ] **Step 1:** Generate 30 samples across all templates + 10 per single template. READ every sheet.
- [ ] **Step 2:** Judge against the rubric AND the eye: do samples read as members of the canonical family (connected fields, line-work hero, shifting grounds, full density) — not quilts, not posters? Which templates work, which produce noise?
- [ ] **Step 3:** Iterate: adjust template specs / sampler weights (numbers in grammar tables or sampler constants, not logic) — re-generate — re-review. Each iteration documented in `corpus/samples/GATE.md` (what changed, why, verdict per template).
- [ ] **Step 4:** Exit when: ≥70% of samples pass the quilt test AND Claude judges ≥1/3 of samples "would show Chris"; commit sheets + GATE.md + push; present the best sheet to Chris for the human verdict.
- [ ] **Step 5:** Commit `grammar: P1 visual gate — sample sheets + calibration record`; push branch.

## Self-review notes

- Spec coverage: §5b grammar layers → Tasks 1–3; sampler+knobs (§7) → Task 4; rubric (§4) → Task 5 (calibrated per §8 against the 50); generate-render-review loop (§8) → Tasks 6–7. Curation/MAP-Elites and studio wiring intentionally deferred to P3/P4 per spec phasing. Edge-matching *contracts* at render level are P2; P1's adjacency tables are their statistical precursor.
- Type consistency: StatsTables/GroundSchemeKind (T1) consumed by features/templates (T2), Grammar (T3), samplePlan (T4), scorePlan (T5) — names checked.
- No placeholders: every interface complete; algorithms specified with binding order and exact thresholds.
