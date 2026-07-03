import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import type { BannerPlan, CellPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const HERITAGE_ACCENTS = ['#FF4F00', '#FFA300', '#4997D0'] as const;
const HERITAGE_SET = new Set<string>(HERITAGE_ACCENTS);
const WARM_ACCENTS = new Set<string>(['#FF4F00', '#FFA300']);
const COOL_ACCENT = '#4997D0';
const CANON_TARGET = [0.22, 0.20, 0.16, 0.42] as const;
const SAMPLE_COUNT = 200;

function visibleAccentSet(plan: BannerPlan): Set<string> {
  const accents = new Set<string>();
  for (const cell of plan.cells) {
    if (HERITAGE_SET.has(cell.ground)) accents.add(cell.ground);
    if (cell.ink && HERITAGE_SET.has(cell.ink)) accents.add(cell.ink);
    for (const ink of cell.inks ?? []) {
      if (HERITAGE_SET.has(ink)) accents.add(ink);
    }
  }
  return accents;
}

function accentInkShare(plan: BannerPlan): number {
  const nonPlain = plan.cells.filter(cell => cell.kind !== 'plain');
  const accentInkCells = nonPlain.filter(cell =>
    (cell.ink && HERITAGE_SET.has(cell.ink)) || (cell.inks ?? []).some(ink => HERITAGE_SET.has(ink)),
  );
  return accentInkCells.length / Math.max(1, nonPlain.length);
}

function accentCentroid(plan: BannerPlan, predicate: (hex: string) => boolean): number | null {
  const cells = plan.cells.filter(cell => cellCarriesAccent(cell, predicate));
  if (cells.length === 0) return null;
  return cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length;
}

function cellCarriesAccent(cell: CellPlan, predicate: (hex: string) => boolean): boolean {
  return predicate(cell.ground) || (cell.ink !== undefined && predicate(cell.ink)) || (cell.inks ?? []).some(predicate);
}

describe('multi-accent auto zoning', () => {
  it('matches the canon-calibrated 0/1/2/3 accent distribution over 200 auto seeds', () => {
    const buckets = [0, 0, 0, 0];
    const actuals: number[] = [];

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, 20_000 + i);
      const visible = visibleAccentSet(plan);
      const accentCount = visible.size;
      actuals.push(accentCount);

      expect([...visible].every(accent => HERITAGE_SET.has(accent)), `seed ${20_000 + i}`).toBe(true);
      expect(diag.accentZonesPlaced, `seed ${20_000 + i}`).toBe(accentCount);
      expect(new Set(diag.accentsUsed), `seed ${20_000 + i}`).toEqual(visible);
      expect(accentInkShare(plan), `seed ${20_000 + i}`).toBeLessThanOrEqual(0.35);

      const bucket = Math.min(accentCount, 3);
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }

    for (let bucket = 0; bucket < CANON_TARGET.length; bucket += 1) {
      const sampled = buckets[bucket]! / SAMPLE_COUNT;
      expect(
        Math.abs(sampled - CANON_TARGET[bucket]!) <= 0.12,
        `bucket ${bucket}: sampled=${sampled.toFixed(3)} target=${CANON_TARGET[bucket]!.toFixed(3)} counts=${buckets.join('/')}; actuals=${actuals.join(',')}`,
      ).toBe(true);
    }
  });

  it('biases warm and cool zones toward opposite halves without hard walls', () => {
    let checked = 0;
    let warmOnWarmSide = 0;

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, 40_000 + i, { figures: false });
      const visible = visibleAccentSet(plan);
      const hasWarm = [...visible].some(accent => WARM_ACCENTS.has(accent));
      const hasCool = visible.has(COOL_ACCENT);
      if (!hasWarm || !hasCool || diag.accentWarmSide === undefined) continue;

      const warmCentroid = accentCentroid(plan, accent => WARM_ACCENTS.has(accent));
      const coolCentroid = accentCentroid(plan, accent => accent === COOL_ACCENT);
      expect(warmCentroid).not.toBeNull();
      expect(coolCentroid).not.toBeNull();
      checked += 1;

      const split = plan.cols / 2;
      const warmIsOnWarmSide = diag.accentWarmSide === 'left'
        ? warmCentroid! < split
        : warmCentroid! >= split;
      if (warmIsOnWarmSide) warmOnWarmSide += 1;
    }

    expect(checked, 'need enough mixed-temperature plans to verify side bias').toBeGreaterThanOrEqual(20);
    expect(warmOnWarmSide / checked, `${warmOnWarmSide}/${checked}`).toBeGreaterThanOrEqual(0.60);
  });

  it('is deterministic for multi-accent auto diagnostics and plans', () => {
    const first = sampleWithDiagnostics(GRAMMAR, 22_222);
    const second = sampleWithDiagnostics(GRAMMAR, 22_222);

    expect(first.plan).toEqual(second.plan);
    expect(first.diag.accentZonesPlaced).toBe(second.diag.accentZonesPlaced);
    expect(first.diag.accentsUsed).toEqual(second.diag.accentsUsed);
    expect(first.diag.accentWarmSide).toBe(second.diag.accentWarmSide);
  });
});
