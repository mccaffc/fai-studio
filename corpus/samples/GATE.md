# P1 Visual Gate — calibration record (Claude)

## Iteration 0 (seeds 1000-1029 mixed, 2000-2009 pipe-field) — 2026-07-02
Metrics: 100% quilt-pass, conn 0.78, density 0.95, acc 0.17.
Claude verdict: ~35% would-show (1001 dot-banner, 1004 leaf-forms, 1005 K-row, 1008 stripe-bands strongest).
GAP: repetition without CONTINUITY — pipe elbows don't join across cells; the signature move
(line-work flowing across shifting grounds) reads only in ~3/40 samples. Accents scatter as
isolated blocks instead of riding a form/zone.
DECISION: iterate before presenting — two levers: (1) edge-chained run growth (oriented exit
edge must meet next cell's oriented entry edge, true edge data now available), (2) single
accent-zone policy per plan.

## Iteration 1 (same seeds re-generated) — 2026-07-02
Changes: (1) edge-PROFILE join contract (64-bit seam vectors per variant in grammar v2;
placementsJoin requires profile IoU ≥ 0.5, not just edge activity) — implemented by Claude
directly after Codex channel stalled; (2) accent zoning (one accent, one zone: same-tile
flood ink-zone / colored-ground block / figure-adoption; de-scatter outside).
Metrics: 100% quilt-pass, conn 0.77/0.82, all 5 audit gates PASS, 137/137 tests.
Claude verdict: ~50% would-show (was 35%). Signature move now PRESENT — real multi-cell
continuous passages in most pipe-field samples; accents read intentional.
GATE: PASS (bar: ≥70% quilt-pass ✓, ≥1/3 would-show ✓).
Named residual for P2: run length — canon serpents reach 15 cells, samples ~4. The renderer
phase should bias growth length using the corpus form-size distribution (data already mined).

## Iteration 2 — ENGINE OUTPUT (P2 T5 gate) — 2026-07-02
First gate on the engine's own SVG (renderPlanSvg, serpentine growth live). Sheets:
engine-mixed-3000 / engine-pipe-3100 / engine-arc-3200.
Claude verdict: ~60% would-show (bar 50%) — GATE PASS. The signature move is now unmistakable:
multi-cell serpents (6-10 cells) flowing over shifting grounds in most pipe-field samples;
accent zones read intentional; density canonical. Residuals (named, non-blocking):
freeform placeholder blobs visibly synthetic (figure-field suffers most — real figure geometry
is the next aesthetic frontier); occasional lone-motif field interruptions; some arc clusters
rosette rather than flow (reads as variety, monitoring).

## Iteration 3 — P3 gate (figures + programs) — 2026-07-02
Sheets: p3-figures-9100 / p3-programs-5001 / p3-pipe-regression.
PROGRAMS: PASS emphatically — all 6 hues on pure neutrals, palette law visibly holds (no white/
orange anywhere, one hue per banner), indigo legibility guard confirmed on-sheet. This is the
program-banner capability as briefed.
FIGURES: PASS — curated corpus figures (lamps, ring-domes, owl-eyes) placed recolored in generated
fields; enormous improvement over blobs. Noted for later: canon anchors LARGER figures (3×2 domes)
than the current max extracted span (2×3) — a future extraction pass could add multi-cell spans.
PIPES: no regression (3100-3105 hold P2 quality; some gain integrated figures).

## P3 final (2026-07-02): whole-branch review READY TO MERGE, zero must-fixes.
Track-for-P4 (priority): larger figure spans (canon 3×2 domes vs shipped max 2×2/2×3);
recolorPlan program→corpus-accent latent two-hue edge (UI-unreachable); drift-drop UX note;
openCorpusItem guard parity.

## Iteration 4 — P4 gate (heroes) — 2026-07-02
Sheets: p4-heroes-11000 / p4-program-heroes-11020 / p4-pipe-regression.
HEROES: PASS — iconic patches stamp as designed passages (036-dome colonnade reads canonically
mid-field); role recoloring prevents paste-in look; upscaled figures anchor hero slots. Program
law holds WITH heroes (Telemagenta creature-face in an AI banner — the compounded brief).
018-house patch: acceptable in context, stays. Pipes: byte-stable vs P3 (determinism on-sheet).
Would-show ~65%.

## Iteration 5 — P5 per-size gates — 2026-07-02
Sheets: p5-{portrait,square,strip,column,column-short,banner}.png.
VERDICTS: portrait SHIP · square SHIP · strip SHIP (component doctrine: quiet strips are correct
eyebrows; drip-wave/arc-trio are hero-grade) · column SHIP (vertical serpents excel — ring-stack
columns are the surprise winner) · column-short SHIP FLAGGED-EXPERIMENTAL (6/8 visually fine but
~half trip composition floors — a metric artifact at 3-cell scale, not visual failure; floors
should become arrangement-aware before the flag lifts). Banner regression clean.
Composition floors visibly working on the standard sizes (FLOOR labels rare, deserved).

## Iteration 6 — P6 gate (multi-accent auto + mirror + rhythm phrasing), 2026-07-04

Sheet: seeds 810000–810011, auto mode, banner 6×3. Claude eyes on all 12 (single-banner renders).

**Exit criteria: PASS.** Multi-accent 9/12 (exit ≥4); mirrored 4/12 (exit ≥2, canon 24% → 33% in-window);
no regression (no stretching, no palette violations, seams join, figures aspect-true).

Per-seed: ★ = would show unedited.
- 810000 ★ figure-field, MIRRORED — blue ring quadrants flank a white figure block, orange ring foot. Full-palette + symmetry working together.
- 810001 mixed-quilt — 3-accent quilt; canon-legal register, busy but coherent. Borderline.
- 810002 ★ pipe-field, MIRRORED — blue diamond field, disc toggles, full orange/yellow disc row (a full-line phrase).
- 810003 ★ pipe-field — STACKED full-row phrases: yellow arc rainbows / orange drop row / blue semi row. Best of sheet; the rhythm-phrasing deliverable made visible.
- 810004 ★ arc-mosaic, MIRRORED — three full rows of white semis, single chrome-yellow cell. Quiet register, strong focal dominance.
- 810005 ★ figure-field, 0-accent — monochrome ring-quadrant field, dense and connected (canon-legal: 11/50 canon are neutral-only).
- 810006 figure-field — face-adjacent figure (scallop brow, orange eyes), 3 accents; bottom-right reads loose. Borderline.
- 810007 mixed-quilt, 0-accent — b/w stripe-family quilt. Fine, not thrilling. Borderline.
- 810008 ★ pipe-field, MIRRORED — orange dot colonnade, blue disc corners, full row of yellow arc targets. Symmetric, full-palette, hero-grade.
- 810009 pipe-field — dot-serpentine + yellow discs + blue scallops; busy but connected. Show-able.
- 810010 ★ pipe-field — stripe colonnade field with orange/blue/yellow; strong Bauhaus register.
- 810011 repeat-rhythm — orange quarter-disc row + dome row; corner blue reads stray. Borderline.

Would-show: 7/12 unedited (58%) + 5 borderline, 0 failures. Consistent with iteration-4/5 (~65% incl.
borderlines) — no regression, and the full-palette complaint (auto sheets reading heritage-only) is
resolved: 7/12 plans carry all three heritage accents, 9/12 carry ≥2.

The mirror rate landing above canon in-window (4/12 vs 24%) is sampling noise at n=12 (probe: 20%/200).
Rhythm phrasing visibly present (810002/810003/810004/810008 all carry full-line phrases).

## Iteration 7 — P7 gate (locked-palette pool + full-palette mode), 2026-07-06

Sheets: full mode seeds 820000–820005, auto seeds 830000–830005, banner 6×3. Claude eyes on all 12.

**Full-palette mode: PASS, and better than feared.** All 6 would show with light curation; no carnival
failure. 820002 (6 hues over one striped/arced pipe surface) and 820003 (all 7 hues in a quarter-disc
field) are the proof pieces: "all the colors at once" holds together when the tile FAMILY carries the
composition. 820004's telemagenta stripe cross dominates properly. 820005 (ring quadrants over
green/blue/yellow/orange grounds) shows the ground-mode zones working with the new hues.
Dark-hue contrast law verified by eye: white ink on Frontier Indigo, black rings on Chrome Yellow,
green-on-white stripes all read cleanly. Report's measured min ratio 3.06 (Timberwolf-on-green) meets
the WCAG graphics standard; the plan's 4.5:1 was a body-text number, wrong for decorative shapes —
implementation's threshold rule is correct, plan amended by this gate note.

**Auto with 7-hue pool: PASS.** New hues appear naturally at canon frequency: 830004 checker-motif
carries Signal Green disc field + Chrome Yellow + Celestial Blue (first non-trio hue ever in auto);
830000/830002 are neutral-only (canon-legal). No regression in structure, seams, or rhythm.

Quirk for review: sheet caption "acc" (scorer accentShare) reads 0.00 on 820001 despite 5 visible hues —
scorer counts cell.ink only, not inks[] (pre-existing, display-only).

## Gate A — P8 studio UX (accent swatches + four-group panel), 2026-07-06

In-browser (aside, localhost:4310), desktop 1440 + emulated 375. **PASS.**
- Four groups exactly per spec (Size chips / Color / Pattern / Seed); swatch row DOM-verified: 7 buttons,
  orange-first spec order, backgrounds exact to the locked hexes (screenshot compression faked a violet
  where Chrome Yellow sits — DOM check is the arbiter, noted for future gates).
- Check glyphs luminance-correct by eye (cod-gray on Celestial Blue, smoke-white on Signal Green).
- Behavior end-to-end: blue+green checked → banner colored in exactly blue+green; presets and program-lock
  states render; caption reads correctly.
- Mobile 375: scrollWidth==clientWidth (no overflow), panel stacks below stage in flow, swatches fit one
  343px row. (aside full-page capture DUPLICATES page content on emulated viewports — capture artifact,
  not CSS; verified via DOM measurements instead.)
- Accepted deviation: caption uses --line instead of --soft (this checkout's --soft is the panel bg;
  implementer's reasoning correct, contrast verified on screen).
