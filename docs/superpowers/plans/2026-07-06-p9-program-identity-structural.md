# P9: Program Identity — Structural (Template Bias + Family Floor)

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development.

**Goal (Chris, 2026-07-06):** "It should be immediately obvious that a banner is one program's and not another's." Family bias alone (P8, ×8) delivered Science 6/6 but Governance 3/6, FLD 2/6, AI 1/6. The greyscale gate diagnosed two ceilings: template structure (an arc-mosaic template cannot make bars) and corpus vocabulary (AI has ~11 capsule/lens tiles). P9 removes the first ceiling; vocabulary is P9b (content work, separately scoped).

## Global Constraints

- AUTO MODE IS UNTOUCHED — the calibration law protects canon fidelity for auto; every mechanism here is gated on program mode (knobs threaded from index.ts exactly like familyBias). Auto/pool/full/classic byte-identity provable.
- Program palette law, forced-accent survival, mirror, rhythm: untouched.
- Determinism: mulberry32/weightedChoice only.
- Controller (Claude) owns all curation values below and recalibrates them at the greyscale gate; every tuning value is a named exported constant.
- No Co-Authored-By trailer; never commit .superpowers/.

## Task 1: Template bias + working-set family floor [Codex]

**Files:** `src/engine/corpus/programs.ts`, `sample.ts`, `index.ts`, `types.ts`, tests.

1. `PROGRAM_TEMPLATE_MAP: Record<ProgramId, readonly string[]>` (controller-curated starting table, verify template ids against the grammar):
   - technology-statecraft → ['repeat-rhythm', 'pipe-field']
   - american-governance → ['pipe-field', 'figure-field']
   - artificial-intelligence → ['figure-field', 'mixed-quilt']
   - energy-infrastructure → ['pipe-field']
   - science-innovation → ['arc-mosaic', 'checker-motif']
   - frontier-legal-defense → ['checker-motif', 'repeat-rhythm']
   `PROGRAM_TEMPLATE_BIAS = 5` — multiplier on the template draw for mapped templates (program mode only; explicit `template` knob still wins outright).
2. Working-set family floor: `PROGRAM_FAMILY_FLOOR = 0.6` — in program mode, when the working set is selected, at least this share of the WORKING SET's tiles come from the program's mapped families (PROGRAM_FAMILY_MAP), topping up from mapped-family tiles in the catalog when the template's natural draw under-fills, while keeping ≥1 non-mapped tile for texture where the set size allows. This guarantees mapped shapes on the surface, not just better odds. If a template genuinely has zero mapped-family tiles available in its working-set constraints, fall back to the biased draw and count it (diag counter `familyFloorMisses`).
3. Keep PROGRAM_FAMILY_BIAS = 8 on the dominant-family draw (stacking is intended; the floor makes the guarantee, the biases shape the leaning).
4. Tests (red-first): per program over 100 seeds — mapped-family share of tile cells ≥ a measured-and-stated threshold (measure, comment the numbers, assert with margin); template distribution leans to mapped templates (measured baseline vs biased); auto-mode plans byte-identical with the feature present (fixed-seed deep-equal against plans generated before your change — capture them in the test as the sampler is deterministic: generate on HEAD~ via committed expectations is impossible in-tree, so instead assert: knobs without program produce identical plans whether or not PROGRAM_TEMPLATE_MAP exists — i.e. the bias code paths are unreachable without the knob, verified by code-path test + audit numbers unmoved); explicit template knob overrides program template bias.

## Task 2: Greyscale gate + calibration [Claude]

Exit: side-by-side greyscale sheets (same seeds across programs), controller assigns programs blind with ≥5/6 correct per program, and no two programs' sheets read as siblings. Controller may retune all three constants + both maps; changes recorded in GATE.md with rationale. Expected residual: AI weak until P9b vocabulary lands — acceptable if AI is at least distinguishable from FLD/Energy by template register.

## P9b (separate, after Task 2): capsule/lens + wave vocabulary — mine the 21 freestyle illustrations for capsule/lens/wave cells via the P0 pipeline; controller curates candidates; new tiles enter the catalog + AI/Energy family maps. Scoped only after the structural gate shows the residual gap.
