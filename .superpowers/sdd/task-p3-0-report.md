# P3 Task 0 Report — Program Palette Engine

## Transform Rule Implementation Notes

### Rule 1: Grounds remap
- Global and cell grounds remapped before inks.
- `#FFFFFF` → `#F3F3F3` (SmokeWhite).
- `#FF4F00` (orange accent) as a ground → `hue` (it was an accent-as-ground zone).
- Other classic accents used as ground (`#4997D0`, `#FFA300`) → `hue`.
- Program neutrals and `hue` pass through unchanged.

### Rule 2: Inks remap
- Classic accent inks (`#FF4F00`, `#4997D0`, `#FFA300`) → `hue`.
- `#FFFFFF` ink → `#F3F3F3`.
- Neutral inks and `hue` pass through unchanged.
- `cell.inks[]` array remapped in parallel with `cell.ink`.

### Rule 3: Contrast pass
Applied per cell after rules 1+2:

**3a. ink === ground:** ink flips to the neutral that maximises contrast against the cell ground. Implemented as `neutralMaxContrast(ground)` which picks the highest-ratio element from `{#121212, #F3F3F3, #D9D9D6} \ {ground}`.

**3b. hue-on-CodGray fails 1.7 floor:** if `lumRatio(hue, #121212) < 1.7`, any cell where `ink === hue && ground === #121212` has its ground remapped to `#F3F3F3`. Only **Technology & Statecraft** (#FFA300 on #D9D9D6) has a failing pair — but not on CodGray, so this rule does not fire for any of the 6 programs on CodGray grounds.

**3c. Frontier Indigo special brand rule:** regardless of the numeric ratio, any cell where `ink === #3A4A6B && ground === #121212` has ground remapped to `#F3F3F3`. This is an explicit brand constraint (dark-on-dark must not appear) separate from the 1.7 floor.

### Rule 4: Safety
The transform never introduces `#FFFFFF` or `#FF4F00` by construction: rule 1 prevents `#FF4F00` grounds, rule 2 eliminates all classic accents including `#FF4F00` as inks, and rule 3 only assigns neutrals (`#121212`/`#F3F3F3`/`#D9D9D6`) when flipping ink.

## 6×3 Contrast Matrix (hue as INK on each ground)

| Program                   | Hue       | on #121212 | on #F3F3F3 | on #D9D9D6 |
|---------------------------|-----------|------------|------------|------------|
| Technology & Statecraft   | `#FFA300` | 9.36 ✓     | 1.80 ✓     | **1.42 ✗** |
| American Governance       | `#8265DB` | 4.31 ✓     | 3.92 ✓     | 3.07 ✓     |
| Artificial Intelligence   | `#D63A8C` | 4.32 ✓     | 3.91 ✓     | 3.07 ✓     |
| Energy & Infrastructure   | `#268B41` | 4.33 ✓     | 3.90 ✓     | 3.06 ✓     |
| Science & Innovation      | `#4997D0` | 5.91 ✓     | 2.86 ✓     | 2.24 ✓     |
| Frontier Legal Defense    | `#3A4A6B` | 2.12 ✓*    | 7.98 ✓     | 6.26 ✓     |

*Passes the 1.7 numeric floor but remapped by the explicit brand rule (3c).

**Single failing pair:** Technology & Statecraft on Timberwolf (#D9D9D6): 1.42 < 1.7 → any cell with `ink=#FFA300 && ground=#D9D9D6` gets ground remapped to `#F3F3F3`.

## Extended Assertion Inventory

### render.test.ts additions
1. `assertProgramPalette` helper: validates fills ⊆ `{#121212, #F3F3F3, #D9D9D6, hue}` for a rendered SVG.
2. `renderPlanSvg — program palette law > 6 programs × 4 seeds`: renders all 6 programs × 4 seeds across templates, asserts restricted palette in SVG.
3. `renderPlanSvg — program palette law > Frontier Indigo: no indigo ink on Cod Gray ground`: iterates plan cells (not SVG) for 4 seeds.
4. `renderPlanSvg — program palette law > program transform is deterministic`: same seed+program yields byte-identical SVG twice.

Note: the existing `renderPlanSvg — brand fills only` test is **unchanged** — it still uses the 7-master-fill BRAND set for classic (non-program) plans. No existing assertions were modified.

### programs.test.ts (new file)
39 new tests across 12 describe blocks:
- PROGRAMS registry: 6 entries, locked hues, name/hex format
- `lumRatio`: black/white ~21:1, identity, commutativity
- `hueFailsContrastOnGround`: matrix spot-checks for #FFA300 and #3A4A6B
- Transform rules 1–4: dedicated test per rule with synthetic plans forcing edge cases
- Palette law: 6 programs × 4 seeds against `allFills(plan)`
- Purity: input plan not mutated
- `generateBanner` with program config: config echoed, SVG law verified, scores valid, reroll/variations inherit program
- `describePlan`: suffix present/absent
- `recolorPlan` program-hue swap: geometry frozen, config updated, SVG law, throws on unknown accent

## Test Evidence

- Before: 181 tests, 23 files — all passing
- After: 220 tests, 24 files — all passing (39 new tests)
- tsc --noEmit: clean
- npm run build: clean (vite 4-chunk output, 672ms)
- npm run grammar:audit: 5/5 PASS (corpus mode unaffected)
- corpus/corpus.json: no semantic drift (only timestamp from grammar:audit re-run, restored via git checkout)

## Concerns / Notes

- `describePlan` signature was extended with an optional `config?` parameter — backward-compatible (existing callers omit it). The plan description appending `· program <name>` requires the caller to pass `{ program: id }` from their config.
- `recolorPlan` under program mode is deliberately complex: program-hue-to-program-hue swap calls `applyProgramPalette` directly on the already-transformed plan. This is geometrically safe (applyProgramPalette is pure and geometry-preserving) but means the hue remapping is applied twice. The first application converted classic accents; the second application simply remaps the old hue to the new hue. This is correct and tested.
- Science & Innovation (#4997D0) is also a classic accent in the grammar. A plan sampled with `accent: '#4997D0'` and then `program: 'science-innovation'` will remap that accent to the same hue (#4997D0) — a no-op. The palette law holds.
