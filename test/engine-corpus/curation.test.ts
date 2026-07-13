import { describe, expect, it } from 'vitest';
import {
  ARRANGEMENTS,
  curateVariations,
  generateBanner,
  variations,
  type CorpusResult,
} from '../../src/engine/corpus/index.js';
import { PROGRAMS, type ProgramId } from '../../src/engine/corpus/programs.js';

function structuralDistance(a: CorpusResult, b: CorpusResult): number {
  let changed = a.plan.templateId === b.plan.templateId ? 0 : 1;
  const cells = Math.max(a.plan.cells.length, b.plan.cells.length);
  for (let i = 0; i < cells; i += 1) {
    const left = a.plan.cells[i];
    const right = b.plan.cells[i];
    if (!left || !right) {
      changed += 1;
      continue;
    }
    if (left.kind !== right.kind) changed += 1;
    if (left.tile !== right.tile) changed += 1;
    if (left.rotation !== right.rotation || left.flip !== right.flip) changed += 0.5;
    if (left.ground !== right.ground) changed += 0.5;
    if (left.ink !== right.ink) changed += 0.25;
  }
  return changed / Math.max(1, cells * 3.25 + 1);
}

function meanNearestDistance(results: CorpusResult[]): number {
  if (results.length < 2) return 0;
  return results.reduce((sum, result, index) => {
    const nearest = results
      .filter((_candidate, candidateIndex) => candidateIndex !== index)
      .reduce((min, candidate) => Math.min(min, structuralDistance(result, candidate)), 1);
    return sum + nearest;
  }, 0) / results.length;
}

describe('curated variations', () => {
  it('is deterministic, unique, and draws from the declared deterministic pool', () => {
    const base = generateBanner({ seed: 321 });
    const a = curateVariations(base, 6, { poolMultiplier: 4 });
    const b = curateVariations(base, 6, { poolMultiplier: 4 });
    const poolSeeds = new Set(
      Array.from({ length: 24 }, (_value, index) =>
        generateBanner({ ...base.config, seed: base.seed + index + 1 }).seed),
    );

    expect(a.map(result => result.seed)).toEqual(b.map(result => result.seed));
    expect(a.map(result => result.svg)).toEqual(b.map(result => result.svg));
    expect(new Set(a.map(result => result.seed)).size).toBe(6);
    expect(new Set(a.map(result => result.svg)).size).toBe(6);
    expect(a.every(result => poolSeeds.has(result.seed))).toBe(true);
  });

  it('improves structural spread over the sequential baseline on fixed seeds', () => {
    for (const seed of [100, 900, 1700]) {
      const base = generateBanner({ seed });
      const curated = curateVariations(base, 6, { poolMultiplier: 4 });
      const sequential = Array.from({ length: 6 }, (_value, index) =>
        generateBanner({ ...base.config, seed: base.seed + index + 1 }),
      );

      expect(meanNearestDistance(curated)).toBeGreaterThanOrEqual(meanNearestDistance(sequential));
    }
  });

  it('keeps arrangement dimensions and program palette law', () => {
    const arrangement = 'portrait' as const;
    const program = 'artificial-intelligence' as ProgramId;
    const base = generateBanner({ seed: 4242, arrangement, program });
    const results = curateVariations(base, 5);
    const hue = PROGRAMS[program].hue;
    const allowed = new Set(['#121212', '#D9D9D6', '#F3F3F3', hue]);

    expect(results).toHaveLength(5);
    for (const result of results) {
      expect(result.plan.cols).toBe(ARRANGEMENTS[arrangement].cols);
      expect(result.plan.rows).toBe(ARRANGEMENTS[arrangement].rows);
      for (const cell of result.plan.cells) {
        for (const fill of [cell.ground, cell.ink, ...(cell.inks ?? [])]) {
          if (fill) expect(allowed.has(fill), fill).toBe(true);
        }
      }
    }
  });

  it('handles zero count and normalizes invalid pool multipliers', () => {
    const base = generateBanner({ seed: 88 });
    expect(curateVariations(base, 0)).toEqual([]);
    expect(curateVariations(base, 4, { poolMultiplier: 0.25 })).toHaveLength(4);
    expect(curateVariations(base, 4, { poolMultiplier: Number.NaN })).toHaveLength(4);
    expect(curateVariations(base, 4, { poolMultiplier: Number.POSITIVE_INFINITY })).toHaveLength(4);
  });

  it('preserves the public sequential variations seed contract', () => {
    const base = generateBanner({ seed: 700 });
    const results = variations(base, 4);
    const expected = Array.from({ length: 4 }, (_value, index) =>
      generateBanner({ ...base.config, seed: base.seed + index + 1 }).seed);

    expect(results.map(result => result.seed)).toEqual(expected);
  });
});
