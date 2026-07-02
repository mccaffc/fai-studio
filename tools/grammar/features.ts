/**
 * features.ts — per-banner feature vectors for template induction.
 *
 * Pure derivation from a mined BannerRecon + the corpus StatsTables. These are
 * the axes Claude clusters on when inducing composition templates (P1 Task 2);
 * they are also reused by the sampler tests to check that a sampled plan lands
 * inside its template's spec ranges.
 */

import type { BannerRecon, ManifestTile } from '../mine/schema.js';
import type { StatsTables, GroundSchemeKind } from './stats.js';

/** Families whose cells read as line-work in the canonical sense. */
export const LINEWORK_FAMILIES = new Set(['lines', 'circle', 'curve', 'wave']);

/** Neutral inks — everything else counts as an accent. */
export const NEUTRAL_INKS = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);

export interface BannerFeatures {
  id: string;
  groundScheme: GroundSchemeKind;
  dominantFamily: string;
  dominantShare: number;      // dominant-family cells / tile cells (0 when no tile cells)
  distinctTiles: number;
  formCounts: { run: number; frieze: number; figure: number };
  friezeRow: number | null;   // row of the largest frieze (ties → lowest row)
  figureShare: number;        // freeform cells / 18
  plainShare: number;         // plain cells / 18
  accentInks: string[];       // non-neutral inks present, by cell count desc (ties hex-asc)
  lineworkShare: number;      // linework-family cells / tile cells (0 when no tile cells)
}

export function computeFeatures(
  banner: BannerRecon,
  stats: StatsTables,
  manifest: Map<string, ManifestTile & { baseDir: string }>,
): BannerFeatures {
  const cells = banner.cells;
  const tileCells = cells.filter(c => c.kind === 'tile' && c.tile);

  // family tallies
  const famCounts = new Map<string, number>();
  let linework = 0;
  const distinct = new Set<string>();
  for (const c of tileCells) {
    const fam = manifest.get(c.tile!)?.shape_family ?? '?';
    famCounts.set(fam, (famCounts.get(fam) ?? 0) + 1);
    if (LINEWORK_FAMILIES.has(fam)) linework++;
    distinct.add(c.tile!);
  }
  let dominantFamily = 'none';
  let dominantCount = 0;
  for (const [fam, n] of [...famCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    dominantFamily = fam; dominantCount = n; break;
  }

  // forms
  const formCounts = { run: 0, frieze: 0, figure: 0 };
  let friezeRow: number | null = null;
  let friezeBest = 0;
  for (const f of banner.forms) {
    formCounts[f.kind]++;
    if (f.kind === 'frieze') {
      const rows = f.cells.map(([, r]) => r);
      const row = Math.min(...rows);
      if (f.cells.length > friezeBest || (f.cells.length === friezeBest && (friezeRow === null || row < friezeRow))) {
        friezeBest = f.cells.length;
        friezeRow = row;
      }
    }
  }

  // accent inks by cell count
  const accentCounts = new Map<string, number>();
  for (const c of cells) {
    if (c.ink && !NEUTRAL_INKS.has(c.ink)) accentCounts.set(c.ink, (accentCounts.get(c.ink) ?? 0) + 1);
  }
  const accentInks = [...accentCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([hex]) => hex);

  const scheme = stats.groundSchemes.perBanner[banner.id];

  return {
    id: banner.id,
    groundScheme: scheme ? scheme.kind : 'uniform',
    dominantFamily,
    dominantShare: tileCells.length ? dominantCount / tileCells.length : 0,
    distinctTiles: distinct.size,
    formCounts,
    friezeRow,
    figureShare: cells.filter(c => c.kind === 'freeform').length / cells.length,
    plainShare: cells.filter(c => c.kind === 'plain').length / cells.length,
    accentInks,
    lineworkShare: tileCells.length ? linework / tileCells.length : 0,
  };
}
