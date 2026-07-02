/**
 * render-recon.ts — Shared reconstruction renderer.
 *
 * Extracted from validate-sheet.ts so the sampler harness (tools/grammar/) can
 * reuse it without pulling in the full validation pipeline.
 *
 * renderRecon second-parameter contract:
 *   originalCells: CellSlice[]  — validation mode: freeform/review cells are
 *     copied from the original banner and tinted magenta.
 *   originalCells: null         — sampler mode: freeform cells render as a flat
 *     ink-colored organic placeholder (rounded blob path) instead.  The magenta
 *     tint is ONLY applied when originalCells is provided.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import canvasPkg from 'canvas';
import { parseSvgElements, type SvgElement } from './svg.js';
import { type CellSlice } from './cells.js';
import { resolveCssClasses, resolveTransforms } from './preprocess.js';
import type { BannerRecon, ManifestTile } from './schema.js';

const { createCanvas, loadImage } = canvasPkg;
type NodeCanvas = ReturnType<typeof createCanvas>;

// ---------------------------------------------------------------------------
// Manifest paths (relative to cwd, matching validate-sheet.ts)
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const TILES_DIR = join(ROOT, 'corpus', 'reference', 'tiles');
const MANIFEST_PATH = join(ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const MINED_TILES_DIR = join(ROOT, 'corpus', 'mined-tiles');
const MINED_MANIFEST_PATH = join(MINED_TILES_DIR, 'manifest.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ManifestEntry = ManifestTile & { baseDir: string };

// ---------------------------------------------------------------------------
// Render geometry constants
// ---------------------------------------------------------------------------

const RW = 720, RH = 360, CELL = 120;
const SRC_CELL = 320;
const MAGENTA = 'rgba(214, 58, 140, 0.45)';

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

function loadManifestEntries(manifestPath: string, baseDir: string): ManifestEntry[] {
  const raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as
    | ManifestTile[]
    | { tiles?: ManifestTile[] };
  const arr = Array.isArray(raw) ? raw : (raw.tiles ?? []);
  return arr.map(t => ({ ...t, baseDir }));
}

/**
 * Load the reference + mined-tiles manifests into a single lookup map.
 * Equivalent to validate-sheet's internal `manifestById()`.
 */
export function loadMergedManifest(): Map<string, ManifestEntry> {
  const entries = loadManifestEntries(MANIFEST_PATH, TILES_DIR);
  if (existsSync(MINED_MANIFEST_PATH)) {
    entries.push(...loadManifestEntries(MINED_MANIFEST_PATH, MINED_TILES_DIR));
  }
  return new Map(entries.map(t => [t.id, t]));
}

// ---------------------------------------------------------------------------
// Color-aware element serialization
// ---------------------------------------------------------------------------

export function serializeColored(el: SvgElement, fill: string): string {
  const rule = el.fillRule ? ` fill-rule="${el.fillRule}"` : '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  switch (el.kind) {
    case 'rect': return `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" fill="${fill}"/>`;
    case 'circle': return `<circle cx="${el.cx}" cy="${el.cy}" r="${el.r}" fill="${fill}"/>`;
    case 'ellipse': return `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}" fill="${fill}"/>`;
    case 'path': return `<path d="${esc(el.d!)}"${rule} fill="${fill}"/>`;
  }
}

function svgDoc(viewBox: string, size: { w: number; h: number }, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size.w}" height="${size.h}">${body}</svg>`;
}

// ---------------------------------------------------------------------------
// Tile background detection (mirrors tile-match.ts's rule)
// ---------------------------------------------------------------------------

export function tileBackgroundIndex(elements: SvgElement[], hasBackgroundRect: boolean): number {
  const first = elements[0];
  const isFullTileRect = first && first.kind === 'rect'
    && (first.x ?? 0) === 0 && (first.y ?? 0) === 0 && first.w === 200 && first.h === 200;
  if (hasBackgroundRect || isFullTileRect) return 0;
  return -1;
}

// ---------------------------------------------------------------------------
// Recolored tile image cache
// ---------------------------------------------------------------------------

const tileImgCache = new Map<string, Promise<canvasPkg.Image>>();

export function recoloredTile(
  tileId: string, ink: string, ground: string,
  manifest: Map<string, ManifestEntry>,
): Promise<canvasPkg.Image> {
  const key = `${tileId}|${ink}|${ground}`;
  let cached = tileImgCache.get(key);
  if (cached) return cached;
  cached = (async () => {
    const entry = manifest.get(tileId);
    if (!entry) throw new Error(`tile ${tileId} not in manifest`);
    const raw = readFileSync(join(entry.baseDir, entry.filename), 'utf8');
    const parsed = parseSvgElements(resolveTransforms(resolveCssClasses(raw)));
    const bgIdx = tileBackgroundIndex(parsed.elements, entry.has_background_rect === true);
    const bgFill = bgIdx >= 0 ? parsed.elements[bgIdx]!.fill : undefined;
    const body = parsed.elements
      .map((el, i) => {
        if (i === bgIdx || el.fill === 'none') return '';        // bg → transparent
        return serializeColored(el, el.fill === bgFill ? ground : ink); // cutouts → ground, fg → ink
      })
      .join('');
    return loadImage(Buffer.from(svgDoc('0 0 200 200', { w: 200, h: 200 }, body)));
  })();
  tileImgCache.set(key, cached);
  return cached;
}

// ---------------------------------------------------------------------------
// Freeform placeholder (sampler mode — no original to copy from)
// ---------------------------------------------------------------------------

/**
 * Builds a rounded blob SVG path centered in a CELL×CELL square.
 * Uses a squircle-ish cubic Bezier at ~70% cell size.
 */
function freeformBlobSvg(ink: string, cellSize: number): string {
  const r = (cellSize * 0.70) / 2;   // ~70% of cell size, half = radius
  const c = cellSize / 2;             // center
  const k = r * 0.55;                 // cubic Bezier handle (~0.55 * r approximates a circle)
  const d = [
    `M ${c} ${c - r}`,
    `C ${c + k} ${c - r} ${c + r} ${c - k} ${c + r} ${c}`,
    `C ${c + r} ${c + k} ${c + k} ${c + r} ${c} ${c + r}`,
    `C ${c - k} ${c + r} ${c - r} ${c + k} ${c - r} ${c}`,
    `C ${c - r} ${c - k} ${c - k} ${c - r} ${c} ${c - r}`,
    'Z',
  ].join(' ');
  return svgDoc(`0 0 ${cellSize} ${cellSize}`, { w: cellSize, h: cellSize },
    `<path d="${d}" fill="${ink}"/>`);
}

// ---------------------------------------------------------------------------
// Reconstruction renderer
// ---------------------------------------------------------------------------

/**
 * Render a banner reconstruction canvas.
 *
 * @param banner        - The mined BannerRecon record.
 * @param originalCells - CellSlice[] for validation (copies freeform cells from original,
 *                        applies magenta tint), or null for sampler mode (renders a flat
 *                        ink-colored organic placeholder instead; no magenta tint).
 * @param manifest      - Merged manifest map from loadMergedManifest().
 */
export async function renderRecon(
  banner: BannerRecon,
  originalCells: CellSlice[] | null,
  manifest: Map<string, ManifestEntry>,
): Promise<NodeCanvas> {
  const cv = createCanvas(RW, RH);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = banner.ground;
  ctx.fillRect(0, 0, RW, RH);

  for (const cell of banner.cells) {
    const x = cell.col * CELL, y = cell.row * CELL;
    if (cell.ground !== banner.ground) {
      ctx.fillStyle = cell.ground;
      ctx.fillRect(x, y, CELL, CELL);
    }
  }

  for (const cell of banner.cells) {
    const x = cell.col * CELL, y = cell.row * CELL;
    if (cell.kind === 'tile' && cell.tile) {
      const img = await recoloredTile(cell.tile, cell.ink ?? '#F3F3F3', cell.ground, manifest);
      ctx.save();
      ctx.translate(x + CELL / 2, y + CELL / 2);
      ctx.rotate(((cell.rotation ?? 0) * Math.PI) / 180);
      if (cell.flip) ctx.scale(-1, 1);
      ctx.drawImage(img, -CELL / 2, -CELL / 2, CELL, CELL);
      ctx.restore();
    } else if (cell.kind === 'freeform' || cell.kind === 'review') {
      if (originalCells !== null) {
        // Validation mode: copy original foreground, tint magenta
        const slice = originalCells.find(c => c.col === cell.col && c.row === cell.row);
        if (slice && slice.foreground.length) {
          const body = slice.foreground
            .filter(el => el.fill !== 'none')
            .map(el => serializeColored(el, el.fill))
            .join('');
          const vb = `${cell.col * SRC_CELL} ${cell.row * SRC_CELL} ${SRC_CELL} ${SRC_CELL}`;
          const img = await loadImage(Buffer.from(svgDoc(vb, { w: CELL, h: CELL }, body)));
          ctx.drawImage(img, x, y, CELL, CELL);
        }
        ctx.fillStyle = MAGENTA;
        ctx.fillRect(x, y, CELL, CELL);
      } else {
        // Sampler mode: flat ink-colored organic placeholder (no magenta tint)
        const ink = cell.ink ?? '#888888';
        const blobSvg = freeformBlobSvg(ink, CELL);
        const img = await loadImage(Buffer.from(blobSvg));
        ctx.drawImage(img, x, y, CELL, CELL);
      }
    }
    // 'plain' → ground already painted
  }
  return cv;
}
