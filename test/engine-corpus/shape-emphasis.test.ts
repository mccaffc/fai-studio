/**
 * shape-emphasis.test.ts — the shapeEmphasis sampler knob (studio slider,
 * 2026-07-16).
 *
 * Covers:
 *  - neutrality: undefined and 0.5 are byte-identical to the pre-knob sampler
 *  - carry: emphasis 1 raises the dominant family's tile share vs emphasis 0
 *  - determinism: same seed + emphasis twice → deep-equal plans
 *  - program mode: emphasis composes with program familyBias without throwing
 *    and keeps the palette law
 *  - validation: out-of-range values throw (engine + generateBanner)
 */

import { describe, it, expect } from 'vitest';
import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { samplePlan, sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import { generateBanner } from '../../src/engine/corpus/index.js';
import type { BannerPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const SEEDS = [11, 42, 77, 101, 555] as const;

function dominantShare(plan: BannerPlan, dominantFamily: string): number {
  const catalog = GRAMMAR.tileCatalog;
  const tileCells = plan.cells.filter(c => c.kind === 'tile' && c.tile);
  if (tileCells.length === 0) return 0;
  const domCells = tileCells.filter(c => catalog[c.tile!]?.family === dominantFamily);
  return domCells.length / tileCells.length;
}

function averageDominantShare(emphasis: number | undefined): number {
  let total = 0;
  for (const seed of SEEDS) {
    const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed, {
      template: 'mixed-quilt',
      shapeEmphasis: emphasis,
    });
    total += dominantShare(plan, diag.dominantFamily);
  }
  return total / SEEDS.length;
}

describe('shapeEmphasis — neutrality and determinism', () => {
  it('undefined and 0.5 produce byte-identical plans', () => {
    for (const seed of SEEDS) {
      for (const template of ['pipe-field', 'mixed-quilt', 'repeat-rhythm'] as const) {
        const bare = samplePlan(GRAMMAR, seed, { template });
        const neutral = samplePlan(GRAMMAR, seed, { template, shapeEmphasis: 0.5 });
        expect(neutral).toEqual(bare);
      }
    }
  });

  it('is deterministic: same seed + emphasis twice → deep-equal', () => {
    for (const emphasis of [0, 0.25, 0.75, 1]) {
      const a = samplePlan(GRAMMAR, 42, { template: 'mixed-quilt', shapeEmphasis: emphasis });
      const b = samplePlan(GRAMMAR, 42, { template: 'mixed-quilt', shapeEmphasis: emphasis });
      expect(a).toEqual(b);
    }
  });
});

describe('shapeEmphasis — carry direction', () => {
  it('emphasis 1 gives the dominant family a clearly larger share than emphasis 0', () => {
    const low = averageDominantShare(0);
    const neutral = averageDominantShare(undefined);
    const high = averageDominantShare(1);
    expect(high, `low=${low} neutral=${neutral} high=${high}`).toBeGreaterThan(neutral);
    expect(high, `low=${low} high=${high}`).toBeGreaterThan(low + 0.2);
  });
});

describe('shapeEmphasis — program mode', () => {
  it('composes with a program (palette law holds, generation succeeds)', () => {
    for (const emphasis of [0.25, 0.9]) {
      const result = generateBanner({
        seed: 7,
        program: 'frontier-legal-defense',
        shapeEmphasis: emphasis,
      });
      const hue = '#C8102E';
      const allowed = new Set(['#121212', '#F3F3F3', '#D9D9D6', hue]);
      expect(allowed.has(result.plan.ground)).toBe(true);
      for (const cell of result.plan.cells) {
        if (cell.ground) expect(allowed.has(cell.ground), `ground ${cell.ground}`).toBe(true);
        if (cell.ink) expect(allowed.has(cell.ink), `ink ${cell.ink}`).toBe(true);
      }
    }
  });
});

describe('shapeEmphasis — validation', () => {
  it('rejects out-of-range and non-finite values', () => {
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => samplePlan(GRAMMAR, 1, { shapeEmphasis: bad })).toThrow(/shapeEmphasis/);
      expect(() => generateBanner({ seed: 1, shapeEmphasis: bad })).toThrow(/shapeEmphasis/);
    }
  });
});
