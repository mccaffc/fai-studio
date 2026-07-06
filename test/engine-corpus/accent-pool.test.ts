import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { generateBanner } from '../../src/engine/corpus/index.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import type { BannerPlan, EngineGrammar, SampleKnobs } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const ACCENT_POOL = ['#FF4F00', '#FFA300', '#8265DB', '#D63A8C', '#268B41', '#4997D0', '#3A4A6B'] as const;
const ACCENT_POOL_SET = new Set<string>(ACCENT_POOL);

type AccentPoolKnobs = SampleKnobs & { accentPool?: string[] };
type AccentPoolConfig = Parameters<typeof generateBanner>[0] & { accentPool?: string[] };

function knobsWithPool(pool: readonly string[]): AccentPoolKnobs {
  return { accentPool: [...pool] };
}

function configWithPool(config: AccentPoolConfig): AccentPoolConfig {
  return config;
}

function visibleAccentSet(plan: BannerPlan): Set<string> {
  const accents = new Set<string>();
  for (const cell of plan.cells) {
    if (ACCENT_POOL_SET.has(cell.ground)) accents.add(cell.ground);
    if (cell.ink && ACCENT_POOL_SET.has(cell.ink)) accents.add(cell.ink);
    for (const ink of cell.inks ?? []) {
      if (ACCENT_POOL_SET.has(ink)) accents.add(ink);
    }
  }
  return accents;
}

function accentInkShare(plan: BannerPlan): number {
  const nonPlain = plan.cells.filter(cell => cell.kind !== 'plain');
  const accentInkCells = nonPlain.filter(cell =>
    (cell.ink && ACCENT_POOL_SET.has(cell.ink)) || (cell.inks ?? []).some(ink => ACCENT_POOL_SET.has(ink)),
  );
  return accentInkCells.length / Math.max(1, nonPlain.length);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe('accent-pool knob', () => {
  it.each([
    { size: 2, pool: ['#FF4F00', '#4997D0'] },
    { size: 3, pool: ['#FF4F00', '#FFA300', '#4997D0'] },
    { size: 5, pool: ['#FF4F00', '#FFA300', '#8265DB', '#D63A8C', '#4997D0'] },
  ])('uses only the selected $size-accent pool and shows every member over 100 seeds', ({ pool }) => {
    const expected = sorted(pool);
    let allMembersPresent = 0;

    for (let i = 0; i < 100; i += 1) {
      const seed = 120_000 + pool.length * 1_000 + i;
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed, knobsWithPool(pool));
      const visible = visibleAccentSet(plan);

      expect(sorted(visible), `seed ${seed}: visible accents`).toEqual(expected);
      expect(sorted(diag.accentsUsed), `seed ${seed}: diagnostic accents`).toEqual(expected);
      if (pool.every(accent => visible.has(accent))) allMembersPresent += 1;
    }

    expect(allMembersPresent, `pool ${pool.join(', ')} all-members-present rate`).toBe(100);
  });

  it('makes a single-member pool byte-equivalent to the explicit accent path over 50 seeds', () => {
    const accent = '#D63A8C';

    for (let i = 0; i < 50; i += 1) {
      const seed = 130_000 + i;
      const explicit = sampleWithDiagnostics(GRAMMAR, seed, { accent });
      const pooled = sampleWithDiagnostics(GRAMMAR, seed, knobsWithPool([accent]));

      expect(pooled.plan, `seed ${seed}`).toEqual(explicit.plan);
    }
  });

  it('throws for accent-pool conflicts and invalid members', () => {
    expect(() => generateBanner(configWithPool({ seed: 1, accentPool: ['#FF4F00'], accent: '#4997D0' }))).toThrow(/accentPool.*accent/i);
    expect(() => generateBanner(configWithPool({ seed: 1, accentPool: ['#FF4F00'], program: 'science-innovation' }))).toThrow(/accentPool.*program/i);
    expect(() => generateBanner(configWithPool({ seed: 1, accentPool: ['#FF4F00'], paletteMode: 'full' }))).toThrow(/accentPool.*paletteMode/i);
    expect(() => generateBanner(configWithPool({ seed: 1, accentPool: [] }))).toThrow(/accentPool.*empty/i);
    expect(() => generateBanner(configWithPool({ seed: 1, accentPool: ['#FF4F00', '#ABCDEF'] }))).toThrow(/Unknown accent.*#ABCDEF/i);
    expect(() => generateBanner(configWithPool({ seed: 1, accentPool: ['#FF4F00', '#FF4F00'] }))).toThrow(/duplicate/i);
  });

  it('rolls back mirrors that erase any selected pool member over 300 seeds', () => {
    const pool = ['#FF4F00', '#4997D0'];
    let mirrored = 0;

    for (let i = 0; i < 300; i += 1) {
      const seed = 140_000 + i;
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed, knobsWithPool(pool));
      const visible = visibleAccentSet(plan);
      if (diag.mirrored) mirrored += 1;

      for (const accent of pool) {
        expect(visible.has(accent), `seed ${seed}: pool member ${accent} absent`).toBe(true);
      }
    }

    expect(mirrored, 'expected this seed range to exercise accepted mirrors').toBeGreaterThan(0);
  });

  it('uses the pool-specific accent budget caps', () => {
    const cases = [
      { pool: ['#FF4F00', '#4997D0'], cap: 0.35 },
      { pool: ['#FF4F00', '#FFA300', '#4997D0'], cap: 0.5 },
      { pool: ['#FF4F00', '#FFA300', '#8265DB', '#D63A8C', '#4997D0'], cap: 0.5 },
    ] as const;

    for (const { pool, cap } of cases) {
      for (let i = 0; i < 100; i += 1) {
        const seed = 150_000 + pool.length * 1_000 + i;
        const { plan } = sampleWithDiagnostics(GRAMMAR, seed, knobsWithPool(pool));
        expect(accentInkShare(plan), `seed ${seed}: pool size ${pool.length}`).toBeLessThanOrEqual(cap);
      }
    }
  });
});
