import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import { aggregateCompositionMeasurements, measurePlanComposition } from '../../src/engine/corpus/composition-laws.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import type { EngineGrammar } from '../../src/engine/corpus/types.js';

const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const SEED_START = 80_000;
const SAMPLE_COUNT = 200;

function measureAutoBannerSample() {
  const familyForTile = (tile: string): string | undefined => TILES[tile]?.family;
  return aggregateCompositionMeasurements(
    Array.from({ length: SAMPLE_COUNT }, (_value, index) => {
      const plan = samplePlan(GRAMMAR, SEED_START + index, { arrangement: 'banner' });
      return measurePlanComposition(plan, { familyForTile });
    }),
  );
}

describe('P10 composition steering laws', () => {
  it('Law 2 steers focal center-cell share into the canon band over 200 auto banner seeds', () => {
    // Pre-Law 2 baseline (historical): 76/199 center focals = 0.38191, below the 45-65% canon band.
    const measurement = measureAutoBannerSample().focalPosition;
    expect(
      measurement.centerCellShare,
      `center focals=${measurement.centerCellCount}/${measurement.detectableBannerCount}`,
    ).toBeGreaterThanOrEqual(0.45);
    expect(
      measurement.centerCellShare,
      `center focals=${measurement.centerCellCount}/${measurement.detectableBannerCount}`,
    ).toBeLessThanOrEqual(0.65);
  });

  it('leaves skipped Law 1 and Law 3 statistics inside their canon bands', () => {
    // Law 1 pre-law baseline: isolated accents 34/1315 = 2.59%, corners
    // 17/200 = 0.085/banner, already inside the 1-5% and <=0.25 bands.
    // Law 3 pre-law baseline: one-interrupt 90/333 = 27.0%, perfect
    // 20/333 = 6.0%, already inside the 20-32% and 5-15% bands.
    const measurement = measureAutoBannerSample();
    const accent = measurement.accentProximity;
    const rhythm = measurement.rhythmBreak;

    expect(accent.isolatedAccentCellShare).toBeGreaterThanOrEqual(0.01);
    expect(accent.isolatedAccentCellShare).toBeLessThanOrEqual(0.05);
    expect(accent.isolatedCornerSingletons / SAMPLE_COUNT).toBeLessThanOrEqual(0.25);

    expect(rhythm.interruptionFrequency).toBeGreaterThanOrEqual(0.20);
    expect(rhythm.interruptionFrequency).toBeLessThanOrEqual(0.32);
    expect(rhythm.perfectLineCount / rhythm.lineCount).toBeGreaterThanOrEqual(0.05);
    expect(rhythm.perfectLineCount / rhythm.lineCount).toBeLessThanOrEqual(0.15);
  });
});
