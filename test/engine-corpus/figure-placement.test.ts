/**
 * figure-placement.test.ts - Task P3.3 placement/render coverage.
 *
 * These tests cover sampler-side figure asset assignment, renderer-side asset
 * placement, program palette interplay, and recolor geometry freeze for figure
 * metadata. Generated data integrity stays in figures.test.ts.
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
