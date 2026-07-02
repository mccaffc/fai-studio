import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadMergedManifest } from '../../tools/mine/render-recon';
import { composeGrammar } from '../../tools/grammar/grammar-schema';
import type { Corpus } from '../../tools/mine/schema';
import type { ManifestTile } from '../../tools/mine/schema';

let result: ReturnType<typeof composeGrammar>;
let manifest: Map<string, ManifestTile & { baseDir: string }>;

beforeAll(() => {
  const corpus: Corpus = JSON.parse(readFileSync('corpus/corpus.json', 'utf8'));
  manifest = loadMergedManifest();
  result = composeGrammar(corpus, manifest);
});

describe('composeGrammar', () => {
  it('produces exactly 6 templates', () => {
    expect(result.templates).toHaveLength(6);
  });

  it('tileCatalog has >80 entries and every entry family matches the manifest', () => {
    const entries = Object.entries(result.tileCatalog);
    expect(entries.length).toBeGreaterThan(80);
    for (const [id, entry] of entries) {
      const tile = manifest.get(id);
      expect(tile, `tile ${id} not in manifest`).toBeDefined();
      expect(entry.family).toBe(tile!.shape_family);
    }
  });

  it('accentOrder[0] is #FF4F00 (the most-used accent ink)', () => {
    expect(result.palette.accentOrder[0]).toBe('#FF4F00');
  });
});
