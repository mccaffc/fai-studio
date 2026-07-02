/**
 * figure-placement.test.ts - Task P3.3 + P4.0 placement/render coverage.
 *
 * These tests cover sampler-side figure asset assignment, renderer-side asset
 * placement, program palette interplay, recolor geometry freeze, and (P4.0)
 * integer upscaling of figure assets + hero region bias.
 */

import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import { FIGURES, type FigureAsset, type TileElement } from '../../src/engine/corpus/data/figures.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import { renderPlanSvg } from '../../src/engine/corpus/render.js';
import { generateBanner, recolorPlan, type CorpusResult } from '../../src/engine/corpus/index.js';
import { PROGRAMS } from '../../src/engine/corpus/programs.js';
import type { BannerPlan, CellPlan, EngineGrammar } from '../../src/engine/corpus/types.js';
import { assertProgramPaletteSvg } from './helpers.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const FIGURE_KNOBS = { template: 'figure-field', figures: true } as const;
const PROBE_SEEDS = Array.from({ length: 20 }, (_v, i) => 9100 + i);

function figureAnchors(plan: BannerPlan): CellPlan[] {
  return plan.cells.filter(cell => cell.figureId !== undefined);
}

function figureSignature(plan: BannerPlan): Array<{
  col: number;
  row: number;
  figureId?: string;
  figureAnchor?: boolean;
  figureSpan?: [number, number];
}> {
  return plan.cells
    .filter(cell => cell.figureId !== undefined || cell.figureAnchor !== undefined || cell.figureSpan !== undefined)
    .map(cell => ({
      col: cell.col,
      row: cell.row,
      figureId: cell.figureId,
      figureAnchor: cell.figureAnchor,
      figureSpan: cell.figureSpan,
    }));
}

function findSamplePlanWithFigure(): { seed: number; plan: BannerPlan; anchor: CellPlan } {
  for (let seed = 9000; seed < 9300; seed += 1) {
    const plan = samplePlan(GRAMMAR, seed, FIGURE_KNOBS);
    const anchor = figureAnchors(plan)[0];
    if (anchor) return { seed, plan, anchor };
  }
  throw new Error('No sampled figure-field plan with a placed figure in seed range 9000..9299');
}

function findGeneratedResultWithFigure(program?: keyof typeof PROGRAMS): { result: CorpusResult; anchor: CellPlan } {
  for (let seed = 9400; seed < 9800; seed += 1) {
    const result = generateBanner({ seed, ...FIGURE_KNOBS, program, maxAttempts: 1 });
    const anchor = figureAnchors(result.plan)[0];
    if (anchor) return { result, anchor };
  }
  throw new Error(`No generated figure-field result with a placed figure${program ? ` for ${program}` : ''}`);
}

function findFreeformFallbackPlan(): BannerPlan {
  for (let seed = 9900; seed < 10_100; seed += 1) {
    const plan = samplePlan(GRAMMAR, seed, FIGURE_KNOBS, []);
    if (plan.cells.some(cell => cell.kind === 'freeform')) {
      expect(figureAnchors(plan)).toHaveLength(0);
      return plan;
    }
  }
  throw new Error('No freeform fallback plan found with empty injected figure library');
}

function assertAnchorInBounds(plan: BannerPlan, anchor: CellPlan): void {
  expect(anchor.figureId, `anchor ${anchor.col},${anchor.row} figureId`).toEqual(expect.any(String));
  expect(anchor.figureAnchor, `anchor ${anchor.col},${anchor.row} flag`).toBe(true);
  expect(anchor.figureSpan, `anchor ${anchor.col},${anchor.row} span`).toBeDefined();
  const [spanW, spanH] = anchor.figureSpan!;
  expect(spanW).toBeGreaterThanOrEqual(1);
  expect(spanH).toBeGreaterThanOrEqual(1);
  expect(anchor.col + spanW).toBeLessThanOrEqual(plan.cols);
  expect(anchor.row + spanH).toBeLessThanOrEqual(plan.rows);
  for (let row = anchor.row; row < anchor.row + spanH; row += 1) {
    for (let col = anchor.col; col < anchor.col + spanW; col += 1) {
      const covered = plan.cells.find(cell => cell.col === col && cell.row === row);
      expect(covered?.kind, `figure span covered non-freeform cell at ${col},${row}`).toBe('freeform');
    }
  }
}

function syntheticFigurePlan(asset: FigureAsset): BannerPlan {
  const cells: CellPlan[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      if (col < asset.w && row < asset.h) {
        cells.push({
          col,
          row,
          ground: '#F3F3F3',
          kind: 'freeform',
          ink: '#FF4F00',
          inks: ['#FF4F00'],
          ...(col === 0 && row === 0
            ? { figureId: asset.id, figureAnchor: true, figureSpan: [asset.w, asset.h] as [number, number] }
            : {}),
        });
      } else {
        cells.push({ col, row, ground: '#F3F3F3', kind: 'plain' });
      }
    }
  }
  return {
    id: 'synthetic-figure',
    width: 1920,
    height: 960,
    cols: 6,
    rows: 3,
    ground: '#F3F3F3',
    cells,
    forms: [],
    matchRate: 1,
    templateId: 'figure-field',
  };
}

function blobPathPrefix(cell: CellPlan, cellPx: number): string {
  const r = (cellPx * 0.70) / 2;
  const c = cellPx / 2;
  const cx = cell.col * cellPx + c;
  const cy = cell.row * cellPx + c;
  return `M ${cx} ${cy - r}`;
}

function fgPath(asset: FigureAsset): string {
  const el = asset.elements.find((candidate): candidate is TileElement & { kind: 'path'; d: string } =>
    candidate.kind === 'path' && candidate.role === 'fg' && typeof candidate.d === 'string' && candidate.d.length > 0,
  );
  if (!el) throw new Error(`No foreground path in ${asset.id}`);
  return el.d;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pathFillRegex(pathData: string, fill: string): RegExp {
  return new RegExp(`<path d="${escapeRegExp(pathData)}"(?: fill-rule="[^"]+")? fill="${escapeRegExp(fill)}"`);
}

describe('figure placement', () => {
  it('is deterministic for the same seed and knobs', () => {
    const { seed, plan } = findSamplePlanWithFigure();
    const again = samplePlan(GRAMMAR, seed, FIGURE_KNOBS);
    expect(figureSignature(again)).toEqual(figureSignature(plan));
    expect(figureAnchors(again).length).toBeGreaterThan(0);
  });

  it('places figures in at least 60% of 20 figure-field plans with freeform regions', () => {
    let plansWithFreeform = 0;
    let plansWithFigure = 0;
    const assetIds = new Set(FIGURES.map(asset => asset.id));

    for (const seed of PROBE_SEEDS) {
      const plan = samplePlan(GRAMMAR, seed, FIGURE_KNOBS);
      const hasFreeform = plan.cells.some(cell => cell.kind === 'freeform');
      if (!hasFreeform) continue;
      plansWithFreeform += 1;
      const anchors = figureAnchors(plan);
      if (anchors.length > 0) plansWithFigure += 1;
      for (const anchor of anchors) {
        assertAnchorInBounds(plan, anchor);
        expect(assetIds.has(anchor.figureId!), `unknown figure id ${anchor.figureId}`).toBe(true);
      }
    }

    expect(plansWithFreeform).toBeGreaterThan(0);
    const rate = plansWithFigure / plansWithFreeform;
    console.log(
      `[figure-placement.test] figure placement rate ${plansWithFigure}/${plansWithFreeform} = ${rate.toFixed(2)}`,
    );
    expect(rate).toBeGreaterThanOrEqual(0.6);
  });

  it('never spans over non-freeform cells across varied figure-field seeds', () => {
    let anchorsChecked = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const plan = samplePlan(GRAMMAR, seed, FIGURE_KNOBS);
      for (const anchor of figureAnchors(plan)) {
        assertAnchorInBounds(plan, anchor);
        anchorsChecked += 1;
      }
    }
    expect(anchorsChecked).toBeGreaterThan(0);
  });
});

describe('figure rendering', () => {
  it('renders one asset group from the anchor and no blob for covered non-anchor cells', () => {
    const asset = FIGURES.find(candidate => candidate.w === 2 && candidate.h === 1) ?? FIGURES[0]!;
    const plan = syntheticFigurePlan(asset);
    const nonAnchor = plan.cells.find(cell => cell.kind === 'freeform' && !cell.figureId)!;
    const svg = renderPlanSvg(plan, TILES, { cellPx: 100, nodeIds: true });

    expect(svg.match(/<g[^>]*data-figure-id="/g) ?? []).toHaveLength(1);
    expect(svg).toContain(`data-figure-id="${asset.id}"`);
    expect(svg).toContain(`d="${fgPath(asset)}"`);
    expect(svg).not.toContain(`d="${blobPathPrefix(nonAnchor, 100)} C`);
  });

  it('falls back to freeform blobs when the injected figure library is empty', () => {
    const plan = findFreeformFallbackPlan();
    const freeform = plan.cells.find(cell => cell.kind === 'freeform')!;
    const svg = renderPlanSvg(plan, TILES, { cellPx: 100 });
    expect(svg).toContain(`d="${blobPathPrefix(freeform, 100)} C`);
  });
});

describe('figure program and recolor interplay', () => {
  it('renders placed figure foreground elements in the Artificial Intelligence program hue', () => {
    const program = 'artificial-intelligence' as const;
    const { result, anchor } = findGeneratedResultWithFigure(program);
    const asset = FIGURES.find(candidate => candidate.id === anchor.figureId);
    expect(asset, `missing asset ${anchor.figureId}`).toBeDefined();

    const hue = PROGRAMS[program].hue;
    expect(result.svg).toMatch(pathFillRegex(fgPath(asset!), hue));
    assertProgramPaletteSvg(result.svg, hue, `program=${program} seed=${result.seed}`);
  });

  it('recolorPlan keeps figureId, figureAnchor, and figureSpan geometry frozen', () => {
    const { result } = findGeneratedResultWithFigure();
    const recolored = recolorPlan(result, '#FFA300');
    expect(figureSignature(recolored.plan)).toEqual(figureSignature(result.plan));
  });
});

// ---------------------------------------------------------------------------
// P4.0: Figure upscaling + hero-region bias
// ---------------------------------------------------------------------------

/** Build a synthetic plan with a freeform region of given span, assigning the asset at k=scale. */
function syntheticUpscalePlan(asset: FigureAsset, spanW: number, spanH: number): BannerPlan {
  const cells: CellPlan[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      if (col < spanW && row < spanH) {
        cells.push({
          col,
          row,
          ground: '#F3F3F3',
          kind: 'freeform',
          ink: '#FF4F00',
          inks: ['#FF4F00'],
          ...(col === 0 && row === 0
            ? { figureId: asset.id, figureAnchor: true, figureSpan: [spanW, spanH] as [number, number] }
            : {}),
        });
      } else {
        cells.push({ col, row, ground: '#F3F3F3', kind: 'plain' });
      }
    }
  }
  return {
    id: `synthetic-upscale-${spanW}x${spanH}`,
    width: 1920,
    height: 960,
    cols: 6,
    rows: 3,
    ground: '#F3F3F3',
    cells,
    forms: [],
    matchRate: 1,
    templateId: 'figure-field',
  };
}

/**
 * Parse the scale(sx, sy) from a figure <g … data-figure-id="…" transform="translate(…) scale(sx,sy)">.
 * Handles both attribute orderings. Returns [sx, sy] or null if no match.
 */
function parseFigureTransformScale(svg: string, assetId: string): [number, number] | null {
  const escaped = assetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // The renderer emits: <g data-node-id="…" data-figure-id="assetId" transform="translate(…) scale(sx,sy)">
  const re = new RegExp(`data-figure-id="${escaped}"[^>]+transform="[^"]*scale\\(([^,)]+),([^)]+)\\)"`);
  const m = re.exec(svg);
  if (!m) return null;
  return [parseFloat(m[1]!), parseFloat(m[2]!)];
}

describe('P4.0: figure upscaling', () => {
  it('integer upscale: 1×1 asset in 2×2 region renders with 2× scale vs 1×1 region', () => {
    // Use the first 1×1 asset in the library
    const asset1x1 = FIGURES.find(a => a.w === 1 && a.h === 1);
    if (!asset1x1) {
      // No 1×1 asset in the library — skip gracefully with an informational note
      console.log('[P4.0] No 1×1 figure asset found; upscale scale-factor test skipped.');
      return;
    }

    const CELL_PX = 100;

    // k=1: 1×1 region with 1×1 asset
    const plan1x1 = syntheticUpscalePlan(asset1x1, 1, 1);
    const svg1x1 = renderPlanSvg(plan1x1, TILES, { cellPx: CELL_PX, nodeIds: true });
    const scale1 = parseFigureTransformScale(svg1x1, asset1x1.id);
    expect(scale1, `no scale found in 1×1 svg for asset ${asset1x1.id}`).not.toBeNull();

    // k=2: 2×2 region with same 1×1 asset (upscaled)
    const plan2x2 = syntheticUpscalePlan(asset1x1, 2, 2);
    const svg2x2 = renderPlanSvg(plan2x2, TILES, { cellPx: CELL_PX, nodeIds: true });
    const scale2 = parseFigureTransformScale(svg2x2, asset1x1.id);
    expect(scale2, `no scale found in 2×2 svg for asset ${asset1x1.id}`).not.toBeNull();

    // The x-scale (and y-scale) for the 2×2 plan must be exactly 2× the 1×1 plan
    const ratio = scale2![0] / scale1![0];
    expect(ratio).toBeCloseTo(2, 5);
    expect(scale2![1] / scale1![1]).toBeCloseTo(2, 5);
  });

  it('chooseFigureAsset selects 1×1 asset at k=2 for 2×2 region when library has only 1×1 assets', () => {
    // Build a library with only 1×1 assets; sample figure-field with figures:true.
    // Find a seed where the placed anchor has figureSpan=[2,2] (upscaled).
    const lib1x1 = FIGURES.filter(a => a.w === 1 && a.h === 1);
    if (lib1x1.length === 0) {
      console.log('[P4.0] No 1×1 figure assets available; upscale sampler test skipped.');
      return;
    }

    let upscalePlacementFound = false;
    for (let seed = 8000; seed < 8500; seed += 1) {
      const plan = samplePlan(GRAMMAR, seed, { template: 'figure-field', figures: true }, lib1x1);
      const anchor = figureAnchors(plan)[0];
      if (!anchor) continue;
      // If span is 2×2 or larger and the asset is a 1×1, it must be an upscale placement
      const [sw, sh] = anchor.figureSpan ?? [0, 0];
      if (sw >= 2 && sh >= 2) {
        upscalePlacementFound = true;
        // Verify the figureId is from our lib1x1
        const isFrom1x1 = lib1x1.some(a => a.id === anchor.figureId);
        expect(isFrom1x1, `upscale anchor figureId=${anchor.figureId} not from 1×1 library`).toBe(true);
        break;
      }
    }
    expect(upscalePlacementFound, 'expected at least one upscale placement (span≥2×2 with 1×1-only library) in seeds 8000..8499').toBe(true);
  });

  it('is deterministic: same seed and knobs produce identical figure signature', () => {
    const { seed, plan } = findSamplePlanWithFigure();
    const again = samplePlan(GRAMMAR, seed, FIGURE_KNOBS);
    expect(figureSignature(again)).toEqual(figureSignature(plan));
  });

  it('hero batch: ≥1 upscaled-or-large (≥4 cells) placement across 20 figure-field seeds', () => {
    let largePlacements = 0;
    let totalWithFigure = 0;
    const cellCounts: number[] = [];

    for (const seed of PROBE_SEEDS) {
      const plan = samplePlan(GRAMMAR, seed, FIGURE_KNOBS);
      const anchors = figureAnchors(plan);
      for (const anchor of anchors) {
        totalWithFigure += 1;
        const [sw, sh] = anchor.figureSpan ?? [0, 0];
        const cells = sw * sh;
        cellCounts.push(cells);
        if (cells >= 4) largePlacements += 1;
      }
    }

    const largeRate = totalWithFigure > 0 ? largePlacements / totalWithFigure : 0;
    console.log(
      `[P4.0] hero batch: ${largePlacements} large (≥4-cell) placements out of ${totalWithFigure} total` +
      ` (rate=${largeRate.toFixed(2)}, cell distribution: ${JSON.stringify(cellCounts)})`,
    );
    // Informational — no hard gate on rate, but ≥1 large placement must exist
    expect(largePlacements, 'expected ≥1 large (≥4-cell) figure placement across 20 figure-field seeds').toBeGreaterThanOrEqual(1);
  });
});
