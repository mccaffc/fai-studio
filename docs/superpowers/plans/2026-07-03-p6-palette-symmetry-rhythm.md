# P6 — Full-Palette Auto, Mirror Symmetry, Rhythm Phrasing

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Fix the three gaps Chris's eye found on the live studio: (1) Auto mode never surfaces genuinely full-palette designs (canon modal state = THREE accents, 21/50; our zoning forces ~1); (2) no mirror symmetry (12/50 canon are near-mirrors; sampler has no mirror op); (3) rhythm phrasing (row/column phrase coherence, not tile-ABAB — canon data says alternation is rare, 2/125 rows).

## Measured canon facts (2026-07-03, binding calibration targets)
- Accent-count distribution (inks+grounds, non-neutral): **0:11 · 1:10 · 2:8 · 3:21** of 50 → sample accent-count from {0:.22, 1:.20, 2:.16, 3:.42}.
- Near-mirror banners (≥70% of (c,r)/(5−c,r) pairs matching tile+ink): **12/50 = 24%**.
- Strict ABAB rows: 2/125 — do NOT build tile-alternation rhythm; build mirror + zoning + phrase coherence.

## Global Constraints
Branch `feat/corpus-grammar-p6` off main. No Co-Authored-By. **No PR — merge directly to main after final review + gates** (Chris, 2026-07-03). Sonnet delegation floor. Engine purity/determinism. Program-mode law untouched (single hue — multi-accent is AUTO/full-palette only; explicit accent knob still forces single). Banner-identity NOT required this time (behavior change is the point) — but determinism, palette law (accents ⊆ 3 heritage in auto), budget ≤0.35 all hold. All 313 tests green except assertions explicitly recalibrated (list each).

## Tasks
### Task 0: Multi-accent auto  **[Codex]**
sample.ts applyAccentZoning: draw accentCount from the canon distribution (auto mode only; knobs.accent → 1; program → 1); allocate that many zones (existing zone machinery, distinct accents drawn without replacement from accentOrder weighted); **warm/cool spatial placement**: warm (#FF4F00/#FFA300) and cool (#4997D0) zones prefer opposite halves (draw a warm-side coin, then zone anchors bias to their side — soft weight 3:1, not hard). De-scatter keeps: strip accents outside ALL zones. Budget: ≤0.35 total across zones (guard exists). Diag: accentZones count + accentsUsed. Audit gains: sampled accent-count distribution vs canon (χ² eyeball — print both); acceptance: sampled {2,3}-accent share ≥ 40% (canon 58%; floor at 40 to avoid over-tuning). Tests: distribution sanity over 200 seeds; program/explicit-accent modes unchanged (existing tests must pass untouched); determinism.

### Task 1: Mirror symmetry  **[Codex]**
sample.ts: `mirrorPlan` composition op — after forms+fill, with probability calibrated to hit ~24% of auto plans (gate to templates whose canon members include the 12 near-mirrors — compute membership from corpus.json in the calibration comment): reflect left half to right (cols−1−c), flip toggled, rotation mirrored (90↔270 under horizontal flip — derive via existing profile machinery; VERIFY seams still profile-join at the center line — mirrored edges naturally match), inks/grounds copied. Odd-width center column untouched. Re-run detectForms + logo-guard note (mirror of a chevron-direction pair — the guard is a no-op stub; note it). figureSpan/patch cells: EXCLUDE mirrored copies of multi-cell anchors (mirror the region wholesale or skip mirroring plans with patches/figures spanning the centerline — simplest: if any patch/figure crosses center, skip mirror; document). Tests: mirrored plan symmetric by the same ≥70% pair-match metric; determinism; center-seam profile-joins hold; rate ≈ target over 100 seeds.

### Task 2: Rhythm phrasing  **[sonnet]**
Run growth gains a phrase bias: full-row bands and full-column colonnades (runs that reach a grid edge prefer completing the row/column — weight 2:1 when ≥cols−1 cells free in the line); rhythmQuality steering targets canon p50 0.595 (currently entropy drifts high) — adjust the fill-variety steering constant, re-verify template ranges + floors pass-rates (report before/after). Tests: over 40 seeds, ≥25% of plans contain a full-row or full-column form; audit 5/5 + floors ≥90%.

### Task 3: Visual gate + independent review  **[Claude + Gemini-direct/GLM]**
Auto-mode sheet ×12 (the money shot: do full-palette 3-accent designs appear at roughly canonical frequency? do mirrors read?), plus pipe/portrait regression rows. or-review.sh (GLM + gemini-direct) on the phase diff. GATE.md iteration 6. Exit: Claude sees ≥4/12 multi-accent + ≥2/12 mirrored + no regression; iterate constants otherwise.

### Task 4: Final review + MERGE  **[Claude]**
Opus whole-branch review → fixes → **merge to main directly** + deploy check + memory/ledger.
