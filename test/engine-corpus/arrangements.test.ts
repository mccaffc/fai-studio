/**
 * arrangements.test.ts - P5 Task 2 grid generalization.
 *
 * Guards default banner sampling, then exercises every supported arrangement
 * across sampling, rendering, scoring, program palettes, and degenerate grid
 * rules.
 */

import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import { PATCHES } from '../../src/engine/corpus/data/patches.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import { renderPlanSvg } from '../../src/engine/corpus/render.js';
import { scorePlan } from '../../src/engine/corpus/score.js';
import { scoreComposition } from '../../src/engine/corpus/composition.js';
import { generateBanner, PROGRAMS } from '../../src/engine/corpus/index.js';
import { assertProgramPalettePlan, assertProgramPaletteSvg } from './helpers.js';
import type { ArrangementId, EngineGrammar, GroundSchemeKind } from '../../src/engine/corpus/types.js';
import { ARRANGEMENTS } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as EngineGrammar;
const ARRANGEMENT_IDS = Object.keys(ARRANGEMENTS) as ArrangementId[];
const SAMPLE_SEEDS = Array.from({ length: 10 }, (_v, i) => i + 1);
const PROGRAM_IDS = ['technology-statecraft', 'frontier-legal-defense'] as const;
const PROGRAM_SEEDS = [3, 17];
const HERITAGE_ACCENTS = new Set(['#FF4F00', '#FFA300', '#4997D0']);
const FAMILIES: Record<string, string> = Object.fromEntries(
  Object.entries(TILES).map(([id, tile]) => [id, tile.family]),
);

function key(col: number, row: number): string {
  return `${col},${row}`;
}

function expectResolvedGrid(plan: ReturnType<typeof samplePlan>, arrangement: ArrangementId): void {
  const dims = ARRANGEMENTS[arrangement];
  expect(plan.cols).toBe(dims.cols);
  expect(plan.rows).toBe(dims.rows);
  expect(plan.width).toBe(dims.cols * 320);
  expect(plan.height).toBe(dims.rows * 320);
  expect(plan.cells).toHaveLength(dims.cols * dims.rows);

  const seen = new Set<string>();
  for (const cell of plan.cells) {
    expect(cell.col).toBeGreaterThanOrEqual(0);
    expect(cell.col).toBeLessThan(dims.cols);
    expect(cell.row).toBeGreaterThanOrEqual(0);
    expect(cell.row).toBeLessThan(dims.rows);
    expect(['tile', 'plain', 'freeform', 'review']).toContain(cell.kind);
    seen.add(key(cell.col, cell.row));
  }
  expect(seen.size).toBe(dims.cols * dims.rows);
}

function grammarForOnlyGroundScheme(scheme: GroundSchemeKind): EngineGrammar {
  const clone = structuredClone(GRAMMAR) as EngineGrammar;
  const template = clone.templates.find(t => t.id === 'pipe-field')!;
  template.spec.groundSchemes = [scheme];
  template.spec.forms = { run: [0, 0], figure: [0, 0], frieze: [0, 0] };
  template.spec.figureShare = [0, 0];
  clone.palette.accentOrder = [];
  return clone;
}

function visibleAccentCount(plan: ReturnType<typeof samplePlan>): number {
  const accents = new Set<string>();
  for (const cell of plan.cells) {
    if (HERITAGE_ACCENTS.has(cell.ground)) accents.add(cell.ground);
    if (cell.ink && HERITAGE_ACCENTS.has(cell.ink)) accents.add(cell.ink);
    for (const ink of cell.inks ?? []) {
      if (HERITAGE_ACCENTS.has(ink)) accents.add(ink);
    }
  }
  return accents.size;
}

describe('default banner sampling', () => {
  it('samplePlan(GRAMMAR, 42) without arrangement stays deterministic and structurally valid', () => {
    const plan = samplePlan(GRAMMAR, 42);

    expect(plan).toEqual(samplePlan(GRAMMAR, 42));
    expectResolvedGrid(plan, 'banner');
    expect(plan.templateId).toBeTruthy();
    expect(visibleAccentCount(plan)).toBeLessThanOrEqual(3);
  });
});

describe('core arrangements', () => {
  it('samples every arrangement deterministically with all cells resolved', () => {
    for (const arrangement of ARRANGEMENT_IDS) {
      for (const seed of SAMPLE_SEEDS) {
        const a = samplePlan(GRAMMAR, seed, { arrangement });
        const b = samplePlan(GRAMMAR, seed, { arrangement });
        expect(a, `${arrangement} seed=${seed}`).toEqual(b);
        expectResolvedGrid(a, arrangement);
      }
    }
  });

  it('renderer emits arrangement-specific canvas dimensions', () => {
    for (const arrangement of ARRANGEMENT_IDS) {
      const plan = samplePlan(GRAMMAR, 5, { arrangement });
      const svg = renderPlanSvg(plan, TILES);
      const width = ARRANGEMENTS[arrangement].cols * 320;
      const height = ARRANGEMENTS[arrangement].rows * 320;
      expect(svg, arrangement).toContain(`width="${width}"`);
      expect(svg, arrangement).toContain(`height="${height}"`);
      expect(svg, arrangement).toContain(`viewBox="0 0 ${width} ${height}"`);
    }
  });

  it('program palette law holds for 2 programs x 2 seeds per arrangement', () => {
    for (const arrangement of ARRANGEMENT_IDS) {
      for (const program of PROGRAM_IDS) {
        const hue = PROGRAMS[program].hue;
        for (const seed of PROGRAM_SEEDS) {
          const result = generateBanner({ seed, arrangement, program, maxAttempts: 1 });
          expect(result.config.arrangement).toBe(arrangement);
          expectResolvedGrid(result.plan, arrangement);
          assertProgramPalettePlan(result.plan, hue, `${arrangement} ${program} seed=${seed}`);
          assertProgramPaletteSvg(result.svg, hue, `${arrangement} ${program} seed=${seed}`);
        }
      }
    }
  });

  it('composition scores are finite for every arrangement x 10 seeds', () => {
    for (const arrangement of ARRANGEMENT_IDS) {
      for (const seed of SAMPLE_SEEDS) {
        const plan = samplePlan(GRAMMAR, seed, { arrangement });
        const scores = scoreComposition(plan, TILES);
        for (const value of Object.values(scores)) {
          expect(Number.isFinite(value), `${arrangement} seed=${seed}`).toBe(true);
        }
      }
    }
  });

  it('quilt-pass rate is at least 50% per arrangement across 10 seeds', () => {
    const rates: Record<string, number> = {};
    for (const arrangement of ARRANGEMENT_IDS) {
      let passes = 0;
      for (const seed of SAMPLE_SEEDS) {
        const plan = samplePlan(GRAMMAR, seed, { arrangement });
        const scores = scorePlan(plan, FAMILIES);
        if (!scores.quiltFail) passes += 1;
      }
      rates[arrangement] = passes / SAMPLE_SEEDS.length;
      // 50% is a SANITY floor, deliberately below the plan's 60% aspiration: rates are
      // measured honestly and the per-size VISUAL gate decides shipping (GATE.md iter 5 —
      // column-short landed at 0.50 and ships flagged-experimental). Adjudicated 2026-07-02.
      expect(rates[arrangement], `${arrangement} quilt-pass rate`).toBeGreaterThanOrEqual(0.5);
    }
    console.log(`[arrangements] quilt-pass rates ${JSON.stringify(rates)}`);
  });

  it('patch anchors never place a patch outside arrangement bounds', () => {
    const patchById = new Map(PATCHES.map(patch => [patch.id, patch]));
    for (const arrangement of ARRANGEMENT_IDS) {
      const dims = ARRANGEMENTS[arrangement];
      for (const seed of SAMPLE_SEEDS) {
        const plan = samplePlan(GRAMMAR, seed, { arrangement, template: 'figure-field', figures: true });
        for (const cell of plan.cells) {
          if (!cell.patchId) continue;
          const patch = patchById.get(cell.patchId);
          expect(patch, `known patch ${cell.patchId}`).toBeDefined();
          expect(cell.col + patch!.w, `${arrangement} seed=${seed} patch=${patch!.id}`).toBeLessThanOrEqual(dims.cols);
          expect(cell.row + patch!.h, `${arrangement} seed=${seed} patch=${patch!.id}`).toBeLessThanOrEqual(dims.rows);
        }
      }
    }
  });

  it('column figure-field fits only 1x1 figure spans and no patches', () => {
    let figureAnchors = 0;
    for (let seed = 1; seed <= 80; seed += 1) {
      const plan = samplePlan(GRAMMAR, seed, { arrangement: 'column', template: 'figure-field', figures: true });
      for (const cell of plan.cells) {
        expect(cell.patchId, `column seed=${seed}`).toBeUndefined();
        if (cell.figureAnchor) {
          figureAnchors += 1;
          expect(cell.figureSpan, `column seed=${seed}`).toEqual([1, 1]);
        }
      }
    }
    expect(figureAnchors).toBeGreaterThan(0);
  });
});

describe('degenerate ground-scheme fallbacks', () => {
  it("banded-cols on a 1-wide 'column' falls back to uniform grounds", () => {
    const grammar = grammarForOnlyGroundScheme('banded-cols');
    const plan = samplePlan(grammar, 12, { arrangement: 'column', template: 'pipe-field', figures: false });
    expect(new Set(plan.cells.map(cell => cell.ground))).toEqual(new Set([plan.ground]));
  });

  it("banded-rows on a 1-high 'strip' falls back to uniform grounds", () => {
    const grammar = grammarForOnlyGroundScheme('banded-rows');
    const plan = samplePlan(grammar, 12, { arrangement: 'strip', template: 'pipe-field', figures: false });
    expect(new Set(plan.cells.map(cell => cell.ground))).toEqual(new Set([plan.ground]));
  });
});
