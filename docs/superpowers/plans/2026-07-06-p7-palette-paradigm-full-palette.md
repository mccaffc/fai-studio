# P7: Palette-Paradigm Cleanup + True Full-Palette Auto

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Single implementer (Codex), controller gates.

**Goal:** Kill the old-brand holdover (orange/blue/yellow as "the" FAI accents) at every root in the engine and studio, expand the auto accent pool to all six program hues + orange, and add an explicit Full-palette mode ("all the colors at once").

**Doctrine (Chris, 2026-07-06, verbatim):** "FAI's color is orange, black, and white. The accents belong to their programs." Chrome Yellow and Celestial Blue are program hues exactly like Telemagenta, Signal Green, Electric Violet, Frontier Indigo — no special status. The canon corpus predates the palette lock; its trio is a mining artifact, not a brand statement.

## Global Constraints

- The 11 permitted fills (locked 2026-06-18): Master = International Orange `#FF4F00`, Cod Gray `#121212`, Pure White `#FFFFFF`, Smoke White `#F3F3F3`, Timberwolf `#D9D9D6`. Program hues = Chrome Yellow `#FFA300` (Technology & Statecraft), Electric Violet `#8265DB` (American Governance), Telemagenta `#D63A8C` (Artificial Intelligence), Signal Green `#268B41` (Energy & Infrastructure), Celestial Blue `#4997D0` (Science & Innovation), Frontier Indigo `#3A4A6B` (Frontier Legal Defense).
- Accent pool (auto + full modes) = International Orange + all 6 program hues. Orange draw-weight 2, each program hue weight 1 (orange is the brand; the six are EQUAL — controller may retune at the visual gate).
- Warm/cool classification: WARM = {`#FF4F00`, `#FFA300`, `#D63A8C`}; COOL = {`#4997D0`, `#8265DB`, `#268B41`, `#3A4A6B`}.
- Contrast law for the two dark hues (Signal Green, Frontier Indigo — and any hue/ground pair): reuse the WCAG relative-luminance helpers in `src/engine/corpus/programs.ts` (share within the corpus dir; keep zero-dep purity). Ground-mode zone with hue relative luminance < 0.175 → zone ink = `#F3F3F3` (light), never `#121212`. Ink-mode zone: if contrastRatio(hue, cell ground) < 1.9, re-ground that cell to a contrasting neutral (mirror the palette-law logic in programs.ts).
- Auto default keeps the canon accent-COUNT distribution {0:.22, 1:.20, 2:.16, 3:.42} (the multi-accent test's ±12pp band must keep passing) — only the POOL changes.
- Full-palette mode (`knobs.paletteMode: 'full'`): target accent count = uniform draw 5..7, place zones until space or candidates run out (minimum acceptable 4 distinct); accent budget cap raised to 0.5 for this mode only (auto stays 0.35). Canon-count fidelity is deliberately waived here — it is an off-canon option Chris explicitly asked for. Composition floors still apply.
- Program mode and explicit-accent mode: behavior UNTOUCHED (single hue law, palette law, forced-accent survival gate). `applyProgramPalette` must now remap ALL 7 pool accents (not just the old trio) + prevHue to the target hue — the program palette-law test sweep must stay at 0 violations.
- `syncAccentDiagnostics`, descatter `allAccents`, and every accent-detection site must use the full 7-hue pool (a Telemagenta zone must count as an accent everywhere Blue does).
- Classic (non-corpus) engine mode: byte-identical output (its tests prove it). `src/engine/color/brand.ts` is rewritten as MASTER_FILLS + PROGRAM_HUES with the LOCKED names (electricViolet, frontierIndigo — the irisViolet/slateIndigo names are stale pre-lock leftovers); keep `BRAND`/`PROPOSAL`/`BRAND_HEXES`/`PROPOSAL_HEXES` as deprecated aliases derived from the new sets so classic consumers (`engine/index.ts`, `compose/constraints.ts`) compile and behave unchanged.
- Naming hygiene: no "heritage" or "classic accent" language survives in src/ or test/ — the trio, where still referenced (mined-data handling), is named for what it is: `CORPUS_MINED_ACCENTS` or similar. Studio Accent select lists all 7 accents as ONE flat group (orange first, program hues alphabetical), plus an "Full palette" option and "Auto"; kill the heritage-vs-program optgroup split.
- Determinism: mulberry32 only; all draws through weightedChoice with sort keys. No Date.now/Math.random.
- No Co-Authored-By trailer. Never commit `.superpowers/`. corpus/*.json must show no drift.

## Task 1: brand.ts paradigm rewrite + engine accent pool

**Files:** `src/engine/color/brand.ts`, `src/engine/corpus/sample.ts`, `src/engine/corpus/programs.ts`, tests.

- Rewrite brand.ts per Global Constraints (MASTER_FILLS, PROGRAM_HUES, deprecated aliases). Verify classic tests untouched-green.
- In sample.ts: introduce `ACCENT_POOL` (7 hues + weights per constraints) as the accent-selection source (`applyAccentZoning`'s accentChoices, `chooseAccent`); `BRAND_FILLS` keeps its GROUND-gating role only — rename to reflect that role. `WARM_ACCENTS_SET`/`COOL_ACCENTS_SET` per constraints. Dark-hue contrast law in `applyGroundZoneCell`/`applyInkZoneCell`.
- programs.ts: `applyProgramPalette` accent-remap set = full pool.
- Tests (red-first): pool membership over 400 auto seeds (accents ⊆ 7-pool AND all 7 hues each appear in ≥1 plan); canon count distribution still in band; dark-hue ground zones carry light ink (contrast ≥ 4.5:1 for ink-on-zone-ground); program palette law still 0 violations incl. plans whose pre-transform accents are new hues.

## Task 2: Full-palette mode + studio select

**Files:** `src/engine/corpus/sample.ts`, `src/engine/corpus/types.ts`, `src/engine/corpus/index.ts`, `src/studio/corpus-mode.ts`, tests.

- `CorpusConfig.paletteMode?: 'auto' | 'full'` (default 'auto') threaded through generateBanner/reroll/variations. Mutually exclusive with `program` and explicit `accent` (throw on conflict — fail loud).
- Full mode per Global Constraints (count 5..7, min 4 placed, budget 0.5, zones from the 7-pool without replacement, warm/cool side bias still applies).
- Studio: Accent select gains "Full palette" entry (persisted like other config; disabled when a Program is chosen, same as explicit accents).
- Tests (red-first): full mode determinism; ≥4 distinct accents in ≥80% of 100 full-mode banner seeds; every accent from the pool; budget ≤ 0.5; conflict throws.

## Task 3: Naming hygiene sweep

**Files:** everything in src/ + test/ matching heritage|classic accent|CLASSIC_ACCENT|HERITAGE.

- Rename per Global Constraints; update comments that describe the trio as "brand" colors to describe them as corpus-mined. Test names updated. Zero behavior change (prove: full suite green with only Task-1/2 behavioral diffs).
