import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import { passesCompositionFloors, scoreComposition } from '../../src/engine/corpus/composition.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import type { BannerPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const SAMPLE_COUNT = 40;
const FULL_LINE_MIN_RATE = 0.25;
const FLOOR_MIN_RATE = 0.90;
const SEED_START = 3_000;

function sample(seedOffset: number): ReturnType<typeof sampleWithDiagnostics> {
  return sampleWithDiagnostics(GRAMMAR, SEED_START + seedOffset);
}

function hasFullLineRunPath(result: ReturnType<typeof sampleWithDiagnostics>): boolean {
  return result.diag.runPaths.some(runPath => pathCoversFullRow(runPath, result.plan.cols) || pathCoversFullColumn(runPath, result.plan.rows));
}

function pathCoversFullRow(runPath: readonly [number, number][], cols: number): boolean {
  for (const [_col, row] of runPath) {
    const covered = new Set<number>();
    for (const [candidateCol, candidateRow] of runPath) {
      if (candidateRow === row) covered.add(candidateCol);
    }
    if (covered.size >= cols) return true;
  }
  return false;
}

function pathCoversFullColumn(runPath: readonly [number, number][], rows: number): boolean {
  for (const [col] of runPath) {
    const covered = new Set<number>();
    for (const [candidateCol, candidateRow] of runPath) {
      if (candidateCol === col) covered.add(candidateRow);
    }
    if (covered.size >= rows) return true;
  }
  return false;
}

describe('rhythm phrasing', () => {
  it('places full-row or full-column run phrases in at least 25% of 40 auto plans', () => {
    const hits: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const result = sample(i);
      if (hasFullLineRunPath(result)) hits.push(SEED_START + i);
    }

    expect(
      hits.length / SAMPLE_COUNT,
      `full-line forms=${hits.length}/${SAMPLE_COUNT}; seeds=${hits.join(',')}`,
    ).toBeGreaterThanOrEqual(FULL_LINE_MIN_RATE);
  });

  it('keeps at least 90% of the same 40 auto plans above existing composition floors', () => {
    const failing: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const seed = SEED_START + i;
      const { plan } = sample(i);
      const scores = scoreComposition(plan, TILES);
      if (!passesCompositionFloors(scores)) failing.push(seed);
    }

    const passCount = SAMPLE_COUNT - failing.length;
    expect(
      passCount / SAMPLE_COUNT,
      `composition floor passes=${passCount}/${SAMPLE_COUNT}; failing seeds=${failing.join(',')}`,
    ).toBeGreaterThanOrEqual(FLOOR_MIN_RATE);
  });
});
