# Task 3 Report: SVG parsing + mask rasterization utilities

## Implemented

- Added `tools/mine/svg.ts`.
  - Exports `SvgElement` and `parseSvgElements`.
  - Parses SVG with `jsdom`.
  - Preserves document paint order.
  - Skips `defs`, `clipPath`, and `mask` subtrees.
  - Supports `rect`, `path`, `circle`, and `ellipse`.
  - Resolves fill from presentation attributes or inline style, with inheritance and SVG default black.
  - Normalizes `#rgb`, `#rrggbb`, `rgb(r,g,b)`, `white`, `black`, and preserves `none`.
  - Preserves `fill-rule` as `nonzero` or `evenodd`.
  - Throws on transforms, unsupported fills, unsupported fill rules, invalid numbers, and malformed paths.

- Added `tools/mine/raster.ts`.
  - Exports async `rasterizeMask`, synchronous `maskIoU`, and synchronous `maskFillRatio`.
  - Implements the amended rasterization approach using a synthesized SVG document and `canvas.loadImage`.
  - Paints a full-viewport black background, then serializes input elements in paint order.
  - Paints foreground elements white and non-foreground elements black so later non-foreground paint occludes earlier foreground.
  - Skips elements whose parsed fill is `none`.
  - Reads canvas pixels and converts the red channel to a binary mask with `red > 127`.

- Added tests:
  - `test/mine/svg.test.ts`
  - `test/mine/raster.test.ts`

## TDD Evidence

### RED

Command:

```sh
npx vitest run test/mine/svg.test.ts test/mine/raster.test.ts
```

Failing excerpt before implementation:

```text
FAIL  test/mine/raster.test.ts [ test/mine/raster.test.ts ]
Error: Failed to load url ../../tools/mine/raster (resolved id: ../../tools/mine/raster) in /Users/chris/fai-studio-dev/test/mine/raster.test.ts. Does the file exist?

FAIL  test/mine/svg.test.ts [ test/mine/svg.test.ts ]
Error: Failed to load url ../../tools/mine/svg (resolved id: ../../tools/mine/svg) in /Users/chris/fai-studio-dev/test/mine/svg.test.ts. Does the file exist?

Test Files  2 failed (2)
Tests  no tests
```

### GREEN

Command:

```sh
npx vitest run test/mine/svg.test.ts test/mine/raster.test.ts
```

Passing excerpt after implementation and self-review cleanup:

```text
✓ test/mine/raster.test.ts (4 tests) 26ms
✓ test/mine/svg.test.ts (2 tests) 86ms

Test Files  2 passed (2)
Tests  6 passed (6)
```

### Full Suite

Command:

```sh
npm test
```

Passing excerpt:

```text
✓ test/flatten-core.test.ts (3 tests) 2ms
✓ test/mine/raster.test.ts (4 tests) 228ms
✓ test/editor-scene-ops.test.ts (22 tests) 11ms
✓ test/engine.test.ts (21 tests) 52ms
✓ test/mine/svg.test.ts (2 tests) 75ms
✓ test/editor-keys.test.ts (4 tests) 93ms
✓ test/editor-ui.test.ts (5 tests) 834ms

Test Files  7 passed (7)
Tests  61 passed (61)
```

## Files Changed

- `tools/mine/svg.ts`
- `tools/mine/raster.ts`
- `test/mine/svg.test.ts`
- `test/mine/raster.test.ts`

## Self-Review

- The exact viewport-crop assertion passed; no relaxed anti-aliasing threshold was needed.
- `rasterizeMask` is async per the amendment; `maskIoU` and `maskFillRatio` remain synchronous pure functions.
- Parser behavior is intentionally strict: unsupported transforms, fills, fill rules, and numeric units throw rather than guessing.
- Optional non-required check: `npx tsc -p tsconfig.json --noEmit` is not currently a valid acceptance signal for this repo/task because the repo has no `@types/node` or `@types/jsdom`, while the brief-mandated tests import `node:fs`. The required Vitest targeted run and full suite both pass.

## Code Review Fixes

**Commit:** `8e538c6` ("mine: svg parse — skip defs before transform check; throw on missing fill")

Fixed two findings:

1. **Finding 1** — Reordered walk function: moved SKIP_SUBTREES check before transform validation. Now `<defs transform="...">` is correctly skipped instead of throwing.
2. **Finding 2** — Made undefined fill fail-loud: added guard in walk function to throw when a shape element has no fill and none inherited. Error message: `<${tag}> has no fill attribute and none inherited — corpus SVGs must carry explicit fills`.

Added two tests:
- `skips defs subtree without throwing on transform` — confirms defs with transform attribute is skipped
- `throws when shape has no fill and none inherited` — confirms shapes without fill throw with `/no fill/` message

Test results:
```
npx vitest run test/mine/svg.test.ts test/mine/raster.test.ts

✓ test/mine/raster.test.ts (4 tests) 92ms
✓ test/mine/svg.test.ts (4 tests) 59ms

Test Files  2 passed (2)
Tests  8 passed (8)
```

---

**NOTE:** the original content of this file was accidentally overwritten with Task 2 material by the implementer; authoritative Task 3 record = commit 31d4ce9 + review + this fix commit.
