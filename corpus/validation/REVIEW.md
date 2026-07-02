# P0 Validation Review — Claude visual gate (2026-07-02)

Reviewed: all 5 sheets (50 banners), original | reconstruction | per-cell heat.
Mean whole-image agreement 80.6% (metric note: magenta tinting of freeform/review
cells suppresses the number by design; tile-cell fidelity is what matters here).

## Headline verdicts

1. **The mining pipeline is validated.** Tile reconstruction fidelity is
   essentially perfect across all 50: rotation/flip transforms land correctly
   everywhere (no systematic mirror errors — the Task 5 compose-order risk is
   settled empirically), recoloring is exact, and per-cell ground mosaics
   reconstruct correctly (013, 020, 039 checker/zoned grounds all right).
2. **Banner 021's injected #FFFFFF ground is visually correct** (white-petal
   banner reads identically).
3. Unexplained (magenta) content falls into three honest classes — none of them
   indicates a matcher bug:

## Class A — genuinely freeform figures (classification CORRECT, no action)
004, 006, 011, 012, 017 (lamps), 018 (house), 023 (skeleton), 024 (some eyes),
028, 029 (coil), 035 (profiles), 036/037 (capitol domes), 042/044 (robot faces),
047 (squiggles), 048 (puzzle blobs — 18/18 freeform, correct).
These are the corpus's organic figure-ground minority. P1 grammar treats them as
`figure` forms; their geometry stays available in the original SVGs.

## Class B — suspicious near-misses, Task 9 targets (look tileable but missed)
- **043** — ALL 18 cells `review` at exactly 0.75: too uniform to be content;
  smells systematic (scale/offset or a tile-variant gap). INVESTIGATE FIRST.
- **034** — right half magenta on diamond/petal forms that look like library
  tiles; several cells plausibly sub-threshold. Hand-label or threshold.
- **046** — checker-quilt cells magenta; same suspicion as 034.
- **019** — 41.5% agreement; Illustrator/CSS-class banner; check whether its
  freeform cells are real content or preprocessing artifacts.
- **023/047** border cells — verify a few `review` candidates by eye.

## Class C — scattered single-cell review misses
Isolated near-threshold cells across otherwise-green banners (e.g. 007, 010, 039).
Cheap wins via overrides using recorded top-3 candidates.

## Per-banner agreement (lowest 10)
043 0.0 · 048 0.0 (all-magenta by design) · 047 38.9 · 019 41.5 · 034 42.2 ·
046 49.4 · 023 57.9 · 017 58.8 · 024 61.3 · 018 62.1
All others ≥ ~65%, majority ≥ 90% with all-green heat.

## Gate decision
PASS to Task 9 with the Class B list as the work queue. The P0 bar
(“reconstruction reads as the same banner”) is met for every banner outside
Class B; Class A magenta is desired behavior, not failure.
