# Task 4 Report: Seeded Sampler

## Implementation Summary

Implemented the grammar sampler from `Grammar` to fully resolved `BannerRecon` plans.

Files:
- `tools/grammar/rng.ts` - local `mulberry32` copy for tools-side deterministic sampling.
- `tools/grammar/sample.ts` - `SampleKnobs` and `samplePlan(grammar, seed, knobs?)`.
- `test/grammar/sample.test.ts` - determinism, palette, accent budget, template-range, and adjacency tests.

Sampler behavior:
- Produces `id: sample-${seed}`, 6x3, 18 row-major cells, valid `tile | plain | freeform` kinds, `matchRate = 1`.
- Re-runs `detectForms` on the final plan and fills `forms`.
- Uses one RNG stream per call. Object-backed draws sort keys before weighting.
- Supports uniform, checker, banded-rows, banded-cols, zoned, and scatter ground generators.
- Samples a dominant family by corpus family counts, then selects a distinct tile working set with at least 60% from the dominant family when catalog availability permits.
- Places forms before fill. Friezes use the required raw left+right edge-capable filter; the current grammar has no such tiles, so frieze placement skips rather than violating the constraint. Runs prefer observed adjacency pairs with active shared edges and fall back to same-tile alternating flip.
- Caps plain cells so the sampled distinct-tile target can still be realized.
- Enforces contrast (`ink !== ground`) and accent budget (`accent / non-plain <= 0.35`) after fill.
- Applies a conservative logomark guard for same-tile left/right directional adjacent pairs.

## Draw Order

Documented in `tools/grammar/sample.ts`:
1. template if `knobs.template` is absent
2. global ground
3. ground scheme, then scheme-specific ground/cell draws
4. dominant family, distinct-tile target, working-set tiles
5. form counts and form placements
6. optional figure region/accent
7. plain positions
8. tile fills: tile, rotation, flip, ink per remaining cell

All weighted draws are made from sorted candidate keys. `palette.accentOrder` remains semantically ordered, but candidate entries still carry deterministic sort keys.

## TDD Evidence

RED:
```text
$ npx vitest run test/grammar/sample.test.ts
FAIL  test/grammar/sample.test.ts
Error: Failed to load url ../../tools/grammar/sample ... Does the file exist?
Test Files  1 failed (1)
Tests  no tests
```

GREEN:
```text
$ npx vitest run test/grammar/sample.test.ts
✓ test/grammar/sample.test.ts (5 tests) 31ms
Test Files  1 passed (1)
Tests  5 passed (5)
```

TypeScript:
```text
$ npx tsc -p tsconfig.json --noEmit
# clean
```

Full suite:
```text
$ npm test
Test Files  16 passed (16)
Tests  120 passed (120)
```

## Per-Template Feature Results

Sampled seeds 1-5 for each template with `samplePlan(grammar, seed, { template })`; checked by `computeFeatures(plan, grammar.stats, manifest)`.

| Template | distinctTiles | plainShare | figureShare | lineworkShare |
|---|---:|---:|---:|---:|
| pipe-field | 2-5 | 0.1667 | 0-0.1111 | 1.0000 |
| arc-mosaic | 1-5 | 0.2222 | 0 | 1.0000 |
| checker-motif | 2-6 | 0.1667 | 0 | 0-0.4000 |
| repeat-rhythm | 2-5 | 0.1111 | 0 | 0-1.0000 |
| figure-field | 2-10 | 0.3333 | 0-0.1111 | 0-0.8333 |
| mixed-quilt | 6-12 | 0.1667 | 0 | 0.2000-0.6667 |

All values land inside the template ranges asserted by the test. `lineworkShare` uses the requested +/-0.15 tolerance; the largest tolerated case is `mixed-quilt` at 0.6667 against max 0.5556.

## Self-Review

Checks:
- Deterministic same seed/knobs deep-equal: pass.
- 18 resolved cells, no `review`: pass.
- Ground and ink colors restricted to seven brand fills: pass.
- Accent share budget: pass.
- Template knob ranges for all six templates x five seeds: pass.
- At least one sampled run honors observed adjacency or same-tile fallback: pass.
- `src/engine` untouched; no cross-boundary RNG import: pass.
- No new dependencies: pass.

Notes:
- The strict frieze-capable condition currently filters to zero catalog tiles because no current tile has both raw `edges.left >= 0.25` and `edges.right >= 0.25`. The code is ready for friezes if the catalog gains such entries; for now it avoids inventing invalid friezes.
- `corpus/corpus.json` was already dirty before this task and remains excluded from the sampler commit.
