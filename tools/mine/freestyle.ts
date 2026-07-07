import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from 'canvas';
import { segmentCells, type CellSlice } from './cells.js';
import { parseSvgElements, type SvgElement } from './svg.js';
import { maskFillRatio, maskIoU, rasterizeMask } from './raster.js';
import { buildTileMaskLibrary, THRESHOLDS, type TileMaskEntry } from './tile-match.js';
import { ensureBackgroundRect, resolveCssClasses, resolveTransforms } from './preprocess.js';

type SuggestedFamily = 'capsule/lens-like' | 'wave/scallop-like' | 'other';

interface GridSpec {
  cols: number;
  rows: number;
  cellPx: number;
  strategy: string;
}

interface BestCatalogMatch {
  tile: string | null;
  rotation: number | null;
  flip: boolean | null;
  score: number;
}

interface MaskMetrics {
  fillRatio: number;
  bbox: { x: number; y: number; width: number; height: number };
  bboxFillRatio: number;
  aspect: number;
  horizontalSymmetry: number;
  verticalSymmetry: number;
  rowRunAverage: number;
  colRunAverage: number;
  edgeCoverage: { top: number; right: number; bottom: number; left: number };
  curvedElementShare: number;
}

interface CandidateManifestEntry {
  id: string;
  filename: string;
  source: string;
  illustration: string;
  cell: { col: number; row: number };
  bbox: { x: number; y: number; width: number; height: number };
  suggested_family: SuggestedFamily;
  novelty_score: number;
  best_catalog_match: BestCatalogMatch;
  mask_fill: number;
  metrics: MaskMetrics;
}

interface RunStats {
  illustrations: number;
  cells_extracted: number;
  non_plain_cells: number;
  already_known: number;
  candidates: number;
  by_suggested_family: Record<SuggestedFamily, number>;
}

const PROJECT_ROOT = resolve('.');
const FREESTYLE_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'freestyle');
const TILES_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles');
const TILES_MANIFEST = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const MINED_TILES_DIR = join(PROJECT_ROOT, 'corpus', 'mined-tiles');
const MINED_MANIFEST = join(MINED_TILES_DIR, 'manifest.json');
const OUT_DIR = join(MINED_TILES_DIR, 'freestyle-candidates');
const OUT_MANIFEST = join(OUT_DIR, 'manifest.json');
const OUT_CONTACT = join(OUT_DIR, 'contact.png');
const MASK_SIZE = 64;
const TILE_GROUND = '#F3F3F3';
const TILE_INK = '#121212';
const FAMILY_ORDER: SuggestedFamily[] = ['capsule/lens-like', 'wave/scallop-like', 'other'];

function listSourceFiles(): string[] {
  return readdirSync(FREESTYLE_DIR)
    .filter((file) => /^\d+\.svg$/.test(file))
    .sort();
}

function preprocessFreestyleSvg(rawSvg: string): ReturnType<typeof parseSvgElements> {
  const normalized = resolveTransforms(resolveCssClasses(rawSvg));
  const dimensions = parseSvgElements(normalized);
  const withBackground = ensureBackgroundRect(normalized, dimensions.width, dimensions.height);
  return parseSvgElements(withBackground);
}

function inferGrid(width: number, height: number): GridSpec {
  if (width === height && width % 4 === 0) {
    return {
      cols: 4,
      rows: 4,
      cellPx: width / 4,
      strategy: 'square 4x4 grid inferred from 500px freestyle artboard',
    };
  }

  const fixedCellPx = 320;
  if (width % fixedCellPx === 0 && height % fixedCellPx === 0) {
    return {
      cols: width / fixedCellPx,
      rows: height / fixedCellPx,
      cellPx: fixedCellPx,
      strategy: 'fixed 320px corpus cell scan',
    };
  }

  throw new Error(`cannot infer a square cell grid from ${width}x${height}`);
}

async function processCell(
  illustration: string,
  sourceFile: string,
  cell: CellSlice,
  grid: GridSpec,
  library: TileMaskEntry[],
): Promise<CandidateManifestEntry | null> {
  const viewport = cellViewport(cell, grid);
  const mask = await rasterizeMask(
    cell.foreground,
    viewport,
    MASK_SIZE,
    (el) => el.fill !== 'none' && el.fill !== cell.ground,
  );
  const fillRatio = maskFillRatio(mask);
  if (fillRatio < THRESHOLDS.plainMax) {
    return null;
  }

  const best = bestCatalogMatch(mask, fillRatio, library);
  if (best.score >= THRESHOLDS.accept) {
    return null;
  }

  const metrics = maskMetrics(mask, cell.foreground);
  const suggestedFamily = suggestFamily(metrics);
  const id = `f${illustration}-${cell.col}-${cell.row}`;
  const filename = `${id}.svg`;
  writeFileSync(
    join(OUT_DIR, filename),
    candidateSvg(cell, viewport),
    'utf8',
  );

  return {
    id,
    filename,
    source: `corpus/reference/freestyle/${sourceFile}`,
    illustration,
    cell: { col: cell.col, row: cell.row },
    bbox: {
      x: roundMetric(viewport.x),
      y: roundMetric(viewport.y),
      width: roundMetric(viewport.w),
      height: roundMetric(viewport.h),
    },
    suggested_family: suggestedFamily,
    novelty_score: roundMetric(1 - best.score),
    best_catalog_match: best,
    mask_fill: roundMetric(fillRatio),
    metrics,
  };
}

function cellViewport(cell: CellSlice, grid: GridSpec): { x: number; y: number; w: number; h: number } {
  return {
    x: cell.col * grid.cellPx,
    y: cell.row * grid.cellPx,
    w: grid.cellPx,
    h: grid.cellPx,
  };
}

function bestCatalogMatch(mask: Uint8Array, fillRatio: number, library: TileMaskEntry[]): BestCatalogMatch {
  let best: TileMaskEntry | null = null;
  let bestScore = 0;

  for (const entry of library) {
    const maxFill = Math.max(fillRatio, entry.fillRatio);
    const possibleBest = maxFill === 0 ? 1 : Math.min(fillRatio, entry.fillRatio) / maxFill;
    if (possibleBest < bestScore) {
      continue;
    }

    const score = maskIoU(mask, entry.mask);
    if (
      score > bestScore ||
      (score === bestScore && best !== null && compareCatalogEntry(entry, best) < 0)
    ) {
      best = entry;
      bestScore = score;
    }
  }

  return {
    tile: best?.tile ?? null,
    rotation: best?.rotation ?? null,
    flip: best?.flip ?? null,
    score: roundMetric(bestScore),
  };
}

function compareCatalogEntry(a: TileMaskEntry, b: TileMaskEntry): number {
  if (a.tile !== b.tile) {
    return a.tile.localeCompare(b.tile);
  }
  if (a.rotation !== b.rotation) {
    return a.rotation - b.rotation;
  }
  return Number(a.flip) - Number(b.flip);
}

function maskMetrics(mask: Uint8Array, elements: SvgElement[]): MaskMetrics {
  const bbox = maskBbox(mask);
  const bboxPixelArea = bbox.pixelWidth * bbox.pixelHeight;
  const fillRatio = maskFillRatio(mask);
  const filled = Math.round(fillRatio * mask.length);
  const aspect = bbox.pixelHeight === 0 ? 0 : bbox.pixelWidth / bbox.pixelHeight;
  const curvedElements = elements.filter(isCurvedElement).length;
  const paintElements = elements.filter((el) => el.fill !== 'none').length;

  return {
    fillRatio: roundMetric(fillRatio),
    bbox: {
      x: roundMetric(bbox.x / MASK_SIZE),
      y: roundMetric(bbox.y / MASK_SIZE),
      width: roundMetric(bbox.pixelWidth / MASK_SIZE),
      height: roundMetric(bbox.pixelHeight / MASK_SIZE),
    },
    bboxFillRatio: bboxPixelArea === 0 ? 0 : roundMetric(filled / bboxPixelArea),
    aspect: roundMetric(aspect),
    horizontalSymmetry: roundMetric(symmetryScore(mask, 'horizontal')),
    verticalSymmetry: roundMetric(symmetryScore(mask, 'vertical')),
    rowRunAverage: roundMetric(runAverage(mask, 'row')),
    colRunAverage: roundMetric(runAverage(mask, 'col')),
    edgeCoverage: edgeCoverage(mask),
    curvedElementShare: paintElements === 0 ? 0 : roundMetric(curvedElements / paintElements),
  };
}

function maskBbox(mask: Uint8Array): { x: number; y: number; pixelWidth: number; pixelHeight: number } {
  let minX = MASK_SIZE;
  let minY = MASK_SIZE;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      if ((mask[y * MASK_SIZE + x] ?? 0) === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, pixelWidth: 0, pixelHeight: 0 };
  }
  return {
    x: minX,
    y: minY,
    pixelWidth: maxX - minX + 1,
    pixelHeight: maxY - minY + 1,
  };
}

function symmetryScore(mask: Uint8Array, axis: 'horizontal' | 'vertical'): number {
  let union = 0;
  let mismatch = 0;

  for (let y = 0; y < MASK_SIZE; y += 1) {
    for (let x = 0; x < MASK_SIZE; x += 1) {
      const mirrorX = axis === 'vertical' ? MASK_SIZE - 1 - x : x;
      const mirrorY = axis === 'horizontal' ? MASK_SIZE - 1 - y : y;
      const a = (mask[y * MASK_SIZE + x] ?? 0) !== 0;
      const b = (mask[mirrorY * MASK_SIZE + mirrorX] ?? 0) !== 0;
      if (a || b) {
        union += 1;
      }
      if (a !== b) {
        mismatch += 1;
      }
    }
  }

  return union === 0 ? 1 : 1 - mismatch / union;
}

function runAverage(mask: Uint8Array, axis: 'row' | 'col'): number {
  let slicesWithInk = 0;
  let runs = 0;

  for (let major = 0; major < MASK_SIZE; major += 1) {
    let previous = false;
    let sliceRuns = 0;
    for (let minor = 0; minor < MASK_SIZE; minor += 1) {
      const x = axis === 'row' ? minor : major;
      const y = axis === 'row' ? major : minor;
      const on = (mask[y * MASK_SIZE + x] ?? 0) !== 0;
      if (on && !previous) {
        sliceRuns += 1;
      }
      previous = on;
    }
    if (sliceRuns > 0) {
      slicesWithInk += 1;
      runs += sliceRuns;
    }
  }

  return slicesWithInk === 0 ? 0 : runs / slicesWithInk;
}

function edgeCoverage(mask: Uint8Array): MaskMetrics['edgeCoverage'] {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  for (let idx = 0; idx < MASK_SIZE; idx += 1) {
    top += mask[idx] ?? 0;
    right += mask[idx * MASK_SIZE + MASK_SIZE - 1] ?? 0;
    bottom += mask[(MASK_SIZE - 1) * MASK_SIZE + idx] ?? 0;
    left += mask[idx * MASK_SIZE] ?? 0;
  }
  return {
    top: roundMetric(top / MASK_SIZE),
    right: roundMetric(right / MASK_SIZE),
    bottom: roundMetric(bottom / MASK_SIZE),
    left: roundMetric(left / MASK_SIZE),
  };
}

function isCurvedElement(el: SvgElement): boolean {
  if (el.kind === 'circle' || el.kind === 'ellipse') {
    return true;
  }
  if (el.kind !== 'path') {
    return false;
  }
  return /[AaCcQqSsTt]/.test(el.d ?? '');
}

function suggestFamily(metrics: MaskMetrics): SuggestedFamily {
  const maxSymmetry = Math.max(metrics.horizontalSymmetry, metrics.verticalSymmetry);
  const minSymmetry = Math.min(metrics.horizontalSymmetry, metrics.verticalSymmetry);
  const elongated = metrics.aspect >= 1.35 || (metrics.aspect > 0 && metrics.aspect <= 0.74);
  const compactRounded =
    metrics.curvedElementShare >= 0.35 &&
    metrics.bboxFillRatio >= 0.45 &&
    metrics.bboxFillRatio <= 0.93 &&
    maxSymmetry >= 0.62 &&
    metrics.rowRunAverage < 2.1 &&
    metrics.colRunAverage < 2.1;

  if (compactRounded && (elongated || minSymmetry >= 0.58)) {
    return 'capsule/lens-like';
  }

  const edgeValues = Object.values(metrics.edgeCoverage);
  const edgeContacts = edgeValues.filter((coverage) => coverage >= 0.08).length;
  const heavyEdge = edgeValues.some((coverage) => coverage >= 0.45);
  const repeatedRuns = Math.max(metrics.rowRunAverage, metrics.colRunAverage) >= 2;

  if (
    metrics.curvedElementShare >= 0.2 &&
    (repeatedRuns || (heavyEdge && edgeContacts >= 2) || metrics.bboxFillRatio >= 0.72)
  ) {
    return 'wave/scallop-like';
  }

  return 'other';
}

function candidateSvg(cell: CellSlice, viewport: { x: number; y: number; w: number; h: number }): string {
  const elements = cell.foreground
    .filter((el) => el.fill !== 'none')
    .map((el) => recolorElement(el, cell.ground))
    .map(serializeElement)
    .join('\n  ');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(viewport.x)} ${formatNumber(viewport.y)} ${formatNumber(viewport.w)} ${formatNumber(viewport.h)}" width="200" height="200">`,
    `  <rect x="${formatNumber(viewport.x)}" y="${formatNumber(viewport.y)}" width="${formatNumber(viewport.w)}" height="${formatNumber(viewport.h)}" fill="${TILE_GROUND}"/>`,
    elements ? `  ${elements}` : '',
    '</svg>',
    '',
  ].join('\n');
}

function recolorElement(el: SvgElement, cellGround: string): SvgElement {
  return { ...el, fill: el.fill === cellGround ? TILE_GROUND : TILE_INK };
}

function serializeElement(el: SvgElement): string {
  const rule = el.fillRule ? ` fill-rule="${el.fillRule}"` : '';
  if (el.kind === 'rect') {
    return `<rect x="${formatNumber(el.x ?? 0)}" y="${formatNumber(el.y ?? 0)}" width="${formatNumber(el.w ?? 0)}" height="${formatNumber(el.h ?? 0)}" fill="${el.fill}"${rule}/>`;
  }
  if (el.kind === 'circle') {
    return `<circle cx="${formatNumber(el.cx ?? 0)}" cy="${formatNumber(el.cy ?? 0)}" r="${formatNumber(el.r ?? 0)}" fill="${el.fill}"${rule}/>`;
  }
  if (el.kind === 'ellipse') {
    return `<ellipse cx="${formatNumber(el.cx ?? 0)}" cy="${formatNumber(el.cy ?? 0)}" rx="${formatNumber(el.rx ?? 0)}" ry="${formatNumber(el.ry ?? 0)}" fill="${el.fill}"${rule}/>`;
  }
  if (el.kind === 'path') {
    return `<path d="${escapeAttr(el.d ?? '')}" fill="${el.fill}"${rule}/>`;
  }
  throw new Error(`Unsupported SVG element kind: ${(el as { kind?: string }).kind}`);
}

async function writeContactSheet(candidates: CandidateManifestEntry[]): Promise<void> {
  const thumb = 108;
  const labelH = 18;
  const gap = 12;
  const margin = 24;
  const columns = 6;
  const sheetWidth = margin * 2 + columns * thumb + (columns - 1) * gap;
  const groupHeaderH = 30;
  const groupGap = 22;

  let sheetHeight = margin;
  for (const family of FAMILY_ORDER) {
    const count = candidates.filter((candidate) => candidate.suggested_family === family).length;
    if (count === 0) {
      continue;
    }
    const rows = Math.ceil(count / columns);
    sheetHeight += groupHeaderH + rows * (thumb + labelH + gap) + groupGap;
  }
  sheetHeight += margin;

  const canvas = createCanvas(sheetWidth, sheetHeight);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sheetWidth, sheetHeight);

  let y = margin;
  for (const family of FAMILY_ORDER) {
    const group = candidates.filter((candidate) => candidate.suggested_family === family);
    if (group.length === 0) {
      continue;
    }

    ctx.fillStyle = '#121212';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`${family} (${group.length})`, margin, y + 20);
    y += groupHeaderH;

    for (let idx = 0; idx < group.length; idx += 1) {
      const candidate = group[idx]!;
      const col = idx % columns;
      const row = Math.floor(idx / columns);
      const x = margin + col * (thumb + gap);
      const tileY = y + row * (thumb + labelH + gap);

      ctx.fillStyle = '#F7F7F7';
      ctx.fillRect(x, tileY, thumb, thumb);
      ctx.strokeStyle = '#C7C7C7';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, tileY + 0.5, thumb - 1, thumb - 1);

      const image = await loadImage(readFileSync(join(OUT_DIR, candidate.filename)));
      ctx.drawImage(image, x + 4, tileY + 4, thumb - 8, thumb - 8);

      ctx.fillStyle = '#121212';
      ctx.font = '11px monospace';
      ctx.fillText(candidate.id, x, tileY + thumb + 13);
    }

    y += Math.ceil(group.length / columns) * (thumb + labelH + gap) + groupGap;
  }

  writeFileSync(OUT_CONTACT, canvas.toBuffer('image/png'));
}

function emptyStats(sourceCount: number): RunStats {
  return {
    illustrations: sourceCount,
    cells_extracted: 0,
    non_plain_cells: 0,
    already_known: 0,
    candidates: 0,
    by_suggested_family: {
      'capsule/lens-like': 0,
      'wave/scallop-like': 0,
      other: 0,
    },
  };
}

async function main(): Promise<void> {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const sourceFiles = listSourceFiles();
  const stats = emptyStats(sourceFiles.length);
  const candidates: CandidateManifestEntry[] = [];
  const grids = new Map<string, GridSpec>();
  const resisted: { source: string; reason: string }[] = [];

  console.log('[mine:freestyle] Building tile-mask library...');
  const library = await buildTileMaskLibrary(TILES_DIR, TILES_MANIFEST, MASK_SIZE, {
    tilesDir: MINED_TILES_DIR,
    manifestPath: MINED_MANIFEST,
  });
  console.log(`[mine:freestyle] Library built: ${library.length} variants`);

  for (const sourceFile of sourceFiles) {
    const illustration = basename(sourceFile, '.svg');
    const sourcePath = join(FREESTYLE_DIR, sourceFile);
    process.stdout.write(`[mine:freestyle]   ${illustration}...`);

    try {
      const parsed = preprocessFreestyleSvg(readFileSync(sourcePath, 'utf8'));
      const grid = inferGrid(parsed.width, parsed.height);
      grids.set(`${parsed.width}x${parsed.height}`, grid);
      const { cells } = segmentCells(parsed, grid);
      stats.cells_extracted += cells.length;

      let sourceCandidates = 0;
      for (const cell of cells) {
        const viewport = cellViewport(cell, grid);
        const mask = await rasterizeMask(
          cell.foreground,
          viewport,
          MASK_SIZE,
          (el) => el.fill !== 'none' && el.fill !== cell.ground,
        );
        const fillRatio = maskFillRatio(mask);
        if (fillRatio < THRESHOLDS.plainMax) {
          continue;
        }

        stats.non_plain_cells += 1;
        const best = bestCatalogMatch(mask, fillRatio, library);
        if (best.score >= THRESHOLDS.accept) {
          stats.already_known += 1;
          continue;
        }

        const candidate = await processCell(illustration, sourceFile, cell, grid, library);
        if (!candidate) {
          continue;
        }
        candidates.push(candidate);
        stats.candidates += 1;
        stats.by_suggested_family[candidate.suggested_family] += 1;
        sourceCandidates += 1;
      }

      console.log(` cells=${cells.length} candidates=${sourceCandidates}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      resisted.push({ source: `corpus/reference/freestyle/${sourceFile}`, reason });
      console.log(` resisted: ${reason}`);
    }
  }

  candidates.sort((a, b) => familySort(a, b) || a.id.localeCompare(b.id));
  await writeContactSheet(candidates);

  const manifest = {
    version: 1,
    source_dir: 'corpus/reference/freestyle',
    output_dir: 'corpus/mined-tiles/freestyle-candidates',
    segmentation: {
      note: 'Freestyle sources are pre-cleaned flattened SVGs; this script infers 4x4 125px cells from the 500x500 artboards and passes that grid into segmentCells.',
      grids: [...grids.entries()].map(([dimensions, grid]) => ({ dimensions, ...grid })),
    },
    dedupe: {
      threshold: THRESHOLDS.accept,
      catalog: 'corpus/reference/tiles plus corpus/mined-tiles/manifest.json',
      catalog_variants: library.length,
    },
    stats,
    resisted,
    candidates,
  };

  writeFileSync(OUT_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[mine:freestyle] Wrote ${OUT_MANIFEST}`);
  console.log(`[mine:freestyle] Wrote ${OUT_CONTACT}`);
  console.log(
    `[mine:freestyle] cells=${stats.cells_extracted} nonplain=${stats.non_plain_cells} known=${stats.already_known} candidates=${stats.candidates}`,
  );
  console.log(
    `[mine:freestyle] families capsule/lens=${stats.by_suggested_family['capsule/lens-like']} wave/scallop=${stats.by_suggested_family['wave/scallop-like']} other=${stats.by_suggested_family.other}`,
  );
  if (resisted.length > 0) {
    console.log(`[mine:freestyle] resisted=${resisted.length}`);
  }
}

function familySort(a: CandidateManifestEntry, b: CandidateManifestEntry): number {
  return FAMILY_ORDER.indexOf(a.suggested_family) - FAMILY_ORDER.indexOf(b.suggested_family);
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot format non-finite number: ${value}`);
  }
  const rounded = Number(value.toFixed(3));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const thisFile = fileURLToPath(import.meta.url);
const argvFile = process.argv[1] ?? '';
if (argvFile === thisFile || argvFile.endsWith('/freestyle.mjs') || argvFile.endsWith('\\freestyle.mjs')) {
  main().catch((error) => {
    console.error('[mine:freestyle] Fatal error:', error);
    process.exit(1);
  });
}
