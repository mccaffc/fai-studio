# P0 — Corpus Mining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct all 50 canonical FAI banners into machine-readable structure (`corpus/corpus.json`) by matching their flattened SVG geometry back to the 141-tile library, and produce a visual validation contact sheet proving the reconstruction is faithful.

**Architecture:** An offline Node mining pipeline inside the fai-studio repo: parse flattened banner SVGs (jsdom) → segment into the 6×3 grid of 320px cells → rasterize per-cell foreground masks (node-canvas, antialiasing off) → match each mask against precomputed masks of all 141 tiles × 4 rotations × 2 flips by IoU → detect multi-cell forms via manifest edge data + shared ink → emit `corpus.json` + a side-by-side validation sheet. Cells below match threshold are flagged and hand-labeled via `corpus-overrides.json`.

**Tech Stack:** TypeScript ESM, vitest, esbuild (bundle-then-node CLI pattern already used by `scripts/flatten-dir.mjs`), jsdom, node-canvas. **No new dependencies.**

## Global Constraints

- Work happens in a **local clone** (`~/fai-studio-dev`), never heavy builds on the Store mount (`~/Store/Coding Projects/...`). Push back through `origin` (GitHub `mccaffc/fai-studio`).
- Branch: `feat/corpus-grammar-engine`.
- **No `Co-Authored-By: Claude` trailer on any commit** (Chris's standing preference — overrides harness default).
- `src/engine/` stays zero-dependency and untouched in P0. Mining code lives in `tools/mine/` and uses devDependencies only.
- Brand palette hexes (exact): Cod Gray `#121212`, White `#FFFFFF`, Smoke White `#F3F3F3`, Timberwolf `#D9D9D6`, International Orange `#FF4F00`, Chrome Yellow `#FFA300`, Celestial Blue `#4997D0`.
- Banner geometry: 1920×960, 6×3 grid of 320×320 cells. Tiles: 200×200 viewBox.
- Never draw or recreate the FAI double-chevron logomark.
- **Aesthetic judgment is Claude's alone** — see Delegation Workflow. Delegates never decide what "looks right."

## Delegation Workflow (who does what)

- **Claude (main session):** plan orchestration, schema design, form detection, validation sheet, **all visual review and every aesthetic call**, hand-labeling, integration, commits, final gate.
- **Codex** (`codex:codex-rescue` subagent, effort xhigh): Tasks 3 and 5 — self-contained algorithmic implementation with tests (rasterizer, tile matcher). Prompts must be fully self-contained: include the task text verbatim + repo path + "run `npx vitest run test/mine/<file> --root .` to verify".
- **Gemini** (`gemini` subagent): after Task 6 — independent review of the mining pipeline code + sanity-check of corpus stats (fully self-contained prompt with file paths).
- Review discipline: Claude reads every delegated diff before commit; delegate output that changes interfaces defined here is rejected and re-dispatched.

## File Structure

```
corpus/
  reference/
    banners/001.svg … 050.svg      # vendored canonical banners (ground truth)
    tiles/<Family>/NN.svg           # vendored 141-tile library
    tiles-manifest.json             # vendored tiles-manifest-v2.json
  corpus.json                       # OUTPUT: mined reconstruction of all 50
  overrides.json                    # hand labels for flagged cells
  validation/sheet-*.png            # OUTPUT: side-by-side validation sheets
tools/mine/
  schema.ts        # corpus.json types + version
  svg.ts           # flattened-SVG → element list (jsdom)
  raster.ts        # elements → binary mask (node-canvas); mask IoU
  cells.ts         # banner elements → 18 CellSlices (ground + foreground)
  tile-match.ts    # cell mask vs tile-mask library → best match
  forms.ts         # adjacent matched cells → multi-cell FormGroups
  mine.ts          # CLI: banners → corpus.json + stats
  validate-sheet.ts# CLI: corpus.json → reconstruction sheet PNGs + IoU report
test/mine/
  svg.test.ts  raster.test.ts  cells.test.ts  tile-match.test.ts  forms.test.ts
```

---

### Task 0: Dev environment (local clone + branch push)

**Files:** none (environment only)

**Interfaces:**
- Produces: local clone at `~/fai-studio-dev` on branch `feat/corpus-grammar-engine`, `npm ci` done, existing tests green.

- [ ] **Step 1: Push the branch from the Store copy**

```bash
git -C "/Users/chris/Store/Coding Projects/FAI/fai-studio" push -u origin feat/corpus-grammar-engine
```

- [ ] **Step 2: Clone locally and install**

```bash
git clone https://github.com/mccaffc/fai-studio.git ~/fai-studio-dev
cd ~/fai-studio-dev && git checkout feat/corpus-grammar-engine && npm ci
```

- [ ] **Step 3: Verify existing tests pass**

Run: `cd ~/fai-studio-dev && npm test`
Expected: all existing suites (engine, flatten-core, editor) PASS. If not, stop and report — don't build on a red base.

---

### Task 1: Vendor corpus reference data

**Files:**
- Create: `corpus/reference/banners/*.svg` (50), `corpus/reference/tiles/**/*.svg` (141), `corpus/reference/tiles-manifest.json`

**Interfaces:**
- Produces: stable in-repo paths all later tasks read. Manifest JSON shape (from tiles-manifest-v2): array of `{ id, filename, shape_family, visual_weight, edge_coverage: {top,right,bottom,left}, dominant_direction, fg_centroid, path_count }`.

- [ ] **Step 1: Copy data from the Store mount**

```bash
cd ~/fai-studio-dev
mkdir -p corpus/reference
cp -R "/Users/chris/Store/Coding Projects/FAI/FAI Brand/04-Illustrations/output/banners-clean" corpus/reference/banners
cp -R "/Users/chris/Store/Coding Projects/FAI/FAI Brand/04-Illustrations/output/shapes-clean" corpus/reference/tiles
cp "/Users/chris/Store/Coding Projects/FAI/FAI Brand/04-Illustrations/tiles-manifest-v2.json" corpus/reference/tiles-manifest.json
```

- [ ] **Step 2: Sanity-check counts**

Run: `ls corpus/reference/banners | wc -l && find corpus/reference/tiles -name '*.svg' | wc -l`
Expected: `50` and `141` (if tiles count differs slightly, e.g. an orphan `Clear.svg`, note it in the commit message — do not silently drop files).

- [ ] **Step 3: Commit**

```bash
git add corpus/reference && git commit -m "corpus: vendor canonical banners, tile library, manifest as reference data"
```

---

### Task 2: Corpus schema

**Files:**
- Create: `tools/mine/schema.ts`

**Interfaces:**
- Produces (all later tasks import from here):

```typescript
export const SCHEMA_VERSION = 1;

export type Hex = string; // '#RRGGBB' uppercase

export interface CellRecon {
  col: number;              // 0..5
  row: number;              // 0..2
  ground: Hex;              // resolved backing color of this cell
  kind: 'tile' | 'plain' | 'freeform' | 'review';
  tile?: string;            // manifest id, when kind==='tile'
  rotation?: 0 | 90 | 180 | 270;
  flip?: boolean;           // horizontal mirror before rotation
  ink?: Hex;                // dominant foreground color
  inks?: Hex[];             // all foreground colors present
  score?: number;           // IoU of the accepted match
  candidates?: { tile: string; rotation: number; flip: boolean; score: number }[]; // top 3, for review
}

export interface FormGroup {
  id: string;               // e.g. '009-form-1'
  kind: 'run' | 'figure' | 'frieze';
  cells: [number, number][]; // [col,row]
  family?: string;          // shape_family when tile-based
  ink: Hex;
}

export interface BannerRecon {
  id: string;               // '009'
  width: 1920; height: 960; cols: 6; rows: 3;
  ground: Hex;              // full-canvas ground
  cells: CellRecon[];       // always 18, row-major
  forms: FormGroup[];
  matchRate: number;        // fraction of non-plain cells with kind==='tile'
}

export interface Corpus {
  schemaVersion: number;
  minedAt: string;          // ISO date, passed in by CLI (never Date.now() in lib code)
  banners: BannerRecon[];
}
```

- [ ] **Step 1: Write the file exactly as above** (it is pure types + one const; no test needed beyond compilation)

- [ ] **Step 2: Verify it compiles**

Run: `cd ~/fai-studio-dev && npx tsc -p tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add tools/mine/schema.ts && git commit -m "mine: corpus.json schema v1"
```

---

### Task 3: SVG parsing + rasterization utilities  **[Delegate: Codex]**

**Files:**
- Create: `tools/mine/svg.ts`, `tools/mine/raster.ts`
- Test: `test/mine/svg.test.ts`, `test/mine/raster.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:

```typescript
// svg.ts
export interface SvgElement {
  kind: 'rect' | 'path' | 'circle' | 'ellipse';
  fill: string;                    // normalized '#RRGGBB' uppercase; 'none' preserved
  fillRule?: 'nonzero' | 'evenodd';
  // rect:
  x?: number; y?: number; w?: number; h?: number;
  // circle/ellipse:
  cx?: number; cy?: number; r?: number; rx?: number; ry?: number;
  // path:
  d?: string;
}
export function parseSvgElements(svgText: string): { width: number; height: number; elements: SvgElement[] };
// - Parses via jsdom. Walks document order (paint order). Ignores <defs>, <clipPath> content.
// - Resolves fill from attribute or inline style. Normalizes named/rgb()/short-hex to '#RRGGBB' uppercase.
// - Elements with fill 'none' are kept (stroke-only tiles like frame/diamond) — callers may skip them.
// - Flattened banners have no transforms; if a transform IS encountered, throw (fail loud, not wrong).

// raster.ts
export interface Viewport { x: number; y: number; w: number; h: number; }
export function rasterizeMask(
  elements: SvgElement[],
  viewport: Viewport,      // source-space region to render
  size: number,            // output is size×size, e.g. 64
  isForeground: (el: SvgElement) => boolean,
): Uint8Array;             // size*size bytes, 1 = foreground pixel, 0 = not
// - node-canvas; ctx.antialias = 'none'; foreground painted as 1s in paint order;
//   elements where isForeground() is false paint 0s OVER prior 1s (they occlude — paint order matters).
// - path via new Path2D(d) with fillRule; rect/circle/ellipse via ctx primitives.
export function maskIoU(a: Uint8Array, b: Uint8Array): number;
// - intersection/union over 1-pixels. Both empty → 1. One empty → 0.
export function maskFillRatio(a: Uint8Array): number; // fraction of 1s
```

- [ ] **Step 1: Write failing tests**

```typescript
// test/mine/svg.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';

describe('parseSvgElements', () => {
  it('parses banner 009: dimensions, ground rect first, normalized fills', () => {
    const text = readFileSync('corpus/reference/banners/009.svg', 'utf8');
    const { width, height, elements } = parseSvgElements(text);
    expect(width).toBe(1920); expect(height).toBe(960);
    const first = elements[0];
    expect(first.kind).toBe('rect');
    expect(first.fill).toBe('#121212');
    expect(elements.length).toBeGreaterThan(50);
    for (const el of elements) if (el.fill !== 'none') expect(el.fill).toMatch(/^#[0-9A-F]{6}$/);
  });
  it('preserves paint order (cell ground rect before its foreground paths)', () => {
    const text = readFileSync('corpus/reference/banners/009.svg', 'utf8');
    const { elements } = parseSvgElements(text);
    const smoke = elements.findIndex(e => e.kind === 'rect' && e.fill === '#F3F3F3');
    expect(smoke).toBeGreaterThan(0);
    expect(elements[smoke + 1].kind).toBe('path'); // 009's stripes follow their ground rect
  });
});

// test/mine/raster.test.ts
import { describe, it, expect } from 'vitest';
import { rasterizeMask, maskIoU, maskFillRatio } from '../../tools/mine/raster';
import type { SvgElement } from '../../tools/mine/svg';

const rect = (x: number, y: number, w: number, h: number, fill: string): SvgElement =>
  ({ kind: 'rect', fill, x, y, w, h });

describe('rasterizeMask', () => {
  it('rasterizes a half-filled square to ~0.5 fill ratio', () => {
    const m = rasterizeMask([rect(0, 0, 100, 200, '#FF4F00')], { x: 0, y: 0, w: 200, h: 200 }, 64, () => true);
    expect(maskFillRatio(m)).toBeCloseTo(0.5, 1);
  });
  it('later non-foreground elements occlude earlier foreground', () => {
    const els = [rect(0, 0, 200, 200, '#FF4F00'), rect(0, 0, 200, 100, '#121212')];
    const m = rasterizeMask(els, { x: 0, y: 0, w: 200, h: 200 }, 64, el => el.fill === '#FF4F00');
    expect(maskFillRatio(m)).toBeCloseTo(0.5, 1);
  });
  it('viewport crops source space', () => {
    const m = rasterizeMask([rect(0, 0, 320, 320, '#FF4F00')], { x: 320, y: 0, w: 320, h: 320 }, 64, () => true);
    expect(maskFillRatio(m)).toBe(0);
  });
});

describe('maskIoU', () => {
  it('identical masks → 1; disjoint → 0; both empty → 1', () => {
    const a = new Uint8Array([1, 1, 0, 0]), b = new Uint8Array([1, 1, 0, 0]);
    const c = new Uint8Array([0, 0, 1, 1]), z = new Uint8Array(4);
    expect(maskIoU(a, b)).toBe(1);
    expect(maskIoU(a, c)).toBe(0);
    expect(maskIoU(z, new Uint8Array(4))).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail** — `npx vitest run test/mine/svg.test.ts test/mine/raster.test.ts` → FAIL (modules don't exist).

- [ ] **Step 3: Implement `svg.ts` and `raster.ts` to the interface above.** Implementation notes: jsdom `new JSDOM(text, {contentType:'image/svg+xml'})`; walk `document.documentElement` children recursively in order, skipping `defs`/`clipPath`/`mask` subtrees; color normalization handles `#rgb`, `#rrggbb`, `rgb(r,g,b)`, and the named colors `white`/`black` only (corpus uses hexes; throw on anything else — fail loud). For raster: create canvas `size×size`, `ctx.antialias='none'`, `ctx.scale(size/viewport.w, size/viewport.h)`, `ctx.translate(-viewport.x, -viewport.y)`; paint foreground els in `#FFFFFF`, non-foreground in `#000000`, onto black; read back pixels, mask = red channel > 127.

- [ ] **Step 4: Run tests, verify they pass** — same command → PASS.

- [ ] **Step 5: Commit** — `git add tools/mine/svg.ts tools/mine/raster.ts test/mine/ && git commit -m "mine: svg parsing + mask rasterization utilities"`

---

### Task 4: Cell segmentation

**Files:**
- Create: `tools/mine/cells.ts`
- Test: `test/mine/cells.test.ts`

**Interfaces:**
- Consumes: `parseSvgElements` (Task 3), `SvgElement`.
- Produces:

```typescript
export interface CellSlice {
  col: number; row: number;
  ground: string;            // resolved backing hex for this cell
  foreground: SvgElement[];  // elements (paint order) intersecting this cell, painted after its ground
  inks: string[];            // distinct fills in foreground, most-covering first (by bbox area within cell)
}
export function segmentCells(
  parsed: { width: number; height: number; elements: SvgElement[] },
  grid?: { cols: number; rows: number; cellPx: number },  // default {6,3,320}
): { ground: string; cells: CellSlice[] };
// Rules:
// - Global ground = fill of elements[0] when it is a rect covering the full canvas; else throw.
// - A "cell ground rect" is a rect exactly covering one cell (x,y multiples of cellPx, w=h=cellPx).
//   Cell ground = fill of the LAST such rect for that cell; default = global ground.
// - Foreground of a cell = elements after its ground rect (in paint order) whose bbox intersects
//   the cell's box with area > 1px². Elements spanning multiple cells appear in each.
// - Bbox for paths: parse absolute coordinates from `d` (numbers after commands; flattened corpus
//   paths use absolute commands — verify and throw on relative commands other than in arcs' flags).
```

- [ ] **Step 1: Write failing tests**

```typescript
// test/mine/cells.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';
import { segmentCells } from '../../tools/mine/cells';

describe('segmentCells on banner 009', () => {
  const parsed = parseSvgElements(readFileSync('corpus/reference/banners/009.svg', 'utf8'));
  const { ground, cells } = segmentCells(parsed);
  it('global ground is Cod Gray; 18 cells row-major', () => {
    expect(ground).toBe('#121212');
    expect(cells).toHaveLength(18);
    expect([cells[0].col, cells[0].row]).toEqual([0, 0]);
    expect([cells[17].col, cells[17].row]).toEqual([5, 2]);
  });
  it('cell (0,0) has Smoke White ground with Cod Gray stripe foreground', () => {
    const c = cells.find(c => c.col === 0 && c.row === 0)!;
    expect(c.ground).toBe('#F3F3F3');
    expect(c.inks).toContain('#121212');
    expect(c.foreground.length).toBeGreaterThanOrEqual(5); // the 5 stripe bands
  });
  it('cell (0,2) is the arc cell (Smoke White ground, gray arcs)', () => {
    const c = cells.find(c => c.col === 0 && c.row === 2)!;
    expect(c.ground).toBe('#F3F3F3');
    expect(c.foreground.some(e => e.kind === 'path')).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/mine/cells.test.ts`

- [ ] **Step 3: Implement `cells.ts`** per the rules in the interface block. Path bbox: regex all coordinate pairs from `d`, min/max them (curve control points inflate bboxes slightly — acceptable: bbox is only used for cell assignment, and rasterization does true clipping later).

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit** — `git add tools/mine/cells.ts test/mine/cells.test.ts && git commit -m "mine: banner → per-cell ground + foreground segmentation"`

---

### Task 5: Tile matching  **[Delegate: Codex]**

**Files:**
- Create: `tools/mine/tile-match.ts`
- Test: `test/mine/tile-match.test.ts`

**Interfaces:**
- Consumes: `parseSvgElements`, `rasterizeMask`, `maskIoU`, `maskFillRatio` (Task 3); `CellSlice` (Task 4); manifest JSON (Task 1).
- Produces:

```typescript
export interface TileMaskEntry { tile: string; rotation: 0|90|180|270; flip: boolean; mask: Uint8Array; fillRatio: number; }
export function buildTileMaskLibrary(tilesDir: string, manifestPath: string, size?: number /*=64*/): TileMaskEntry[];
// - For each manifest tile: parse its SVG (200×200), compute its foreground mask.
//   Tile foreground rule: elements whose fill is NOT the tile's own background. A tile's background =
//   fill of a full-tile rect at index 0 if present, else 'none' (then every filled element is foreground).
// - 8 variants per tile (4 rotations × flip). Rotate/flip the MASK arrays (pure array ops — cheaper
//   and exacter than re-rasterizing through transforms).
// - Skip fill:'none' stroke-only elements; record the tile id in a `skipped` console.warn.

export interface CellMatch { kind: 'tile'|'plain'|'freeform'|'review';
  tile?: string; rotation?: 0|90|180|270; flip?: boolean; score?: number;
  candidates: { tile: string; rotation: number; flip: boolean; score: number }[]; }
export const THRESHOLDS = { accept: 0.92, review: 0.75, plainMax: 0.005 };
export function matchCell(cellMask: Uint8Array, library: TileMaskEntry[]): CellMatch;
// - If maskFillRatio(cellMask) < plainMax → 'plain'.
// - Prefilter: only score library entries with |fillRatio − cellFillRatio| ≤ 0.15 (cheap gate).
// - Best IoU ≥ accept → 'tile'. In [review, accept) → 'review' with top-3 candidates.
//   Below review → 'freeform' with top-3 candidates.
```

- [ ] **Step 1: Write failing tests**

```typescript
// test/mine/tile-match.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSvgElements } from '../../tools/mine/svg';
import { rasterizeMask } from '../../tools/mine/raster';
import { segmentCells } from '../../tools/mine/cells';
import { buildTileMaskLibrary, matchCell, THRESHOLDS } from '../../tools/mine/tile-match';

let lib: ReturnType<typeof buildTileMaskLibrary>;
beforeAll(() => { lib = buildTileMaskLibrary('corpus/reference/tiles', 'corpus/reference/tiles-manifest.json'); });

describe('buildTileMaskLibrary', () => {
  it('has 8 variants per renderable tile', () => {
    expect(lib.length % 8).toBe(0);
    expect(lib.length / 8).toBeGreaterThan(120); // most of the 141 render
  });
});

describe('matchCell — synthetic exact recovery', () => {
  it('recovers a known tile placed in a cell at 90°', () => {
    const entry = lib.find(e => e.rotation === 90 && !e.flip && e.fillRatio > 0.2 && e.fillRatio < 0.8)!;
    const m = matchCell(entry.mask, lib);
    expect(m.kind).toBe('tile');
    expect(m.score).toBeGreaterThanOrEqual(THRESHOLDS.accept);
    expect(`${m.tile}/${m.rotation}/${m.flip}`).toBe(`${entry.tile}/${entry.rotation}/${entry.flip}`);
  });
});

describe('matchCell — real banner cells', () => {
  it('matches banner 009 cell (0,0) to a lines-family tile', () => {
    const parsed = parseSvgElements(readFileSync('corpus/reference/banners/009.svg', 'utf8'));
    const { cells } = segmentCells(parsed);
    const c = cells.find(c => c.col === 0 && c.row === 0)!;
    const mask = rasterizeMask(c.foreground, { x: 0, y: 0, w: 320, h: 320 }, 64,
      el => el.fill !== c.ground);
    const m = matchCell(mask, lib);
    expect(['tile', 'review']).toContain(m.kind);   // must not be freeform
    expect(m.candidates[0].score).toBeGreaterThan(THRESHOLDS.review);
  });
  it('classifies an empty cell as plain', () => {
    const m = matchCell(new Uint8Array(64 * 64), lib);
    expect(m.kind).toBe('plain');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx vitest run test/mine/tile-match.test.ts`

- [ ] **Step 3: Implement `tile-match.ts`.** Mask rotation (size s, index i=y*s+x): 90° → `(x,y) ← (y, s-1-x)` source; 180° → `(s-1-x, s-1-y)`; 270° → `(s-1-y, x)`; flip → `(s-1-x, y)` applied before rotation. Dedupe symmetric variants (identical masks) keeping the lowest rotation/flip — prevents ambiguous candidates lists.

- [ ] **Step 4: Run, verify PASS.** If the 009 (0,0) real-cell test lands in `review` rather than `tile`, that is acceptable — record actual best score in a comment; threshold tuning is Task 9's job, not this task's.

- [ ] **Step 5: Commit** — `git add tools/mine/tile-match.ts test/mine/tile-match.test.ts && git commit -m "mine: IoU tile matching over rotation/flip mask library"`

---

### Task 6: Mining CLI (`corpus.json`)

**Files:**
- Create: `tools/mine/mine.ts`
- Modify: `package.json` (add script `"mine": "esbuild tools/mine/mine.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-tools/mine.mjs && node dist-tools/mine.mjs"`)
- Modify: `.gitignore` (add `dist-tools/`)

**Interfaces:**
- Consumes: everything above; `corpus/overrides.json` (may not exist yet).
- Produces: `corpus/corpus.json` matching `Corpus` schema (Task 2); stats table on stdout.

- [ ] **Step 1: Implement `mine.ts`**

```typescript
// Orchestration (no unit test — its correctness is proven by Task 8's validation sheet;
// but it must be deterministic: same inputs → byte-identical corpus.json except minedAt):
// 1. lib = buildTileMaskLibrary('corpus/reference/tiles', 'corpus/reference/tiles-manifest.json')
// 2. overrides = JSON.parse(corpus/overrides.json) if exists:
//    { [bannerId: string]: { [colRow: string /* "c,r" */]: Partial<CellRecon> } }
// 3. For each corpus/reference/banners/NNN.svg (sorted):
//    parse → segmentCells → per cell: rasterize fg mask (viewport = cell box, size 64,
//    isForeground = el.fill !== cell.ground) → matchCell → CellRecon
//    (ink = cell.inks[0]; inks = cell.inks; apply override if present, marking kind from override).
// 4. forms: [] for now (Task 7 fills in).
// 5. matchRate = tiles / (18 − plains). Write corpus/corpus.json (2-space indent, keys in schema order).
// 6. Print stats: per-banner matchRate; totals by kind; top-10 most-used tiles; per-family counts.
// CLI: node dist-tools/mine.mjs [--banner NNN] (single-banner mode for debugging).
```

- [ ] **Step 2: Run it**

Run: `npm run mine`
Expected: `corpus/corpus.json` written; stats print. **Record the overall numbers in the commit message** (e.g. "match rate X% tile / Y% review / Z% freeform of non-plain cells"). Any number is acceptable at this stage — this is the honest baseline Task 9 improves on.

- [ ] **Step 3: Determinism check**

Run: `npm run mine && cp corpus/corpus.json /tmp/a.json && npm run mine && diff <(jq 'del(.minedAt)' /tmp/a.json) <(jq 'del(.minedAt)' corpus/corpus.json) && echo DETERMINISTIC`
Expected: `DETERMINISTIC`.

- [ ] **Step 4: Commit** — `git add tools/mine/mine.ts package.json .gitignore corpus/corpus.json && git commit -m "mine: CLI — corpus.json baseline (stats in body)"`

- [ ] **Step 5: Dispatch Gemini review (per Delegation Workflow)** — independent read of `tools/mine/*.ts` for correctness risks (paint-order handling, mask math, threshold logic) + sanity of the stats. Fully self-contained prompt; include file contents. Fold verdict into fixes before Task 7 if substantive.

---

### Task 7: Multi-cell form detection

**Files:**
- Create: `tools/mine/forms.ts`
- Test: `test/mine/forms.test.ts`
- Modify: `tools/mine/mine.ts` (call `detectForms`, fill `BannerRecon.forms`)

**Interfaces:**
- Consumes: `BannerRecon` (cells filled), manifest entries (`edge_coverage`, `shape_family`).
- Produces:

```typescript
export function detectForms(banner: BannerRecon, manifest: ManifestTile[]): FormGroup[];
// Union-find over the 18 cells. Two ADJACENT cells join when:
//  (a) both kind==='tile', same ink, and the shared edge is "active" on both sides —
//      edge_coverage on the facing edges (after applying the cell's rotation/flip to the
//      manifest's edge_coverage orientation) ≥ 0.25 on both; OR
//  (b) both kind==='freeform' and share an ink (organic figures span cells); OR
//  (c) both are the SAME tile+rotation pattern repeating in a row (frieze detection):
//      same tile, same row, same ink, adjacent columns.
// Groups of size ≥ 2 become FormGroups:
//  kind = 'frieze' if rule (c) built it; 'figure' if any member is freeform; else 'run'.
//  family = dominant shape_family among members (undefined for pure-freeform figures).
// Edge-coverage rotation: rotating 90° maps [top,right,bottom,left] → [left,top,right,bottom];
// flip swaps left/right before rotation.
```

- [ ] **Step 1: Write failing tests**

```typescript
// test/mine/forms.test.ts
import { describe, it, expect } from 'vitest';
import { detectForms } from '../../tools/mine/forms';
import type { BannerRecon, CellRecon } from '../../tools/mine/schema';

const cell = (col: number, row: number, over: Partial<CellRecon> = {}): CellRecon =>
  ({ col, row, ground: '#121212', kind: 'plain', ...over });

const manifest = [
  { id: 'lines-01', shape_family: 'lines', edge_coverage: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 } },
  { id: 'square-01', shape_family: 'square', edge_coverage: { top: 0, right: 0, bottom: 0, left: 0 } },
] as any;

const banner = (cells: CellRecon[]): BannerRecon =>
  ({ id: 'T', width: 1920, height: 960, cols: 6, rows: 3, ground: '#121212',
     cells, forms: [], matchRate: 1 });

describe('detectForms', () => {
  it('joins adjacent active-edge same-ink tiles into a run', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(2, 0, { kind: 'tile', tile: 'square-01', rotation: 0, flip: false, ink: '#FF4F00' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms).toHaveLength(1);
    expect(forms[0].cells).toEqual([[0, 0], [1, 0]]);
    expect(['run', 'frieze']).toContain(forms[0].kind);
    expect(forms[0].family).toBe('lines');
  });
  it('does not join different inks even with active edges', () => {
    const cells = [
      cell(0, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#F3F3F3' }),
      cell(1, 0, { kind: 'tile', tile: 'lines-01', rotation: 0, flip: false, ink: '#FF4F00' }),
    ];
    expect(detectForms(banner(cells), manifest)).toHaveLength(0);
  });
  it('groups adjacent freeform cells sharing ink as a figure', () => {
    const cells = [
      cell(2, 1, { kind: 'freeform', inks: ['#FF4F00'], ink: '#FF4F00' }),
      cell(3, 1, { kind: 'freeform', inks: ['#FF4F00'], ink: '#FF4F00' }),
    ];
    const forms = detectForms(banner(cells), manifest);
    expect(forms).toHaveLength(1);
    expect(forms[0].kind).toBe('figure');
  });
});
```

- [ ] **Step 2: Run, verify FAIL.** — `npx vitest run test/mine/forms.test.ts`

- [ ] **Step 3: Implement `forms.ts`** (union-find + the three join rules + edge-orientation transform).

- [ ] **Step 4: Run, verify PASS. Re-run `npm run mine`** so `corpus.json` gains forms; skim stats (forms per banner should average ≥ 1 given the corpus's connectedness — if ~0, the edge-orientation transform is likely wrong; debug before committing).

- [ ] **Step 5: Commit** — `git add tools/mine/forms.ts test/mine/forms.test.ts tools/mine/mine.ts corpus/corpus.json && git commit -m "mine: multi-cell form detection (runs, friezes, figures)"`

---

### Task 8: Validation contact sheet  **[Claude only — visual gate]**

**Files:**
- Create: `tools/mine/validate-sheet.ts`
- Modify: `package.json` (add `"mine:validate": "esbuild tools/mine/validate-sheet.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-tools/validate-sheet.mjs && node dist-tools/validate-sheet.mjs"`)

**Interfaces:**
- Consumes: `corpus/corpus.json`, reference banners + tiles.
- Produces: `corpus/validation/sheet-1.png … sheet-N.png` (10 banners per sheet: each row = original | reconstruction | per-cell score heat strip), plus per-banner whole-image IoU printed and written to `corpus/validation/report.json`.

- [ ] **Step 1: Implement `validate-sheet.ts`**

```typescript
// Reconstruction: for each banner in corpus.json, build an SVG:
//   global ground rect → per-cell ground rects (where ≠ global) → per cell kind==='tile':
//   <g transform="translate(cx,cy) rotate(r,160,160) [scale(-1,1) for flip]"> tile paths,
//   recolored: tile background → transparent (cell ground shows), tile foreground → cell ink.
//   kind 'freeform'/'review': copy the ORIGINAL banner's foreground elements for those cells
//   (so the sheet shows what mining could NOT explain in context, tinted 50% magenta overlay).
// Render original & reconstruction at 640×320 each via rasterizeMask-style canvas draw
// (full color here, not masks — reuse svg.ts elements + node-canvas fills).
// Whole-image agreement: per-pixel exact-color match ratio (colors are flat brand hexes).
// Sheet: node-canvas montage, 10 rows × (original | recon | heat strip), PNG out.
```

- [ ] **Step 2: Run it** — `npm run mine:validate` → sheets + report written.

- [ ] **Step 3: CLAUDE VISUAL REVIEW (the P0 aesthetic gate — never delegated).** Read every sheet image. Judge: does each reconstruction *read as the same banner*? Which cells consistently fail (magenta), and are they figures (expected) or matcher bugs (not expected)? Write findings into `corpus/validation/REVIEW.md` — per-banner verdict (faithful / needs-overrides / matcher-bug) + the list of cells feeding Task 9.

- [ ] **Step 4: Commit** — `git add tools/mine/validate-sheet.ts package.json corpus/validation && git commit -m "mine: validation sheets + review findings"`

---

### Task 9: Threshold tuning + hand labels → final corpus  **[Claude only]**

**Files:**
- Create: `corpus/overrides.json`
- Modify: `tools/mine/tile-match.ts` (THRESHOLDS, only if REVIEW.md justifies), `corpus/corpus.json`, `corpus/validation/*`

**Interfaces:**
- Produces: final `corpus/corpus.json` — the P0 deliverable P1 builds on. Every cell resolved to `tile`/`plain`/`freeform` (no `review` remaining); figures marked; per-banner agreement ≥ 0.95 whole-image match OR explicitly annotated in REVIEW.md why lower is correct (e.g. heavy freeform figure banners).

- [ ] **Step 1: For each REVIEW.md flagged cell:** inspect candidates in corpus.json; where a candidate is visually right but under-threshold, hand-label in `corpus/overrides.json` (`{"009": {"3,1": {"kind":"tile","tile":"circle-04","rotation":90,"flip":false}}}`); where genuinely hand-drawn, mark `{"kind":"freeform"}`.

- [ ] **Step 2: Re-run** — `npm run mine && npm run mine:validate` — iterate Steps 1–2 until the Produces bar is met. Each iteration: Claude re-reads the sheets (visual gate every pass).

- [ ] **Step 3: Verify no `review` cells remain**

Run: `jq '[.banners[].cells[] | select(.kind == "review")] | length' corpus/corpus.json`
Expected: `0`

- [ ] **Step 4: Full test suite green** — `npm test` → PASS (all suites, old and new).

- [ ] **Step 5: Commit + push**

```bash
git add corpus/ tools/mine/ && git commit -m "mine: final P0 corpus — all 50 banners reconstructed and validated"
git push origin feat/corpus-grammar-engine
```

---

## Self-review notes

- Spec coverage: §5a mining (Tasks 3–6), validation sheet (Task 8), hand-correction path (§13 risk → Task 9), corpus.json schema (§10 mine interface → Task 2), vendored ground truth enabling §11 calibration tests later (Task 1). P1+ (grammar/renderer/score/studio) intentionally deferred to the next plan, seeded by this corpus.
- Types checked for consistency across tasks (CellRecon/CellMatch field names align; THRESHOLDS shared).
- No placeholders: every code step carries real code or a complete, decision-free implementation contract.
