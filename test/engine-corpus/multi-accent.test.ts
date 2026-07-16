import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import { generateBanner } from '../../src/engine/corpus/index.js';
import type { BannerPlan, CellPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const ACCENT_POOL = ['#FF4F00', '#FFA300', '#7150D6', '#0E8C88', '#268B41', '#4997D0', '#C8102E'] as const;
const ACCENT_POOL_SET = new Set<string>(ACCENT_POOL);
const WARM_ACCENTS = new Set<string>(['#FF4F00', '#FFA300', '#C8102E']);
const COOL_ACCENTS = new Set<string>(['#4997D0', '#7150D6', '#268B41', '#0E8C88']);
const CANON_TARGET = [0.22, 0.20, 0.16, 0.42] as const;
const SAMPLE_COUNT = 200;

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

function accentCentroid(plan: BannerPlan, predicate: (hex: string) => boolean): number | null {
  const cells = plan.cells.filter(cell => cellCarriesAccent(cell, predicate));
  if (cells.length === 0) return null;
  return cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length;
}

function cellCarriesAccent(cell: CellPlan, predicate: (hex: string) => boolean): boolean {
  return predicate(cell.ground) || (cell.ink !== undefined && predicate(cell.ink)) || (cell.inks ?? []).some(predicate);
}

describe('mode isolation — forced-accent single-zone invariant', () => {
  // Regression: when knobs.accent is set (forced / program mode), applyAccentZoning
  // must place AT MOST ONE accent zone (targetAccentCount is hardcoded to 1).
  // This test runs 30 seeds with knobs.accent forced and asserts the never->1 bound.
  const FORCED_ACCENT = '#FF4F00'; // canonical orange, already used by the auto tests above
  const FORCED_SEED_COUNT = 30;
  const FORCED_SEED_OFFSET = 90_000;

  it('places never more than 1 accent zone when knobs.accent is forced (30 seeds)', () => {
    let exactlyOne = 0;
    for (let i = 0; i < FORCED_SEED_COUNT; i += 1) {
      const seed = FORCED_SEED_OFFSET + i;
      const { diag } = sampleWithDiagnostics(GRAMMAR, seed, { accent: FORCED_ACCENT });
      // Load-bearing assertion: forced mode must NEVER produce more than 1 zone.
      expect(diag.accentZonesPlaced, `seed ${seed}: accentZonesPlaced=${diag.accentZonesPlaced} must not exceed 1`).toBeLessThanOrEqual(1);
      if (diag.accentZonesPlaced === 1) exactlyOne += 1;
    }
    // Softer bound: placement should succeed the large majority of the time.
    expect(
      exactlyOne / FORCED_SEED_COUNT,
      `only ${exactlyOne}/${FORCED_SEED_COUNT} seeds placed exactly 1 zone; expected ≥80%`,
    ).toBeGreaterThanOrEqual(0.80);
  });

  it('produces no second accent color in plan cells when knobs.accent is forced (30 seeds)', () => {
    // User-visible property: forced accent mode must never render a color the user didn't pick.
    // Non-neutral colors in ground/ink/inks[] must be a subset of {FORCED_ACCENT}.
    const NEUTRALS = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);
    for (let i = 0; i < FORCED_SEED_COUNT; i += 1) {
      const seed = FORCED_SEED_OFFSET + i;
      const { plan } = sampleWithDiagnostics(GRAMMAR, seed, { accent: FORCED_ACCENT });
      const nonNeutralColors = new Set<string>();
      for (const cell of plan.cells) {
        if (!NEUTRALS.has(cell.ground)) nonNeutralColors.add(cell.ground);
        if (cell.ink && !NEUTRALS.has(cell.ink)) nonNeutralColors.add(cell.ink);
        for (const ink of cell.inks ?? []) {
          if (!NEUTRALS.has(ink)) nonNeutralColors.add(ink);
        }
      }
      const unexpectedColors = [...nonNeutralColors].filter(color => color !== FORCED_ACCENT);
      expect(
        unexpectedColors,
        `seed ${seed}: unexpected non-neutral color(s) in forced-accent plan: ${unexpectedColors.join(', ')}`,
      ).toHaveLength(0);
      // Presence, not just exclusivity — and UNCONDITIONAL: gating this on
      // diag.accentZonesPlaced hid the mirror-erasure bug, because erasure
      // drives the re-synced count to 0 and the assertion silently skipped.
      expect(
        nonNeutralColors.has(FORCED_ACCENT),
        `seed ${seed}: the forced accent appears in no cell`,
      ).toBe(true);
    }
  });
});

describe('multi-accent auto zoning', () => {
  it('draws auto accents only from the 7-hue locked pool and reaches every hue over 400 seeds', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 400; i += 1) {
      const seed = 10_000 + i;
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed);
      const visible = visibleAccentSet(plan);

      for (const accent of visible) {
        expect(ACCENT_POOL_SET.has(accent), `seed ${seed}: unexpected accent ${accent}`).toBe(true);
        seen.add(accent);
      }
      for (const accent of diag.accentsUsed) {
        expect(ACCENT_POOL_SET.has(accent), `seed ${seed}: unexpected diagnostic accent ${accent}`).toBe(true);
        seen.add(accent);
      }
    }

    expect([...seen].sort(), `seen accents: ${[...seen].sort().join(', ')}`).toEqual([...ACCENT_POOL].sort());
  });

  it('matches the canon-calibrated 0/1/2/3 accent distribution over 200 auto seeds', () => {
    const buckets = [0, 0, 0, 0];
    const actuals: number[] = [];

    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, 20_000 + i);
      const visible = visibleAccentSet(plan);
      const accentCount = visible.size;
      actuals.push(accentCount);

      expect([...visible].every(accent => ACCENT_POOL_SET.has(accent)), `seed ${20_000 + i}`).toBe(true);
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
      const hasCool = [...visible].some(accent => COOL_ACCENTS.has(accent));
      if (!hasWarm || !hasCool || diag.accentWarmSide === undefined) continue;

      const warmCentroid = accentCentroid(plan, accent => WARM_ACCENTS.has(accent));
      const coolCentroid = accentCentroid(plan, accent => COOL_ACCENTS.has(accent));
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

  it('uses light ink for Frontier Crimson ground zones with readable contrast', () => {
    let checked = 0;
    const frontierCrimson = '#C8102E';

    for (let i = 0; i < 160; i += 1) {
      const seed = 50_000 + i;
      const { plan } = sampleWithDiagnostics(GRAMMAR, seed, { accent: frontierCrimson, figures: false });
      const zoneCells = plan.cells.filter(cell => cell.ground === frontierCrimson);
      if (zoneCells.length === 0) continue;
      checked += zoneCells.length;
      for (const cell of zoneCells) {
        expect(cell.ink, `seed ${seed} cell ${cell.col},${cell.row}`).toBe('#F3F3F3');
      }
    }

    expect(checked, 'need at least one Frontier Crimson ground-zone cell').toBeGreaterThan(0);
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

describe('full-palette mode', () => {
  it('is deterministic for full-palette diagnostics and plans', () => {
    const knobs = { paletteMode: 'full' } as const;
    const first = sampleWithDiagnostics(GRAMMAR, 61_000, knobs);
    const second = sampleWithDiagnostics(GRAMMAR, 61_000, knobs);

    expect(first.plan).toEqual(second.plan);
    expect(first.diag.accentsUsed).toEqual(second.diag.accentsUsed);
    expect(first.diag.accentWarmSide).toBe(second.diag.accentWarmSide);
  });

  it('visibly uses all 7 locked accents in every banner seed', () => {
    for (let i = 0; i < 100; i += 1) {
      const seed = 62_000 + i;
      const { plan, diag } = sampleWithDiagnostics(GRAMMAR, seed, { paletteMode: 'full' });
      const visible = visibleAccentSet(plan);
      expect(visible, `seed ${seed}: visible full palette`).toEqual(ACCENT_POOL_SET);

      for (const accent of visible) {
        expect(ACCENT_POOL_SET.has(accent), `seed ${seed}: unexpected visible accent ${accent}`).toBe(true);
      }
      for (const accent of diag.accentsUsed) {
        expect(ACCENT_POOL_SET.has(accent), `seed ${seed}: unexpected diagnostic accent ${accent}`).toBe(true);
      }
      expect(accentInkShare(plan), `seed ${seed}`).toBeLessThanOrEqual(0.5);
    }
  });

  it('throws when full-palette mode is combined with explicit accent or program mode', () => {
    expect(() => generateBanner({ seed: 1, paletteMode: 'full', accent: '#FF4F00' })).toThrow(/paletteMode.*accent/i);
    expect(() => generateBanner({ seed: 1, paletteMode: 'full', program: 'science-innovation' })).toThrow(/paletteMode.*program/i);
  });
});
