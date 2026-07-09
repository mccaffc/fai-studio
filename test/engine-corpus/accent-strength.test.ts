import { describe, expect, it } from 'vitest';

import { generateBanner } from '../../src/engine/corpus/index.js';
import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { applyProgramPalette, programSampleKnobs, PROGRAMS } from '../../src/engine/corpus/programs.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import type { BannerPlan, CorpusConfig, EngineGrammar, SampleKnobs } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const ACCENT_POOL = ['#FF4F00', '#FFA300', '#8265DB', '#0E8C88', '#268B41', '#4997D0', '#3A4A6B'] as const;
const ACCENT_POOL_SET = new Set<string>(ACCENT_POOL);
const STRENGTHS = [0.2, 0.35, 0.5, 0.65, 0.8, 1.0] as const;
const EPS = 1e-9;

function cellCarriesAccent(cell: BannerPlan['cells'][number]): boolean {
  return ACCENT_POOL_SET.has(cell.ground) ||
    (cell.ink !== undefined && ACCENT_POOL_SET.has(cell.ink)) ||
    (cell.inks ?? []).some(ink => ACCENT_POOL_SET.has(ink));
}

function visibleAccentShare(plan: BannerPlan): number {
  const nonPlain = plan.cells.filter(cell => cell.kind !== 'plain');
  const accented = nonPlain.filter(cellCarriesAccent);
  return accented.length / Math.max(1, nonPlain.length);
}

function accentInkShare(plan: BannerPlan): number {
  const nonPlain = plan.cells.filter(cell => cell.kind !== 'plain');
  const accented = nonPlain.filter(cell =>
    (cell.ink !== undefined && ACCENT_POOL_SET.has(cell.ink)) ||
    (cell.inks ?? []).some(ink => ACCENT_POOL_SET.has(ink)),
  );
  return accented.length / Math.max(1, nonPlain.length);
}

function piecewiseStrength(strength: number, midpoint: number): number {
  return strength <= 0.5
    ? 0.15 + (midpoint - 0.15) * (strength / 0.5)
    : midpoint + (0.60 - midpoint) * ((strength - 0.5) / 0.5);
}

describe('accentStrength engine knob', () => {
  it('accentStrength 0.5 is byte-identical to the shipped midpoint in accent modes', () => {
    const cases: { name: string; knobs: SampleKnobs }[] = [
      { name: 'explicit accent', knobs: { accent: '#FF4F00' } },
      { name: 'pool-3', knobs: { accentPool: ['#FF4F00', '#FFA300', '#4997D0'] } },
      { name: 'full palette', knobs: { paletteMode: 'full' } },
    ];

    for (const { name, knobs } of cases) {
      for (let i = 0; i < 50; i += 1) {
        const seed = 210_000 + i;
        const shipped = sampleWithDiagnostics(GRAMMAR, seed, knobs);
        const midpoint = sampleWithDiagnostics(GRAMMAR, seed, { ...knobs, accentStrength: 0.5 });

        expect(midpoint.plan, `${name} seed ${seed}`).toEqual(shipped.plan);
        expect(midpoint.diag, `${name} seed ${seed}`).toEqual(shipped.diag);
      }
    }
  });

  it('plain auto remains byte-identical even when accentStrength is supplied', () => {
    for (let i = 0; i < 50; i += 1) {
      const seed = 220_000 + i;
      const auto = sampleWithDiagnostics(GRAMMAR, seed);
      const ignored = sampleWithDiagnostics(GRAMMAR, seed, { accentStrength: 1 });

      expect(ignored.plan, `seed ${seed}`).toEqual(auto.plan);
      expect(ignored.diag, `seed ${seed}`).toEqual(auto.diag);
    }
  });

  // 0.75 = the P10 strength-ladder gate calibration (0.65 read +3pp — too subtle
  // for "by and large more accent"). Drift-guard pin, not frozen tuning.
  it('defaults public accent-carrying generation to explicit accentStrength 0.75', () => {
    const cases: { name: string; config: CorpusConfig }[] = [
      { name: 'explicit accent', config: { accent: '#FF4F00' } },
      { name: 'pool-3', config: { accentPool: ['#FF4F00', '#FFA300', '#4997D0'] } },
      { name: 'full palette', config: { paletteMode: 'full' } },
      { name: 'program', config: { program: 'science-innovation' } },
    ];

    for (const { name, config } of cases) {
      for (let i = 0; i < 30; i += 1) {
        const seed = 230_000 + i;
        const implicit = generateBanner({ ...config, seed, maxAttempts: 1 });
        const explicit = generateBanner({ ...config, seed, maxAttempts: 1, accentStrength: 0.75 });

        expect(implicit.plan, `${name} seed ${seed}`).toEqual(explicit.plan);
        expect(implicit.svg, `${name} seed ${seed}`).toBe(explicit.svg);
      }
    }
  });

  it('keeps visible accent share monotonic by strength for explicit, pool, full, and program modes', () => {
    const cases: { name: string; seedBase: number; knobs: (strength: number) => SampleKnobs; map?: (plan: BannerPlan) => BannerPlan }[] = [
      {
        name: 'explicit accent',
        seedBase: 240_000,
        knobs: strength => ({ accent: '#FF4F00', accentStrength: strength }),
      },
      {
        name: 'pool-3',
        seedBase: 241_000,
        knobs: strength => ({ accentPool: ['#FF4F00', '#FFA300', '#4997D0'], accentStrength: strength }),
      },
      {
        name: 'full palette',
        seedBase: 242_000,
        knobs: strength => ({ paletteMode: 'full', accentStrength: strength }),
      },
      {
        name: 'program',
        seedBase: 243_000,
        knobs: strength => ({ ...programSampleKnobs('science-innovation'), accentStrength: strength }),
        map: plan => applyProgramPalette(plan, PROGRAMS['science-innovation'].hue),
      },
    ];

    for (const mode of cases) {
      const means = STRENGTHS.map(strength => {
        let total = 0;
        for (let i = 0; i < 100; i += 1) {
          const plan = sampleWithDiagnostics(GRAMMAR, mode.seedBase + i, mode.knobs(strength)).plan;
          total += visibleAccentShare(mode.map ? mode.map(plan) : plan);
        }
        return total / 100;
      });

      for (let i = 1; i < means.length; i += 1) {
        expect(
          means[i]! + EPS,
          `${mode.name}: means=${means.map(v => v.toFixed(4)).join(' < ')}`,
        ).toBeGreaterThanOrEqual(means[i - 1]!);
      }
    }
  });

  it('respects the strength-scaled accent ink budget cap at every sampled strength', () => {
    const cases: { name: string; midpointCap: number; seedBase: number; knobs: (strength: number) => SampleKnobs }[] = [
      {
        name: 'explicit accent',
        midpointCap: 0.35,
        seedBase: 250_000,
        knobs: strength => ({ accent: '#FF4F00', accentStrength: strength }),
      },
      {
        name: 'pool-3',
        midpointCap: 0.50,
        seedBase: 251_000,
        knobs: strength => ({ accentPool: ['#FF4F00', '#FFA300', '#4997D0'], accentStrength: strength }),
      },
      {
        name: 'full palette',
        midpointCap: 0.50,
        seedBase: 252_000,
        knobs: strength => ({ paletteMode: 'full', accentStrength: strength }),
      },
    ];

    for (const mode of cases) {
      for (const strength of STRENGTHS) {
        const cap = piecewiseStrength(strength, mode.midpointCap);
        for (let i = 0; i < 100; i += 1) {
          const seed = mode.seedBase + i;
          const { plan } = sampleWithDiagnostics(GRAMMAR, seed, mode.knobs(strength));
          expect(accentInkShare(plan), `${mode.name} seed ${seed} strength ${strength}`).toBeLessThanOrEqual(cap + EPS);
        }
      }
    }
  });

  it('rejects out-of-range accentStrength values', () => {
    expect(() => generateBanner({ seed: 1, accent: '#FF4F00', accentStrength: -0.01 })).toThrow(/accentStrength/i);
    expect(() => generateBanner({ seed: 1, accent: '#FF4F00', accentStrength: 1.01 })).toThrow(/accentStrength/i);
    expect(() => sampleWithDiagnostics(GRAMMAR, 1, { accent: '#FF4F00', accentStrength: Number.NaN })).toThrow(/accentStrength/i);
  });
});
