# P8: Quality of Life — Accent Chips, UX Polish, Corpus Editor, Program Shape Identity

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Codex implements engine/mechanical tasks; the controller (Claude) designs and gates all UX/aesthetic work itself.

**Goal (Chris, 2026-07-06):** (1) pick accents by checking them off instead of the clunky dropdown; (2) a UX polish pass over the whole studio; (3) port the classic editor to corpus mode; (4) give each program a distinctive visual identity beyond its color.

## Global Constraints

- The 11 permitted fills and the palette doctrine ("FAI's color is orange, black, and white; the accents belong to their programs") are locked — see P7 plan. Accent pool = International Orange + 6 equal program hues.
- Engine purity (src/engine/corpus imports nothing outside itself), mulberry32 determinism, no test recalibrated without documented justification. Program palette law, forced-accent survival, classic-mode byte identity all hold.
- Canon calibration law: auto default (no accents checked) keeps the canon accent-count distribution; user-constrained pools are explicitly off-canon options like full mode.
- No Co-Authored-By trailer; never commit .superpowers/ or corpus/samples churn (GATE.md excepted, force-added).

## Task 1: Engine accent-pool knob [Codex]

**Files:** `src/engine/corpus/sample.ts`, `types.ts`, `index.ts`, tests.

- `CorpusConfig.accentPool?: string[]` — subset of the 7 locked accents (validate: throw on unknown hex, on empty array, and on conflict with `accent`/`program`/`paletteMode:'full'`).
- Semantics: **every checked accent appears** in the composition (this is "check off which accents I want to use"). Target accent count = pool size; zones drawn from the pool without replacement; the full-mode minimum machinery generalizes (min distinct = pool size, capped by placeable cells). Budget cap: 0.35 for pools ≤ 2, 0.5 for pools ≥ 3 (matches auto/full precedents).
- `paletteMode:'full'` becomes sugar for `accentPool = all 7` internally (one code path; keep the public knob for back-compat and the studio preset).
- Single-member pool `[hex]` must behave EXACTLY like the existing explicit `accent: hex` path (same RNG draws — prove with a determinism test over 50 seeds).
- Warm/cool side bias, dark-hue contrast law, mirror survival gate (generalized: no pool member may be erased by the mirror — extend the P6 forced-accent survival gate to pool members) all apply.
- Tests red-first: pool membership + all-members-present over 100 seeds for pools of size 2, 3, 5; single-member equivalence; conflict throws; mirror survival for a 2-pool.

## Task 2: Studio UX polish [Claude designs; implementation briefed from the approved design]

**Files:** `src/studio/corpus-mode.ts`, `src/studio/styles.css`, `src/studio/fai-tokens.css` (consume only), tests.

- Accent dropdown dies. Replaced by **seven color chips** (toggle buttons: swatch + name), flat, orange first then alphabetical — none checked = Auto (canon), all checked = full palette (the Full preset just checks all). Chips disabled under a Program (single-hue law), with the program's own chip shown checked and locked.
- Whole-panel polish under Harmony + FAI overlay (tokens already mirrored in fai-tokens.css): grouping/hierarchy/spacing/labels, save-tray, mobile widths. **The controller does this design itself** — de-slop reasoning + FAI gates + pre-emit critique; implementer transcribes the approved spec only.
- Persistence: `accentPool` in the corpus config localStorage (validated against the locked 7 on load).

## Task 3: Corpus editor port [Codex, from a controller-written interface spec]

**Files:** new `src/studio/editor-corpus/` (plan-ops.ts + thin wiring), reusing `src/studio/editor/{dom,overlay,state}.ts` chrome where the Scene coupling allows; `src/studio/corpus-mode.ts` (Edit entry point).

- The classic editor (src/studio/editor/) operates on the classic Scene model. Corpus needs `plan-ops.ts` over `BannerPlan`/`CellPlan`: set tile (from the engine tile catalog, family-grouped), rotation, flip, ink, ground (11 fills only — palette-law-checked live), toggle plain; multi-select rotate/flip/re-ink; undo/redo via cloned plans; re-render through `renderPlanSvg` on every op.
- Out of scope for the port: merge/split cells (classic-scene concept), freeform drawing, figure/patch AUTHORING (existing figures/patches remain visible and movable as units; editing inside them is v2).
- Edited plans flow to the existing save tray and SVG/PNG export; an edited plan is stamped `edited: true` (scores hidden — the rubric calibrates generated plans, not hand edits).
- Entry: an Edit button on the corpus canvas; exit returns to generate mode without losing the current seed/config.

## Task 4: Program shape identity [Codex engine bias + Claude curation gate]

**Files:** `src/engine/corpus/programs.ts`, `sample.ts`, `data/grammar.ts` consumers, tests.

- Chris's June shape-family map (program identity = color + shape): Bars & Colonnades = Technology & Statecraft · Arcs & Sweeps = American Governance · Capsules & Lenses = AI · Waves & Scallops = Energy & Infrastructure · Discs & Dots = Science & Innovation · Crosses/Frames/Grids = Frontier Legal Defense. (Triangles & Chevrons = FAI master brand.)
- Program mode gains a **family bias**: the working-set/dominant-family draw is weighted toward the program's mapped corpus tile families (weight multiplier, NOT a hard filter — banners stay corpus-plausible; canon templates still govern structure). The controller curates the program→corpus-family mapping table (corpus families ≠ the classic cat1–cat7; mapping is an aesthetic judgment) and calibrates the multiplier at the visual gate — start at 3× and expose it as a named constant.
- Tests: per-program dominant-family distribution shifts measurably toward the mapped families over 100 seeds (state the measured baseline in the test, not a magic number); program palette law unchanged; auto mode untouched (bias gated on program).

## Task 5: Visual gates + reviews + wrap [Claude]

- Gate A (after 1+2): chips UX in the browser (aside-browser screenshot), pool-of-2/3/5 sheets.
- Gate B (after 3): editor smoke — open, edit inks/tiles/rotate, undo, export; verify palette law can't be violated from the inspector.
- Gate C (after 4): per-program sheets ×6 — does each program read as itself with color hidden? (The test: greyscale a sheet; can Claude name the program from shapes alone at better than chance?)
- Reviews per task + independent non-Claude eye + opus final whole-branch → DIRECT MERGE, deploy check, memory/ledger.
