/**
 * data.test.ts — Drift guard for the generated engine corpus modules.
 *
 * Recomputes the source hash from actual files and asserts it matches the hash
 * embedded in both generated modules, catching stale regeneration.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Import generated modules
// ---------------------------------------------------------------------------

import { GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';

// ---------------------------------------------------------------------------
// Hash recomputation (mirrors gen-engine-data.ts logic exactly)
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const GRAMMAR_PATH = join(ROOT, 'corpus', 'grammar.json');
const TILES_DIR = join(ROOT, 'corpus', 'reference', 'tiles');
const MANIFEST_PATH = join(ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const MINED_TILES_DIR = join(ROOT, 'corpus', 'mined-tiles');
const MINED_MANIFEST_PATH = join(MINED_TILES_DIR, 'manifest.json');

interface ManifestEntry {
  id: string;
  filename: string;
  baseDir: string;
}

function loadManifestEntries(manifestPath: string, baseDir: string): ManifestEntry[] {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as
    | Array<{ id: string; filename: string }>
    | { tiles?: Array<{ id: string; filename: string }> };
  const arr = Array.isArray(raw) ? raw : (raw.tiles ?? []);
  return arr.map(t => ({ ...t, baseDir }));
}

function loadMergedManifestForHash(): Map<string, ManifestEntry> {
  const entries = loadManifestEntries(MANIFEST_PATH, TILES_DIR);
  if (existsSync(MINED_MANIFEST_PATH)) {
    entries.push(...loadManifestEntries(MINED_MANIFEST_PATH, MINED_TILES_DIR));
  }
  return new Map(entries.map(t => [t.id, t]));
}

function computeSourceHash(grammarJson: string, manifest: Map<string, ManifestEntry>): string {
  const hash = createHash('sha256');
  hash.update(grammarJson);
  const sortedIds = [...manifest.keys()].sort();
  for (const id of sortedIds) {
    const entry = manifest.get(id)!;
    try {
      const svg = readFileSync(join(entry.baseDir, entry.filename), 'utf8');
      hash.update(id);
      hash.update(svg);
    } catch {
      // skip missing files
    }
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Extract embedded hash from a generated file
// ---------------------------------------------------------------------------

function extractHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  const m = content.match(/^\/\/ source-hash: ([0-9a-f]{64})$/m);
  if (!m) throw new Error(`No source-hash comment found in ${filePath}`);
  return m[1]!;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let freshHash: string;
let grammarFileHash: string;
let tilesFileHash: string;

beforeAll(() => {
  const grammarJson = readFileSync(GRAMMAR_PATH, 'utf8');
  const manifest = loadMergedManifestForHash();
  freshHash = computeSourceHash(grammarJson, manifest);

  grammarFileHash = extractHash(join(ROOT, 'src', 'engine', 'corpus', 'data', 'grammar.ts'));
  tilesFileHash = extractHash(join(ROOT, 'src', 'engine', 'corpus', 'data', 'tiles.ts'));
});

describe('engine corpus data — drift guard', () => {
  it('grammar.ts source-hash matches freshly computed hash', () => {
    expect(grammarFileHash).toBe(freshHash);
  });

  it('tiles.ts source-hash matches freshly computed hash', () => {
    expect(tilesFileHash).toBe(freshHash);
  });

  it('grammar.ts and tiles.ts have the same source-hash', () => {
    expect(grammarFileHash).toBe(tilesFileHash);
  });
});

describe('engine corpus data — structural assertions', () => {
  it('GRAMMAR.templates.length === 6', () => {
    expect((GRAMMAR.templates as unknown[]).length).toBe(6);
  });

  it('TILES count matches tileCatalog count', () => {
    expect(Object.keys(TILES).length).toBe(Object.keys(GRAMMAR.tileCatalog).length);
  });

  it('every TILES entry has >= 1 element', () => {
    for (const [id, tile] of Object.entries(TILES)) {
      expect(tile.elements.length, `tile ${id} has no elements`).toBeGreaterThanOrEqual(1);
    }
  });

  it('freestyle vocabulary tiles have catalog families, real edge profiles, and renderable SVG elements', () => {
    const entries = Object.entries(TILES)
      .filter(([id]) => id.startsWith('mined-fs-'))
      .sort(([a], [b]) => a.localeCompare(b));
    expect(entries.length).toBeGreaterThan(0);

    for (const [id, tile] of entries) {
      const catalog = GRAMMAR.tileCatalog[id];
      expect(catalog, `${id} missing from grammar tileCatalog`).toBeDefined();
      if (!catalog) throw new Error(`${id} missing from grammar tileCatalog`);
      expect(tile.family, `${id} tile family`).toBe(catalog.family);
      expect(['float', 'wave'], `${id} expected vocabulary family`).toContain(tile.family);
      expect(tile.elements.length, `${id} has no renderable elements`).toBeGreaterThan(0);

      expect(catalog.profiles, `${id} missing edge profiles`).toBeDefined();
      const profiles = catalog.profiles!;
      let nonZeroProfiles = 0;
      for (const key of ['0/-', '0/f', '90/-', '90/f', '180/-', '180/f', '270/-', '270/f'] as const) {
        const profile = profiles[key];
        expect(profile, `${id} missing profile ${key}`).toBeDefined();
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          expect(profile[side], `${id} profile ${key}.${side}`).toMatch(/^[0-9a-f]{16}$/);
        }
        if (profile.top + profile.right + profile.bottom + profile.left !== '0000000000000000000000000000000000000000000000000000000000000000') {
          nonZeroProfiles += 1;
        }
      }
      expect(nonZeroProfiles, `${id} profile set is all-zero`).toBeGreaterThan(0);

      const edges = catalog.edges;
      expect(edges.top + edges.right + edges.bottom + edges.left, `${id} has all-zero edge coverage`).toBeGreaterThan(0);
    }
  });
});
