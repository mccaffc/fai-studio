# P10: Composition Laws + Workflow

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Codex/implementers build; the controller (Claude) measures taste against canon, designs UX, and gates everything visually.

**Goal (Chris, 2026-07-07):** more reliable harmony and striking composition in the output; UX built around the real workflow (hunting candidates for website heroes, deck panels, eyebrows).

**Method (binding):** every aesthetic mechanism is CANON-DERIVED — measure the 50 canonical banners first; encode what they already do; steering not gating (calibration law: no hard gate unless ≥90% of canon passes). The corpus is the taste authority.

## Global Constraints

- Auto-mode canon fidelity: distribution tests + audit gates must stay in band; every new steering law is measured against canon and its parameters justified by those measurements in code comments.
- All P6–P9 invariants hold (palette laws, pool guarantees, mirror survival, program identity, classic byte-identity). Determinism: mulberry32 only.
- No Co-Authored-By trailer; never commit .superpowers/.

## Task 1: Canon measurement — the three laws' parameters [Codex]

**Files:** `tools/grammar/composition-stats.ts` (new), report only — NO engine changes in this task.

Measure over the 50 canon banners (corpus.json + manifest), print a table + write `corpus/composition-laws.json`:
1. **Accent proximity:** for every banner with accents — number of connected accent components (8-neighbor, cells sharing any accent fill), size of each; share of accent cells that are ISOLATED singletons (no accent neighbor); distance of singletons from the nearest other accent cell. Hypothesis to test: canon accent cells form ≤2 components and true isolated corner singletons are rare.
2. **Focal position:** for banners with a detectable focal event (largest same-fill/same-form connected region ≥3 cells or figure/patch): centroid position normalized to [0,1]², distance from center and from the nearest rule-of-thirds point; share of focal events whose centroid lands in the center cell vs off-center. Hypothesis: canon focals sit off-center, near thirds lines.
3. **Rhythm break:** for repeat-rhythm + checker-motif banners: count rows/columns that are perfect repetitions vs rows with exactly ONE interrupting cell (different tile/ink/ground); measure interruption frequency and position (edge vs interior of the row). Hypothesis: canon repeat rows carry ~1 interruption and it is rarely at a row end.

Deliverable: the measured tables (in report + JSON). No thresholds chosen here — the controller reads the data and sets law parameters in Task 2's brief.

## Task 2: The three steering laws [Codex, parameters from controller after Task 1]

**Files:** `src/engine/corpus/sample.ts`, tests. Parameters TBD from Task 1 data; mechanisms:
1. **Accent clustering:** post-zoning/pre-split pass — an accent cell with no accent neighbor within distance D either migrates to touch its nearest accent component (re-ink swap with a neutral cell adjacent to the component, seam-safe) or re-inks neutral, per a seeded draw calibrated to the canon singleton rate. Never touches forced/pool guarantees (a migration preserves accent count; suppression only when count stays ≥ required minimum).
2. **Focal placement steering:** when a figure/patch/hero region is placed on ≥3×2 grids, the anchor draw weights cells by canon's measured focal-position distribution (off-center/thirds preference) instead of uniform.
3. **Rhythm break:** in repeat-rhythm/checker templates, when a full row/column of identical units is produced, one seeded interior cell gets an interruption (rotation flip, ink swap within palette laws, or tile swap within family) at canon's measured frequency.
Tests: canon-fidelity (distribution tests still in band); per-law before/after measurements over 200 auto seeds landing within the canon band from Task 1; all P6–P9 suites green.

## Task 3: Workflow — seed history + batch sheet + destination exports [controller UX spec first, then implementer]

**Files:** `src/studio/corpus-mode.ts`, `styles.css`, tests. Controller writes the design spec (like P8) before dispatch; feature scope:
1. **Seed history:** every generated seed (reroll/spacebar/regen) pushes onto a session history; ← → keys and ‹ › buttons walk back/forward re-generating deterministically (config snapshot stored per entry — config changes start a new branch, forward history drops). Capacity 50. THE fix for "the one three rerolls ago was better."
2. **Batch sheet:** a "Sheet ×12" action renders 12 plans in a grid overlay — seeds seed+1..+12 but templates CYCLED across the six (diversity by construction, two per template) under the current color/program config; click any cell to promote it to the canvas (adopting its seed+template); Esc closes. Replaces one-at-a-time hunting.
3. **Destination export presets:** the export row gains a preset select — Hero 2560×1280 PNG (banner 6×3 @2×), Deck panel 1920×960 PNG, Eyebrow 2880×960 PNG (strip 3×1 — 3:1; a 6:1 eyebrow matches no arrangement), Square social 2048×2048 (square 3×3) — named for where they land (website hero, deck panel/eyebrow per the deck-kit). Preset implies arrangement: choosing a preset with a mismatched current arrangement regenerates same-seed in the right arrangement first.
4. Keyboard: S save · E edit · ← → history (documented in a small footer hint line).

## Task 4: Gates [Claude]

- Gate E (aesthetic): paired A/B sheets — same seeds with laws on/off — for each law; exit = the law visibly kills its failure mode (strays gone, focals off-center, rows broken once) with NO new artificiality (migrated accents must not read as deliberate-looking noise), plus overall would-show rate ≥ P6 baseline on a fresh 12-sheet.
- Gate F (UX): in-browser — history walk restores exact banners; sheet diversity + promote; each preset produces the exact named pixel size; keyboard flow.
- Reviews per task + Gemini cross-cut + opus final → DIRECT MERGE.

## Task 5: Accent amount — slider + hotter defaults (Chris, 2026-07-07)

**Ask (verbatim intent):** "the accent banners by and large should have more of the accent than they do. maybe a slider that adjusts the amount of the accent in a composition?"

**Files:** `src/engine/corpus/sample.ts`, `types.ts`, `index.ts`, `src/studio/corpus-mode.ts`, `styles.css`, tests. Runs AFTER Task 2 lands and Task 3 is integrated (same files).

- Engine: `knobs.accentStrength?: number` (0..1). It scales, together and monotonically: the accent budget cap (lerp 0.15 → 0.60 across the range), zone size targets (sameTileFlood cap and zone cell counts), and ground-mode zone frequency. `accentStrength: 0.5` must reproduce today's behavior EXACTLY (all existing calibrations = the midpoint; determinism tests pin this). Applies in every accent-carrying mode (explicit accent, pool, full, program — threaded through programSampleKnobs); auto canon behavior unchanged at default.
- **Default shift per Chris's taste:** accent-carrying modes default to `accentStrength = 0.65`, not 0.5 — "by and large more" is the new baseline, the slider adjusts from there. The controller calibrates the exact default and the lerp endpoints at the visual gate (a strength ladder sheet: same seed at 0.2/0.35/0.5/0.65/0.8/1.0).
- Studio: "Accent amount" slider in the Color group beneath the swatches (Density's visual idiom), enabled whenever ≥1 accent is checked or a program is active; disabled + dimmed in plain auto with nothing checked (canon mode has no accent to amplify). Persisted in the corpus config; migration: absent → default.
- Guards unchanged: palette laws, pool member guarantees, mirror survival, contrast law. At strength 1.0 the accent may dominate (near accent-field banners) but every guarantee still holds.
- Tests: midpoint identity (0.5 ≡ today, deep-equal over 50 seeds per mode); monotonicity (accent cell share non-decreasing in strength over 100 seeds sampled at 5 strengths); budget cap respected at each strength; slider persistence + disabled-state.
- Gate: controller's strength-ladder sheet per mode (explicit accent + program + full) — the ladder must read as a smooth, usable range where 0.65 default matches Chris's "more accent" taste and 1.0 is still composed, not flooded.
