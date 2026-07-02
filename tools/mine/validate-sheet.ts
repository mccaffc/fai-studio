/**
 * validate-sheet.ts — Visual validation of the mined corpus.
 *
 * For each banner in corpus/corpus.json, reconstructs the banner from its mined
 * structure (tiles placed with rotation/flip, recolored; freeform/review cells
 * copied from the original and tinted magenta), renders it next to the original,
 * and computes per-cell + whole-image agreement.
 *
 * Outputs:
 *   corpus/validation/sheet-N.png   (10 banners per sheet: original | recon | heat)
 *   corpus/validation/report.json   (per-banner agreement + per-cell scores)
 *
 * Transform convention (matches tile-match transformMask): a matched (rotation,
 * flip) means the tile mask was FLIPPED HORIZONTALLY FIRST, then rotated CW.
 * Canvas equivalent: translate(center) → rotate(θ) → scale(-1,1 if flip) → draw.
 * The per-cell agreement scores verify this round-trip empirically.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import canvasPkg from 'canvas';
import { parseSvgElements, type SvgElement } from './svg.js';
import { segmentCells, type CellSlice } from './cells.js';
import { resolveCssClasses, resolveTransforms } from './preprocess.js';
import { ensureBackgroundRect } from './preprocess.js';
import type { Corpus, BannerRecon, CellRecon } from './schema.js';
import type { ManifestTile } from './forms.js';

const { createCanvas, loadImage } = canvasPkg;
type NodeCanvas = ReturnType<typeof createCanvas>;
type Ctx = ReturnType<NodeCanvas['getContext']>;

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const BANNERS_DIR = join(ROOT, 'corpus', 'reference', 'banners');
const TILES_DIR = join(ROOT, 'corpus', 'reference', 'tiles');
const MANIFEST_PATH = join(ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const OUT_DIR = join(ROOT, 'corpus', 'validation');

// Render geometry: 720×360 → each of the 6×3 cells is exactly 120×120.
const RW = 720, RH = 360, CELL = 120;
const SRC_CELL = 320;
const MAGENTA = 'rgba(214, 58, 140, 0.45)';
const BANNERS_PER_SHEET = 10;
const HEAT_W = 200;

interface CellScore { col: number; row: number; kind: string; agreement: number }
interface BannerScore { id: string; agreement: number; matchRate: number; cells: CellScore[] }

function manifestById(): Map<string, ManifestTile & { filename: string }> {
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const arr: (ManifestTile & { filename: string })[] = Array.isArray(raw) ? raw : raw.tiles;
  return new Map(arr.map(t => [t.id, t]));
}

// --- color-aware element serialization (raster.ts's serializer is mask-only) ---
function serializeColored(el: SvgElement, fill: string): string {
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

// --- tile background rule (mirrors tile-match's rule) ---
function tileBackgroundIndex(elements: SvgElement[], hasBackgroundRect: boolean): number {
  const first = elements[0];
  const isFullTileRect = first && first.kind === 'rect'
    && (first.x ?? 0) === 0 && (first.y ?? 0) === 0 && first.w === 200 && first.h === 200;
  if (hasBackgroundRect || isFullTileRect) return 0;
  return -1;
}

// --- recolored tile image cache ---
const tileImgCache = new Map<string, Promise<canvasPkg.Image>>();

function recoloredTile(
  tileId: string, ink: string, ground: string,
  manifest: Map<string, ManifestTile & { filename: string }>,
): Promise<canvasPkg.Image> {
  const key = `${tileId}|${ink}|${ground}`;
  let cached = tileImgCache.get(key);
  if (cached) return cached;
  cached = (async () => {
    const entry = manifest.get(tileId);
    if (!entry) throw new Error(`tile ${tileId} not in manifest`);
    const raw = readFileSync(join(TILES_DIR, entry.filename), 'utf8');
    const parsed = parseSvgElements(resolveTransforms(resolveCssClasses(raw)));
    const bgIdx = tileBackgroundIndex(parsed.elements, (entry as any).has_background_rect === true);
    const bgFill = bgIdx >= 0 ? parsed.elements[bgIdx]!.fill : undefined;
    const body = parsed.elements
      .map((el, i) => {
        if (i === bgIdx || el.fill === 'none') return '';        // bg → transparent (cell ground shows)
        return serializeColored(el, el.fill === bgFill ? ground : ink); // cutouts → ground, fg → ink
      })
      .join('');
    return loadImage(Buffer.from(svgDoc('0 0 200 200', { w: 200, h: 200 }, body)));
  })();
  tileImgCache.set(key, cached);
  return cached;
}

// --- reconstruction ---
async function renderRecon(
  banner: BannerRecon,
  originalCells: CellSlice[],
  manifest: Map<string, ManifestTile & { filename: string }>,
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
      // Copy the ORIGINAL banner's foreground for this cell, tinted magenta:
      // shows in context what mining could not explain.
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
    }
    // 'plain' → ground already painted
  }
  return cv;
}

// --- agreement ---
function cellAgreement(a: Uint8ClampedArray, b: Uint8ClampedArray, col: number, row: number): number {
  let match = 0, total = 0;
  for (let dy = 0; dy < CELL; dy++) {
    const py = row * CELL + dy;
    for (let dx = 0; dx < CELL; dx++) {
      const px = col * CELL + dx;
      const i = (py * RW + px) * 4;
      total++;
      if (Math.abs(a[i]! - b[i]!) <= 12 && Math.abs(a[i + 1]! - b[i + 1]!) <= 12 && Math.abs(a[i + 2]! - b[i + 2]!) <= 12) match++;
    }
  }
  return match / total;
}

function heatColor(score: number, kind: string): string {
  if (kind === 'freeform' || kind === 'review') return '#D63A8C';
  if (score >= 0.97) return '#268B41';
  if (score >= 0.90) return '#8fbf3f';
  if (score >= 0.80) return '#FFA300';
  return '#FF4F00';
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const corpus: Corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
  const manifest = manifestById();
  const scores: BannerScore[] = [];

  const sheets: NodeCanvas[] = [];
  let sheet: NodeCanvas | null = null;
  let sheetCtx: Ctx | null = null;
  let rowInSheet = 0;
  const ROW_H = RH + 20;
  const SHEET_W = RW * 2 + HEAT_W + 40;

  for (const banner of corpus.banners) {
    // original: librsvg renders the raw file (CSS classes + transforms handled natively).
    // librsvg's loadImage requires explicit width/height on the root <svg> — the three
    // Illustrator-exported banners (016/018/019) carry only a viewBox, so inject them.
    const rawSvg = readFileSync(join(BANNERS_DIR, `${banner.id}.svg`), 'utf8');
    const displaySvg = /<svg[^>]*\bwidth=/.test(rawSvg)
      ? rawSvg
      : rawSvg.replace(/<svg\b/, '<svg width="1920" height="960"');
    const origImg = await loadImage(Buffer.from(displaySvg));
    const origCv = createCanvas(RW, RH);
    const origCtx = origCv.getContext('2d');
    origCtx.fillStyle = '#FFFFFF'; // viewer default under transparent-bg banners (e.g. 021)
    origCtx.fillRect(0, 0, RW, RH);
    origCtx.drawImage(origImg, 0, 0, RW, RH);

    // parsed original cells (for freeform/review copy-through)
    const pre = resolveTransforms(resolveCssClasses(ensureBackgroundRect(rawSvg)));
    const segmented = segmentCells(parseSvgElements(pre));

    const reconCv = await renderRecon(banner, segmented.cells, manifest);

    const a = origCtx.getImageData(0, 0, RW, RH).data;
    const b = reconCv.getContext('2d').getImageData(0, 0, RW, RH).data;

    const cellScores: CellScore[] = banner.cells.map(c => ({
      col: c.col, row: c.row, kind: c.kind,
      agreement: cellAgreement(a, b, c.col, c.row),
    }));
    const whole = cellScores.reduce((s, c) => s + c.agreement, 0) / cellScores.length;
    scores.push({ id: banner.id, agreement: Number(whole.toFixed(4)), matchRate: banner.matchRate, cells: cellScores });

    // sheet row
    if (!sheet || rowInSheet === BANNERS_PER_SHEET) {
      sheet = createCanvas(SHEET_W, ROW_H * BANNERS_PER_SHEET + 20);
      sheetCtx = sheet.getContext('2d');
      sheetCtx.fillStyle = '#2a2a2a';
      sheetCtx.fillRect(0, 0, SHEET_W, ROW_H * BANNERS_PER_SHEET + 20);
      sheets.push(sheet);
      rowInSheet = 0;
    }
    const sy = rowInSheet * ROW_H + 10;
    sheetCtx!.drawImage(origCv, 10, sy);
    sheetCtx!.drawImage(reconCv, RW + 20, sy);
    // heat strip: 6×3 grid of 30px cells + label
    const hx = RW * 2 + 30;
    for (const cs of cellScores) {
      sheetCtx!.fillStyle = heatColor(cs.agreement, cs.kind);
      sheetCtx!.fillRect(hx + cs.col * 30, sy + cs.row * 30, 28, 28);
    }
    sheetCtx!.fillStyle = '#F3F3F3';
    sheetCtx!.font = '20px sans-serif';
    sheetCtx!.fillText(`${banner.id}  agree ${(whole * 100).toFixed(1)}%  match ${(banner.matchRate * 100).toFixed(0)}%`, hx, sy + 120);
    rowInSheet++;
  }

  sheets.forEach((s, i) => writeFileSync(join(OUT_DIR, `sheet-${i + 1}.png`), s.toBuffer('image/png')));
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), banners: scores }, null, 2));

  const sorted = [...scores].sort((x, y) => x.agreement - y.agreement);
  console.log(`\nvalidation: ${scores.length} banners, ${sheets.length} sheets → corpus/validation/`);
  console.log(`mean agreement: ${(scores.reduce((s, b) => s + b.agreement, 0) / scores.length * 100).toFixed(1)}%`);
  console.log('lowest 10:');
  for (const s of sorted.slice(0, 10)) console.log(`  ${s.id}  ${(s.agreement * 100).toFixed(1)}%  (match ${(s.matchRate * 100).toFixed(0)}%)`);
}

main().catch(err => { console.error(err); process.exit(1); });
