import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { parseSvgElements, type SvgElement } from './svg';
import { maskFillRatio, maskIoU, rasterizeMask } from './raster';

export interface TileMaskEntry {
  tile: string;
  rotation: 0 | 90 | 180 | 270;
  flip: boolean;
  mask: Uint8Array;
  fillRatio: number;
}

export interface CellMatch {
  kind: 'tile' | 'plain' | 'freeform' | 'review';
  tile?: string;
  rotation?: 0 | 90 | 180 | 270;
  flip?: boolean;
  score?: number;
  candidates: { tile: string; rotation: number; flip: boolean; score: number }[];
}

export const THRESHOLDS = { accept: 0.92, review: 0.75, plainMax: 0.005 } as const;

type Rotation = TileMaskEntry['rotation'];

interface ManifestTile {
  id: string;
  filename: string;
  has_background_rect?: boolean;
  renderable?: boolean;
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const FLIPS = [false, true] as const;
const FILL_RATIO_PREFILTER = 0.15;

export async function buildTileMaskLibrary(
  tilesDir: string,
  manifestPath: string,
  size = 64,
): Promise<TileMaskEntry[]> {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ManifestTile[] | { tiles?: ManifestTile[] };
  const tiles = Array.isArray(manifest) ? manifest : manifest.tiles;
  if (!Array.isArray(tiles)) {
    throw new Error(`Tile manifest must be an array or contain a tiles array: ${manifestPath}`);
  }

  const entries: TileMaskEntry[] = [];
  const skipped: { tile: string; reason: string }[] = [];

  for (const tile of tiles) {
    if (tile.renderable === false) {
      recordSkip(skipped, tile.id, 'renderable=false');
      continue;
    }

    let parsed: ReturnType<typeof parseSvgElements>;
    try {
      parsed = parseSvgElements(readFileSync(join(tilesDir, tile.filename), 'utf8'));
    } catch (error) {
      recordSkip(skipped, tile.id, errorReason(error));
      continue;
    }

    try {
      const foreground = tileForegroundPredicate(tile, parsed.elements, parsed.width, parsed.height);
      if (!parsed.elements.some(foreground)) {
        recordSkip(skipped, tile.id, 'no filled foreground elements');
        continue;
      }

      const baseMask = await rasterizeMask(
        parsed.elements,
        { x: 0, y: 0, w: parsed.width, h: parsed.height },
        size,
        foreground,
      );
      if (maskFillRatio(baseMask) <= 0) {
        recordSkip(skipped, tile.id, 'empty foreground mask');
        continue;
      }

      const seenMasks = new Set<string>();
      for (const rotation of ROTATIONS) {
        for (const flip of FLIPS) {
          const mask = transformMask(baseMask, size, rotation, flip);
          const key = maskKey(mask);
          if (seenMasks.has(key)) {
            continue;
          }
          seenMasks.add(key);
          entries.push({
            tile: tile.id,
            rotation,
            flip,
            mask,
            fillRatio: maskFillRatio(mask),
          });
        }
      }
    } catch (error) {
      recordSkip(skipped, tile.id, errorReason(error));
    }
  }

  if (skipped.length > 0) {
    console.warn(`buildTileMaskLibrary: skipped ${skipped.length} tile(s)`);
  }

  return entries;
}

export function matchCell(cellMask: Uint8Array, library: TileMaskEntry[]): CellMatch {
  const cellFillRatio = maskFillRatio(cellMask);
  if (cellFillRatio < THRESHOLDS.plainMax) {
    return { kind: 'plain', candidates: [] };
  }

  const candidates = library
    .filter(entry => Math.abs(entry.fillRatio - cellFillRatio) <= FILL_RATIO_PREFILTER)
    .map(entry => ({
      tile: entry.tile,
      rotation: entry.rotation,
      flip: entry.flip,
      score: maskIoU(cellMask, entry.mask),
    }))
    .sort(compareCandidates)
    .slice(0, 3);

  const best = candidates[0];
  if (!best) {
    return { kind: 'freeform', candidates };
  }

  if (best.score >= THRESHOLDS.accept) {
    return {
      kind: 'tile',
      tile: best.tile,
      rotation: best.rotation as Rotation,
      flip: best.flip,
      score: best.score,
      candidates,
    };
  }

  if (best.score >= THRESHOLDS.review) {
    return {
      kind: 'review',
      tile: best.tile,
      rotation: best.rotation as Rotation,
      flip: best.flip,
      score: best.score,
      candidates,
    };
  }

  return { kind: 'freeform', candidates };
}

function tileForegroundPredicate(
  tile: ManifestTile,
  elements: SvgElement[],
  width: number,
  height: number,
): (el: SvgElement) => boolean {
  const backgroundIndex = findBackgroundIndex(tile, elements, width, height);
  const foregroundElements = new Set(
    elements.filter((el, index) => {
      if (el.fill === 'none') {
        return false;
      }
      if (backgroundIndex >= 0) {
        return index > backgroundIndex;
      }
      return true;
    }),
  );
  return el => foregroundElements.has(el);
}

function findBackgroundIndex(tile: ManifestTile, elements: SvgElement[], width: number, height: number): number {
  const firstFullTileRect = elements.findIndex(el => isFullTileRect(el, width, height));
  if (tile.has_background_rect === true) {
    return firstFullTileRect;
  }

  // The current reference manifest marks all tiles has_background_rect=false even
  // though many generated SVGs still begin with a full-tile ground rect.
  return firstFullTileRect === 0 ? 0 : -1;
}

function isFullTileRect(el: SvgElement, width: number, height: number): boolean {
  return (
    el.kind === 'rect' &&
    (el.x ?? 0) === 0 &&
    (el.y ?? 0) === 0 &&
    el.w === width &&
    el.h === height
  );
}

function transformMask(mask: Uint8Array, size: number, rotation: Rotation, flip: boolean): Uint8Array {
  if (mask.length !== size * size) {
    throw new Error(`Mask length ${mask.length} does not match ${size}x${size}`);
  }

  const out = new Uint8Array(mask.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [rotatedSourceX, sourceY] = rotationSourceCoordinate(x, y, size, rotation);
      const sourceX = flip ? size - 1 - rotatedSourceX : rotatedSourceX;
      out[y * size + x] = mask[sourceY * size + sourceX] ?? 0;
    }
  }
  return out;
}

function rotationSourceCoordinate(x: number, y: number, size: number, rotation: Rotation): [number, number] {
  if (rotation === 90) {
    return [y, size - 1 - x];
  }
  if (rotation === 180) {
    return [size - 1 - x, size - 1 - y];
  }
  if (rotation === 270) {
    return [size - 1 - y, x];
  }
  return [x, y];
}

function compareCandidates(
  a: { tile: string; rotation: number; flip: boolean; score: number },
  b: { tile: string; rotation: number; flip: boolean; score: number },
): number {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }
  return compareTriples(a, b);
}

function compareTriples(
  a: { tile: string; rotation: number; flip: boolean },
  b: { tile: string; rotation: number; flip: boolean },
): number {
  if (a.tile < b.tile) {
    return -1;
  }
  if (a.tile > b.tile) {
    return 1;
  }
  const rotationOrder = a.rotation - b.rotation;
  if (rotationOrder !== 0) {
    return rotationOrder;
  }
  return Number(a.flip) - Number(b.flip);
}

function maskKey(mask: Uint8Array): string {
  return Buffer.from(mask).toString('base64');
}

function recordSkip(skipped: { tile: string; reason: string }[], tile: string, reason: string): void {
  skipped.push({ tile, reason });
  console.warn(`buildTileMaskLibrary: skipped ${tile}: ${reason}`);
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
