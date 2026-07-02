import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeStats } from '../../tools/grammar/stats';
import { computeFeatures, type BannerFeatures } from '../../tools/grammar/features';
import { assignTemplates, TEMPLATE_MEMBERS } from '../../tools/grammar/templates';
import { loadMergedManifest } from '../../tools/mine/render-recon';
import type { Corpus } from '../../tools/mine/schema';

let features: BannerFeatures[];
let templates: ReturnType<typeof assignTemplates>;

beforeAll(() => {
  const corpus: Corpus = JSON.parse(readFileSync('corpus/corpus.json', 'utf8'));
  const manifest = loadMergedManifest();
  const stats = computeStats(corpus, manifest);
  features = corpus.banners.map(b => computeFeatures(b, stats, manifest));
  templates = assignTemplates(features);
});

describe('template induction', () => {
  it('covers all 50 banners exactly once', () => {
    const all = templates.flatMap(t => t.bannerIds);
    expect(all).toHaveLength(50);
    expect(new Set(all).size).toBe(50);
  });

  it('has six templates with the judged member counts', () => {
    const counts = Object.fromEntries(templates.map(t => [t.id, t.bannerIds.length]));
    expect(counts).toEqual({
      'pipe-field': 13, 'arc-mosaic': 9, 'checker-motif': 6,
      'repeat-rhythm': 6, 'figure-field': 11, 'mixed-quilt': 5,
    });
  });

  it('every template spec range contains every member (self-consistency)', () => {
    const byId = new Map(features.map(f => [f.id, f]));
    for (const t of templates) {
      for (const b of t.bannerIds) {
        const f = byId.get(b)!;
        expect(t.spec.groundSchemes).toContain(f.groundScheme);
        expect(t.spec.dominantFamilies).toContain(f.dominantFamily);
        const inRange = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;
        expect(inRange(f.distinctTiles, t.spec.distinctTiles), `${t.id}/${b} distinctTiles`).toBe(true);
        expect(inRange(f.formCounts.run, t.spec.forms.run), `${t.id}/${b} runs`).toBe(true);
        expect(inRange(f.formCounts.frieze, t.spec.forms.frieze), `${t.id}/${b} friezes`).toBe(true);
        expect(inRange(f.figureShare, t.spec.figureShare), `${t.id}/${b} figureShare`).toBe(true);
        expect(inRange(f.plainShare, t.spec.plainShare), `${t.id}/${b} plainShare`).toBe(true);
        expect(inRange(f.lineworkShare, t.spec.lineworkShare), `${t.id}/${b} lineworkShare`).toBe(true);
      }
    }
  });

  it('pipe-field members are linework-dominant (the signature holds)', () => {
    const pipe = templates.find(t => t.id === 'pipe-field')!;
    expect(pipe.spec.lineworkShare[0]).toBeGreaterThanOrEqual(0.7);
  });

  it('figure-field members carry the corpus figure content', () => {
    const fig = templates.find(t => t.id === 'figure-field')!;
    const byId = new Map(features.map(f => [f.id, f]));
    const share = fig.bannerIds.reduce((s, b) => s + byId.get(b)!.figureShare, 0) / fig.bannerIds.length;
    expect(share).toBeGreaterThan(0.15); // figures concentrate here, not scattered elsewhere
  });

  it('membership matches the committed judgment verbatim', () => {
    // guard against silent edits: the assignment IS the deliverable
    expect(TEMPLATE_MEMBERS['pipe-field']!.bannerIds).toEqual(
      ['002', '005', '008', '009', '010', '019', '020', '023', '025', '039', '040', '048', '049']);
    expect(TEMPLATE_MEMBERS['checker-motif']!.bannerIds).toEqual(
      ['013', '017', '030', '033', '034', '046']);
  });
});
