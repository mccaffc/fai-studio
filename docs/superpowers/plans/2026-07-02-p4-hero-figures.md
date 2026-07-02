# P4 — Hero Figures (Upscale + Iconic Patches) + API Edges + ai-lab Retirement

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Canon-scale hero figures (the last aesthetic gap): (1) aspect-matched upscaling of existing figure assets; (2) "iconic patches" — curated cell-grid fragments of canonical banners (dome, robots, owls…) stamped as units; (3) the three tracked API/UX edges; (4) retire ai-lab per spec P5.

**Architecture:** Upscaling is a placement-rule change (assets may scale n× when region = asset×n). Patches are mini plan-fragments (cells with tiles/rotations/inks/grounds cropped from corpus.json), stamped into free rectangles by the sampler — they become ordinary tile cells so renderer/scorer/programs/forms need zero changes. Extraction tool + Claude curation, generated data module (drift-tested).

## Global Constraints
Branch `feat/corpus-grammar-p4` off p3. No Co-Authored-By. Engine purity rules. Patch budget ≤ 60KB source. Patches recolor by ROLE (inks→field ink/accent per template palette flow, grounds→field grounds) — never ship verbatim canon colors as fixed. A patch must be ≤ 4×3 cells and ≥ 2×2 (heroes, not whole banners). Determinism everywhere. All 243 tests stay green except assertions explicitly extended.

## Delegation
Codex (xhigh): Tasks 1, 2. Sonnet: Tasks 0, 3. Claude: patch curation (Task 1), visual gate (Task 4), wrap (Task 5). Per-task reviews; final opus review.

---

### Task 0: Figure upscaling + hero regions  **[sonnet]**
- sample.ts: figure asset placement may UPSCALE: asset (w,h) fits region (W,H) at integer scale k≥1 when W=k·w and H=k·h (exact aspect); prefer larger k (hero bias) weighted 2:1 over k=1; renderer already scales via viewBox — verify and test.
- figure-field template: region growth allows up to 3×3 (currently ≤6 cells arbitrary shape; ensure rectangular regions get preference so upscaling can fire — add a rectangular-region bias 60/40).
- Tests: a 2×2 region with only 1×1 assets available places one at k=2 (assert the <g> transform scale doubles); determinism; template ranges hold; audit 5/5.
- Commit `engine: figure upscaling + hero-region bias`.

### Task 1: Iconic patches  **[Codex extraction + Claude curation]**
- tools/grammar/gen-patches.ts (npm `gen:patches`): given a curation list of `{id, banner, x, y, w, h}` rectangles, crop corpus.json cells (tile/rotation/flip/ink/ground per cell, RELATIVE inks: map each distinct ink/ground to a ROLE slot: 'ink'|'accent'|'g0'|'g1'…), emit src/engine/corpus/data/patches.ts `{ id, source, w, h, cells: PatchCell[] }` + contact sheet (render each patch standalone via renderRecon-style path at role-default colors). SEED list (Claude pre-curation from the validation sheets — extract these rects): 036 dome (cols1-4,rows1-2 → 4×2), 037 dome variant, 042 robot head block (3×2), 044 robot face (3×2), 024 owl-pair (2×2… already a figure asset — skip), 018 house block (3×2), 023 skeleton+arcs block (2×2), 011 disc-face block (2×2). Codex implements the tool + emits the sheet with ALL seeds; CLAUDE then reviews the sheet, finalizes the list (either trims or adjusts rects), tool re-runs with the curated list embedded.
- Engine: sample.ts gains patch stamping for figure-capable templates (figure-field always considers: 50% patch vs figure-region when a free rect ≥2×2 exists; other templates 10%): choose patch fitting a free rect (exact size only, no scaling in v1), stamp cells (they're tile cells: kind 'tile'), resolve role slots: 'ink'→field dominant ink, 'accent'→plan accent (or program hue via normal accent flow), 'g0/g1'→field grounds (global + one shifted). Logomark-safety: patches are canon fragments (canon is chevron-legal) — no new risk.
- Tests: stamp determinism; patched cells render (distinctive tile combo from the patch appears); patch under program mode obeys palette law; forms detection groups patch cells (they're adjacent same-family tiles — connectedness benefits); audit 5/5.
- Commit(s): tool+data, then engine stamping.

### Task 2: API/UX edges  **[Codex]**
- recolorPlan program→corpus-accent: de-scatter figure/freeform inks of the departing hue (map to the new accent) — palette law test for that transition (was the latent two-hue edge).
- renderSaved: when drifted items are dropped, show a one-line tray note "N saved items couldn't be restored (engine updated)".
- openCorpusItem: try/catch parity with corpusRegen.
- Tests each. Commit `studio+engine: P4 edge fixes`.

### Task 3: ai-lab retirement  **[sonnet]**
- Move ai-lab/ → docs/archive/ai-lab/ with a README note (experiment record; superseded by the corpus engine; battery findings live in FAI Brand/04-Illustrations/llm-planner-battery). Update root README's ai-lab mentions. Nothing imports it (verify). Commit `chore: archive ai-lab (superseded by corpus engine)`.

### Task 4: Visual gate  **[Claude]**
- Sheets: figure-field heroes ×10 (upscaled assets + patches live), program×patch sweep ×6, pipe regression ×6. Judge: do heroes read canon-scale? Patches recolored convincingly (not copy-paste-looking)? Gate: would-show ≥60% and heroes present in most figure-field samples. GATE.md iteration 4.

### Task 5: Final review + wrap  **[Claude]**
- Opus whole-branch review; fixes; fast-forward PR #4 chain; README/memory; report.

## Self-review
Patch role-abstraction prevents verbatim canon color shipping; size bounds prevent whole-banner replication (043 lesson encoded); stamped cells reuse ALL existing machinery — no new render/score paths; ai-lab retirement completes spec P5's repo-side items.
