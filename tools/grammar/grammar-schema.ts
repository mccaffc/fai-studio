/**
 * grammar-schema.ts — Grammar interface + composeGrammar function.
 *
 * The Grammar is the single artifact passed to the sampler (P1 Task 4). It
 * bundles the corpus stats, composition templates, a tile catalog, and palette
 * summary into one deterministic JSON blob.
 *
 * ## Economy array alignment
 * `stats.economy.distinctTilesPerBanner` and `stats.economy.dominantFamilyShare`
 * are parallel arrays aligned with `corpus.banners` order (i.e. index 0 in the
 * economy arrays corresponds to `corpus.banners[0]`).
 *
 * ## Rotation stats and symmetric tiles
 * `tileCatalog[id].rotations` is the dedup-canonical rotation histogram from
 * `stats.tileRotations`: for a tile that is 4-fold rotationally symmetric the
 * four rotation buckets will all be non-zero because every rotation was recorded
 * as observed, not deduplicated at mining time. The catalog is a verbatim copy
 * of the stats for the sampler to use.
 */

import type { Corpus, ManifestTile } from '../mine/schema.js';
import { computeStats, type StatsTables } from './stats.js';
import { computeFeatures } from './features.js';
import { assignTemplates, type Template } from './templates.js';
import { NEUTRAL_INKS } from './features.js';

export interface TileCatalogEntry {
  family: string;
  edges: { top: number; right: number; bottom: number; left: number };
  /** Dedup-canonical rotation histogram keyed '0'|'90'|'180'|'270'. */
  rotations: Record<string, number>;
  /** Fraction of usages where flip=true. */
  flipShare: number;
}

export interface Grammar {
  schemaVersion: 1;
  /** ISO timestamp; stamped by the CLI main(), not by composeGrammar(). */
  builtAt: string;
  stats: StatsTables;
  templates: Template[];
  /** One entry per tile that appears ≥1 time in the corpus (~85 tiles). */
  tileCatalog: Record<string, TileCatalogEntry>;
  palette: {
    /** Global-ground color counts across all banners. */
    globalGrounds: Record<string, number>;
    /** Ink frequencies keyed by ground color. */
    inkByGround: Record<string, Record<string, number>>;
    /**
     * Non-neutral inks ordered by corpus frequency (descending).
     * Expected: ['#FF4F00','#4997D0','#FFA300'] given current corpus counts.
     */
    accentOrder: string[];
  };
}

/**
 * Compose the grammar from corpus + manifest. Returns everything except
 * `builtAt` so the CLI can stamp it separately and callers (tests) can check
 * determinism with a simple deep-equal.
 */
export function composeGrammar(
  corpus: Corpus,
  manifest: Map<string, ManifestTile & { baseDir: string }>,
): Omit<Grammar, 'builtAt'> {
  const stats = computeStats(corpus, manifest);
  const features = corpus.banners.map(b => computeFeatures(b, stats, manifest));
  const templates = assignTemplates(features);

  // --- tile catalog: entries for tiles that appear ≥1 time in the corpus ---
  const tileCatalog: Record<string, TileCatalogEntry> = {};
  for (const [tileId] of Object.entries(stats.tiles)) {
    const entry = manifest.get(tileId);
    if (!entry) continue;
    tileCatalog[tileId] = {
      family: entry.shape_family,
      edges: entry.edge_coverage,
      rotations: stats.tileRotations[tileId] ?? { '0': 0, '90': 0, '180': 0, '270': 0 },
      flipShare: stats.tileFlipShare[tileId] ?? 0,
    };
  }

  // --- accentOrder: non-neutral inks by corpus frequency (desc), ties hex-asc ---
  const accentFreqs = new Map<string, number>();
  for (const [, inkMap] of Object.entries(stats.inkByGround)) {
    for (const [ink, n] of Object.entries(inkMap)) {
      if (!NEUTRAL_INKS.has(ink)) {
        accentFreqs.set(ink, (accentFreqs.get(ink) ?? 0) + n);
      }
    }
  }
  const accentOrder = [...accentFreqs.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([hex]) => hex);

  // key order normalized here so composeGrammar's return value is deterministic for direct consumers, not just the serialized CLI artifact
  const sortedTileCatalog: Record<string, TileCatalogEntry> = {};
  for (const key of Object.keys(tileCatalog).sort()) {
    sortedTileCatalog[key] = tileCatalog[key]!;
  }

  const sortedGlobalGrounds: Record<string, number> = {};
  for (const key of Object.keys(stats.globalGrounds).sort()) {
    sortedGlobalGrounds[key] = stats.globalGrounds[key]!;
  }

  const sortedInkByGround: Record<string, Record<string, number>> = {};
  for (const groundKey of Object.keys(stats.inkByGround).sort()) {
    const inkMap = stats.inkByGround[groundKey]!;
    const sortedInkMap: Record<string, number> = {};
    for (const inkKey of Object.keys(inkMap).sort()) {
      sortedInkMap[inkKey] = inkMap[inkKey]!;
    }
    sortedInkByGround[groundKey] = sortedInkMap;
  }

  return {
    schemaVersion: 1,
    stats,
    templates,
    tileCatalog: sortedTileCatalog,
    palette: {
      globalGrounds: sortedGlobalGrounds,
      inkByGround: sortedInkByGround,
      accentOrder,
    },
  };
}
