import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  measureCompositionLaws,
  renderMeasurementTables,
  type CompositionLawMeasurements,
} from '../../tools/grammar/composition-stats';
import { loadMergedManifest } from '../../tools/mine/render-recon';
import type { Corpus } from '../../tools/mine/schema';

function loadCorpus(): Corpus {
  return JSON.parse(readFileSync('corpus/corpus.json', 'utf8')) as Corpus;
}

function topLevelKeys(measurements: CompositionLawMeasurements): string[] {
  return Object.keys(measurements).sort();
}

describe('composition law canon measurement tool', () => {
  it('runs over the real corpus and keeps the JSON schema surface stable', () => {
    const measurements = measureCompositionLaws(loadCorpus(), loadMergedManifest());

    expect(topLevelKeys(measurements)).toEqual([
      'aggregates',
      'banners',
      'definitions',
      'schemaVersion',
      'source',
    ]);
    expect(measurements.schemaVersion).toBe(1);
    expect(measurements.source).toMatchObject({
      corpusPath: 'corpus/corpus.json',
      bannerCount: 50,
      neutralFills: ['#121212', '#D9D9D6', '#F3F3F3', '#FFFFFF'],
      rhythmTemplates: ['checker-motif', 'repeat-rhythm'],
    });
    expect(measurements.banners).toHaveLength(50);
    expect(measurements.banners[0]).toEqual(expect.objectContaining({
      id: '001',
      templateId: 'mixed-quilt',
      accentProximity: expect.any(Object),
    }));
    expect(measurements.aggregates.accentProximity.accentedBannerCount).toBeGreaterThan(0);
    expect(measurements.aggregates.focalPosition.detectableBannerCount).toBeGreaterThan(0);
    expect(measurements.aggregates.rhythmBreak.measuredBannerCount).toBe(12);

    const tables = renderMeasurementTables(measurements);
    expect(tables).toContain('## Accent proximity by accented banner');
    expect(tables).toContain('## Focal position by detectable banner');
    expect(tables).toContain('## Rhythm break line table');
  });
});
