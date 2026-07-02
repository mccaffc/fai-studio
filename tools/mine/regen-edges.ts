/**
 * regen-edges.ts — CLI to regenerate edge_coverage in both tile manifests.
 *
 * For each tile's rotation-0 unflipped mask entry from buildTileMaskLibrary,
 * computes the true per-edge coverage (fraction of 1s along each 64px border
 * row/col: top/right/bottom/left), then rewrites edge_coverage in BOTH:
 *   - corpus/reference/tiles-manifest.json
 *   - corpus/mined-tiles/manifest.json
 *
 * Tiles with no library entry (unrenderable/skipped) keep their old values.
 * Also sets has_background_rect: true for every tile whose library build
 * detected a background (first SVG element is a full-tile rect).
 *
 * Usage:
 *   npm run mine:regen-edges
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildTileMaskLibrary, type TileMaskEntry } from './tile-match.js';
import { parseSvgElements } from './svg.js';
import { resolveCssClasses, resolveTransforms } from './preprocess.js';

const PROJECT_ROOT = resolve('.');
const TILES_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles');
const MANIFEST_PATH = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const MINED_TILES_DIR = join(PROJECT_ROOT, 'corpus', 'mined-tiles');
const MINED_MANIFEST_PATH = join(MINED_TILES_DIR, 'manifest.json');

const SIZE = 64;

// ---------------------------------------------------------------------------
// Edge coverage computation from a 64x64 mask
// ---------------------------------------------------------------------------

function computeEdgeCoverage(mask: Uint8Array, size: number): {
  top: number; right: number; bottom: number; left: number;
} {
  let topCount = 0;
  let bottomCount = 0;
  let leftCount = 0;
  let rightCount = 0;

  for (let x = 0; x < size; x++) {
    // top = row 0
    if (mask[x] !== 0) topCount++;
    // bottom = row (size-1)
    if (mask[(size - 1) * size + x] !== 0) bottomCount++;
  }

  for (let y = 0; y < size; y++) {
    // left = col 0
    if (mask[y * size] !== 0) leftCount++;
    // right = col (size-1)
    if (mask[y * size + (size - 1)] !== 0) rightCount++;
  }

  return {
    top: parseFloat((topCount / size).toFixed(4)),
    right: parseFloat((rightCount / size).toFixed(4)),
    bottom: parseFloat((bottomCount / size).toFixed(4)),
    left: parseFloat((leftCount / size).toFixed(4)),
  };
}

// ---------------------------------------------------------------------------
// Detect has_background_rect by checking whether SVG first element is full-tile rect
// ---------------------------------------------------------------------------

function detectHasBackgroundRect(tilesDir: string, filename: string, width: number, height: number): boolean {
  const svgPath = join(tilesDir, filename);
  if (!existsSync(svgPath)) return false;
  try {
    const rawSvg = readFileSync(svgPath, 'utf8');
    const parsed = parseSvgElements(resolveTransforms(resolveCssClasses(rawSvg)));
    const first = parsed.elements[0];
    if (!first) return false;
    return (
      first.kind === 'rect' &&
      (first.x ?? 0) === 0 &&
      (first.y ?? 0) === 0 &&
      first.w === width &&
      first.h === height
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Manifest type (generic enough to cover both manifest formats)
// ---------------------------------------------------------------------------

interface TileEntry {
  id: string;
  filename: string;
  edge_coverage: { top: number; right: number; bottom: number; left: number };
  has_background_rect?: boolean;
  renderable?: boolean;
  [key: string]: unknown;
}

interface ReferenceManifest {
  tiles?: TileEntry[];
  [key: string]: unknown;
}

type AnyManifest = TileEntry[] | ReferenceManifest;

function getTiles(manifest: AnyManifest): TileEntry[] {
  if (Array.isArray(manifest)) {
    return manifest as TileEntry[];
  }
  return (manifest as ReferenceManifest).tiles ?? [];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[regen-edges] Building tile-mask library...');
  const library: TileMaskEntry[] = await buildTileMaskLibrary(
    TILES_DIR,
    MANIFEST_PATH,
    SIZE,
    { tilesDir: MINED_TILES_DIR, manifestPath: MINED_MANIFEST_PATH },
  );
  console.log(`[regen-edges] Library built: ${library.length} variants`);

  // Build lookup: tile id → rotation-0 unflipped mask entry
  const rot0Library = new Map<string, TileMaskEntry>();
  for (const entry of library) {
    if (entry.rotation === 0 && !entry.flip) {
      rot0Library.set(entry.tile, entry);
    }
  }

  console.log(`[regen-edges] Rotation-0 unflipped entries: ${rot0Library.size}`);

  // ---------------------------------------------------------------------------
  // Process corpus/reference/tiles-manifest.json
  // ---------------------------------------------------------------------------

  const refManifestRaw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as AnyManifest;
  const refTiles = getTiles(refManifestRaw);

  const refSkipped: string[] = [];
  let refBgChanged = 0;
  let refEdgeChanged = 0;

  for (const tile of refTiles) {
    const libEntry = rot0Library.get(tile.id);
    if (!libEntry) {
      refSkipped.push(tile.id);
      continue;
    }

    const newEdges = computeEdgeCoverage(libEntry.mask, SIZE);

    // Check if edges actually changed (log for sample)
    const old = tile.edge_coverage;
    if (
      old.top !== newEdges.top ||
      old.right !== newEdges.right ||
      old.bottom !== newEdges.bottom ||
      old.left !== newEdges.left
    ) {
      if (refEdgeChanged < 5) {
        console.log(
          `[regen-edges] ref ${tile.id}: top ${old.top}→${newEdges.top}, right ${old.right}→${newEdges.right}, bottom ${old.bottom}→${newEdges.bottom}, left ${old.left}→${newEdges.left}`,
        );
      }
      refEdgeChanged++;
    }

    tile.edge_coverage = newEdges;

    // Check has_background_rect: detect from the SVG itself
    if (!tile.has_background_rect) {
      const hasBg = detectHasBackgroundRect(TILES_DIR, tile.filename, 200, 200);
      if (hasBg) {
        tile.has_background_rect = true;
        refBgChanged++;
      }
    }
  }

  if (refSkipped.length > 0) {
    console.log(`[regen-edges] Skipped ${refSkipped.length} reference tiles (no library entry): ${refSkipped.join(', ')}`);
  }
  console.log(`[regen-edges] Reference manifest: ${refEdgeChanged} edge_coverage values updated, ${refBgChanged} has_background_rect set to true`);

  writeFileSync(MANIFEST_PATH, JSON.stringify(refManifestRaw, null, 2) + '\n', 'utf8');
  console.log(`[regen-edges] Wrote ${MANIFEST_PATH}`);

  // ---------------------------------------------------------------------------
  // Process corpus/mined-tiles/manifest.json
  // ---------------------------------------------------------------------------

  if (!existsSync(MINED_MANIFEST_PATH)) {
    console.log('[regen-edges] No mined-tiles manifest found, skipping.');
    return;
  }

  const minedManifestRaw = JSON.parse(readFileSync(MINED_MANIFEST_PATH, 'utf8')) as AnyManifest;
  const minedTiles = getTiles(minedManifestRaw);

  const minedSkipped: string[] = [];
  let minedBgChanged = 0;
  let minedEdgeChanged = 0;

  for (const tile of minedTiles) {
    const libEntry = rot0Library.get(tile.id);
    if (!libEntry) {
      minedSkipped.push(tile.id);
      continue;
    }

    const newEdges = computeEdgeCoverage(libEntry.mask, SIZE);

    const old = tile.edge_coverage;
    if (
      old.top !== newEdges.top ||
      old.right !== newEdges.right ||
      old.bottom !== newEdges.bottom ||
      old.left !== newEdges.left
    ) {
      if (minedEdgeChanged < 5) {
        console.log(
          `[regen-edges] mined ${tile.id}: top ${old.top}→${newEdges.top}, right ${old.right}→${newEdges.right}, bottom ${old.bottom}→${newEdges.bottom}, left ${old.left}→${newEdges.left}`,
        );
      }
      minedEdgeChanged++;
    }

    tile.edge_coverage = newEdges;

    // has_background_rect for mined tiles: detect from the SVG
    if (!tile.has_background_rect) {
      const hasBg = detectHasBackgroundRect(MINED_TILES_DIR, tile.filename, 200, 200);
      if (hasBg) {
        tile.has_background_rect = true;
        minedBgChanged++;
      }
    }
  }

  if (minedSkipped.length > 0) {
    console.log(`[regen-edges] Skipped ${minedSkipped.length} mined tiles (no library entry): ${minedSkipped.join(', ')}`);
  }
  console.log(`[regen-edges] Mined manifest: ${minedEdgeChanged} edge_coverage values updated, ${minedBgChanged} has_background_rect set to true`);

  writeFileSync(MINED_MANIFEST_PATH, JSON.stringify(minedManifestRaw, null, 2) + '\n', 'utf8');
  console.log(`[regen-edges] Wrote ${MINED_MANIFEST_PATH}`);

  console.log('[regen-edges] Done.');
}

main().catch((err: unknown) => {
  console.error('[regen-edges] Fatal error:', err);
  process.exit(1);
});
