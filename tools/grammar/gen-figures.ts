/**
 * gen-figures.ts - Generates src/engine/corpus/data/figures.ts
 * from corpus freeform figure regions and original banner SVG geometry.
 *
 * Run via: npm run gen:figures
 * Optional curation: npm run gen:figures -- --include fig-007-1,fig-008-1
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import canvasPkg from 'canvas';
import { segmentCells, type CellSlice } from '../mine/cells.js';
import { ensureBackgroundRect, resolveCssClasses, resolveTransforms } from '../mine/preprocess.js';
import type { BannerRecon, Corpus } from '../mine/schema.js';
import { parseSvgElements, type SvgElement } from '../mine/svg.js';

const { createCanvas, loadImage } = canvasPkg;

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const BANNERS_DIR = join(ROOT, 'corpus', 'reference', 'banners');
const OUT_FILE = join(ROOT, 'src', 'engine', 'corpus', 'data', 'figures.ts');
const SHEET_FILE = join(ROOT, 'corpus', 'samples', 'figures-sheet.png');

const SOURCE_CELL = 320;
const OUT_CELL = 200;
const SCALE = OUT_CELL / SOURCE_CELL;
const DEDUPE_WIDTH = 96;
const DEDUPE_IOU = 0.95;
const DATA_BUDGET_BYTES = 250 * 1024;
const SHEET_COLS = 8;
const SHEET_CARD_W = 232;
const SHEET_CARD_H = 220;
const SHEET_IMAGE_H = 146;
const SMOKE = '#F3F3F3';
const COD = '#121212';

interface CellCoord {
  col: number;
  row: number;
}

interface PathPoint {
  x: number;
  y: number;
}

interface PathTransformState {
  current: PathPoint;
  subpathStart: PathPoint;
  hasCurrentPoint: boolean;
}

type PathToken =
  | { type: 'command'; value: string }
  | { type: 'number'; value: string };

type TileElementKind = 'rect' | 'circle' | 'ellipse' | 'path';
type TileElementRole = 'fg' | 'cutout';

interface TileElement {
  kind: TileElementKind;
  role: TileElementRole;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  d?: string;
  fillRule?: string;
}

interface FigureAsset {
  id: string;
  source: string;
  w: number;
  h: number;
  elements: TileElement[];
  inkShare: number;
}

interface CandidateGroup {
  id: string;
  source: string;
  bannerId: string;
  cells: CellCoord[];
}

interface CandidateAsset extends FigureAsset {
  bannerId: string;
  dominantInk?: string;
  mask: Uint8Array;
  maskW: number;
  maskH: number;
}

interface DedupeDrop {
  dropped: string;
  kept: string;
  iou: number;
  source: string;
}

interface ExtractionSummary {
  perBannerCandidates: Record<string, number>;
  perBannerRetained: Record<string, number>;
  drops: DedupeDrop[];
  extracted: number;
  retained: number;
  shipped: number;
  sizeBytes: number;
  sourceHash: string;
}

interface ParsedBanner {
  parsed: ReturnType<typeof parseSvgElements>;
  cells: CellSlice[];
}

interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * CURATED SHIP LIST — Claude's visual curation, 2026-07-02 (P3 Task 2).
 * Reviewed all 27 candidates on the contact sheet (corpus/samples/figures-sheet.png).
 * Cut 7: fig-018-1 (window-square fragment, meaningless standalone); fig-025-1 +
 * fig-025-3 (near-empty background fragments, ink 0.11); fig-047-1/2/3 (squiggle
 * extraction noise); fig-043-1 (the ENTIRE 043 banner as one asset — placing it
 * would replicate a canonical piece verbatim rather than recombine vocabulary).
 * Use --all to regenerate uncurated; --include to override the list.
 */
const CURATED = new Set([
  'fig-007-1', 'fig-007-2', 'fig-008-1', 'fig-009-1', 'fig-012-1',
  'fig-017-1', 'fig-017-2', 'fig-017-3', 'fig-017-4', 'fig-019-1',
  'fig-020-2', 'fig-021-1', 'fig-023-1', 'fig-023-2', 'fig-024-1',
  'fig-024-2', 'fig-025-4', 'fig-035-1', 'fig-043-2', 'fig-043-3',
]);

function parseArgs(argv: string[]): { include?: Set<string> } {
  if (argv.includes('--all')) return {};
  const includeIdx = argv.indexOf('--include');
  if (includeIdx === -1) {
    return { include: CURATED };
  }
  const value = argv[includeIdx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('Missing value for --include');
  }
  const ids = value.split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('--include must contain at least one figure id');
  }
  return { include: new Set(ids) };
}

function listBannerFiles(): string[] {
  return readdirSync(BANNERS_DIR)
    .filter((name) => /^\d+\.svg$/.test(name))
    .sort();
}

function computeSourceHash(corpusJson: string): string {
  const hash = createHash('sha256');
  hash.update(corpusJson);
  for (const file of listBannerFiles()) {
    hash.update(file);
    hash.update(readFileSync(join(BANNERS_DIR, file), 'utf8'));
  }
  return hash.digest('hex');
}

function keyOf(cell: CellCoord): string {
  return `${cell.col},${cell.row}`;
}

function sourceForForm(bannerId: string, formId: string): string {
  const shortFormId = formId.startsWith(`${bannerId}-`) ? formId.slice(bannerId.length + 1) : formId;
  return `${bannerId}/${shortFormId}`;
}

function rowMajor(a: CellCoord, b: CellCoord): number {
  return a.row - b.row || a.col - b.col;
}

function groupSortKey(cells: CellCoord[]): string {
  const sorted = [...cells].sort(rowMajor);
  const first = sorted[0] ?? { col: 0, row: 0 };
  return `${String(first.row).padStart(2, '0')},${String(first.col).padStart(2, '0')}`;
}

function figureGroupsForBanner(banner: BannerRecon): CandidateGroup[] {
  const freeformCells = banner.cells
    .filter((cell) => cell.kind === 'freeform')
    .map((cell) => ({ col: cell.col, row: cell.row }))
    .sort(rowMajor);
  const freeformKeys = new Set(freeformCells.map(keyOf));
  const assigned = new Set<string>();
  const groups: Omit<CandidateGroup, 'id'>[] = [];

  for (const form of banner.forms.filter((candidate) => candidate.kind === 'figure')) {
    const cells: CellCoord[] = [];
    const seen = new Set<string>();
    for (const [col, row] of form.cells) {
      const coord = { col, row };
      const key = keyOf(coord);
      if (!freeformKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      assigned.add(key);
      cells.push(coord);
    }
    if (cells.length > 0) {
      groups.push({
        source: sourceForForm(banner.id, form.id),
        bannerId: banner.id,
        cells: cells.sort(rowMajor),
      });
    }
  }

  const ungrouped = freeformCells.filter((cell) => !assigned.has(keyOf(cell)));
  const connected = connectedComponents(ungrouped);
  let looseIndex = 1;
  for (const cells of connected.sort((a, b) => groupSortKey(a).localeCompare(groupSortKey(b)))) {
    groups.push({
      source: `${banner.id}/freeform-${looseIndex}`,
      bannerId: banner.id,
      cells,
    });
    looseIndex += 1;
  }

  return groups.map((group, index) => ({
    ...group,
    id: `fig-${banner.id}-${index + 1}`,
  }));
}

function connectedComponents(cells: CellCoord[]): CellCoord[][] {
  const remaining = new Map(cells.map((cell) => [keyOf(cell), cell]));
  const components: CellCoord[][] = [];
  const orderedSeeds = [...cells].sort(rowMajor);

  for (const seed of orderedSeeds) {
    const seedKey = keyOf(seed);
    if (!remaining.has(seedKey)) {
      continue;
    }

    const component: CellCoord[] = [];
    const queue: CellCoord[] = [seed];
    remaining.delete(seedKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      const neighbors = [
        { col: current.col - 1, row: current.row },
        { col: current.col + 1, row: current.row },
        { col: current.col, row: current.row - 1 },
        { col: current.col, row: current.row + 1 },
      ].sort(rowMajor);
      for (const neighbor of neighbors) {
        const neighborKey = keyOf(neighbor);
        const actual = remaining.get(neighborKey);
        if (!actual) {
          continue;
        }
        remaining.delete(neighborKey);
        queue.push(actual);
      }
    }

    components.push(component.sort(rowMajor));
  }

  return components;
}

function parseBanner(bannerId: string): ParsedBanner {
  const raw = readFileSync(join(BANNERS_DIR, `${bannerId}.svg`), 'utf8');
  const svgText = resolveTransforms(resolveCssClasses(ensureBackgroundRect(raw)));
  const parsed = parseSvgElements(svgText);
  const segmented = segmentCells(parsed);
  return { parsed, cells: segmented.cells };
}

function groupBounds(cells: CellCoord[]): { minCol: number; minRow: number; w: number; h: number } {
  const cols = cells.map((cell) => cell.col);
  const rows = cells.map((cell) => cell.row);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  return { minCol, minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
}

async function buildAsset(group: CandidateGroup, banner: ParsedBanner): Promise<CandidateAsset | null> {
  const bounds = groupBounds(group.cells);
  const cellByKey = new Map(banner.cells.map((cell) => [keyOf(cell), cell]));
  const memberCells = group.cells.map((cell) => {
    const match = cellByKey.get(keyOf(cell));
    if (!match) {
      throw new Error(`Cell ${keyOf(cell)} not found while extracting ${group.id}`);
    }
    return match;
  });
  const groundSet = new Set(memberCells.map((cell) => cell.ground));
  const foregroundSet = new Set<SvgElement>();
  for (const cell of memberCells) {
    for (const el of cell.foreground) {
      if (el.fill !== 'none') {
        foregroundSet.add(el);
      }
    }
  }
  const foreground = banner.parsed.elements.filter((el) => foregroundSet.has(el) && el.fill !== 'none');
  if (foreground.length === 0) {
    return null;
  }

  const viewport = {
    x: bounds.minCol * SOURCE_CELL,
    y: bounds.minRow * SOURCE_CELL,
    w: bounds.w * SOURCE_CELL,
    h: bounds.h * SOURCE_CELL,
  };
  const visibleForeground = await filterVisibleElements(foreground, viewport);
  if (visibleForeground.length === 0) {
    return null;
  }
  const dominantInk = await computeDominantInk(visibleForeground, viewport, groundSet);

  const elements = visibleForeground
    .map((el) => toTileElement(el, bounds, groundSet))
    .filter((el) => tileElementWithinViewBox(el, bounds.w * OUT_CELL, bounds.h * OUT_CELL));
  if (elements.length === 0) {
    return null;
  }
  const maskSize = maskSizeForAsset(bounds.w, bounds.h);
  const mask = await rasterizeAssetMask(elements, bounds.w, bounds.h, maskSize.w, maskSize.h);
  const inkShare = roundMetric(maskFillRatio(mask));

  return {
    id: group.id,
    source: group.source,
    bannerId: group.bannerId,
    w: bounds.w,
    h: bounds.h,
    elements,
    inkShare,
    dominantInk,
    mask,
    maskW: maskSize.w,
    maskH: maskSize.h,
  };
}

async function filterVisibleElements(elements: SvgElement[], viewport: Viewport): Promise<SvgElement[]> {
  const size = maskSizeForViewport(viewport, DEDUPE_WIDTH);
  const minPixels = Math.max(4, Math.ceil(size.w * size.h * 0.001));
  const visible: SvgElement[] = [];

  for (const el of elements) {
    const mask = await rasterizeOriginalMask([el], viewport, size.w, size.h, () => true);
    if (maskOnCount(mask) >= minPixels) {
      visible.push(el);
    }
  }

  return visible;
}

async function computeDominantInk(
  elements: SvgElement[],
  viewport: Viewport,
  groundSet: Set<string>,
): Promise<string | undefined> {
  const fills = [...new Set(elements
    .map((el) => el.fill)
    .filter((fill) => fill !== 'none' && !groundSet.has(fill)))]
    .sort();
  if (fills.length === 0) {
    return undefined;
  }

  const size = maskSizeForViewport(viewport, DEDUPE_WIDTH);
  const coverage = new Map<string, number>();
  for (const fill of fills) {
    const mask = await rasterizeOriginalMask(elements, viewport, size.w, size.h, (el) => el.fill === fill);
    coverage.set(fill, maskOnCount(mask));
  }

  return [...coverage.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

function toTileElement(
  el: SvgElement,
  bounds: { minCol: number; minRow: number },
  groundSet: Set<string>,
): TileElement {
  const role: TileElementRole = groundSet.has(el.fill) ? 'cutout' : 'fg';
  const base: TileElement = { kind: el.kind, role };
  if (el.fillRule) {
    base.fillRule = el.fillRule;
  }

  if (el.kind === 'rect') {
    base.x = transformX(el.x ?? 0, bounds.minCol);
    base.y = transformY(el.y ?? 0, bounds.minRow);
    base.w = scaleLength(el.w ?? 0);
    base.h = scaleLength(el.h ?? 0);
  } else if (el.kind === 'circle') {
    base.cx = transformX(el.cx ?? 0, bounds.minCol);
    base.cy = transformY(el.cy ?? 0, bounds.minRow);
    base.r = scaleLength(el.r ?? 0);
  } else if (el.kind === 'ellipse') {
    base.cx = transformX(el.cx ?? 0, bounds.minCol);
    base.cy = transformY(el.cy ?? 0, bounds.minRow);
    base.rx = scaleLength(el.rx ?? 0);
    base.ry = scaleLength(el.ry ?? 0);
  } else if (el.kind === 'path') {
    base.d = transformPathDataForOrigin(el.d ?? '', { col: bounds.minCol, row: bounds.minRow });
  }

  return base;
}

function tileElementWithinViewBox(el: TileElement, viewW: number, viewH: number): boolean {
  if (el.kind === 'rect') {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.w ?? 0;
    const h = el.h ?? 0;
    return isInRange(x, 0, viewW) && isInRange(y, 0, viewH) && isInRange(x + w, 0, viewW) && isInRange(y + h, 0, viewH);
  }
  if (el.kind === 'circle') {
    const cx = el.cx ?? 0;
    const cy = el.cy ?? 0;
    const r = el.r ?? 0;
    return isInRange(cx - r, 0, viewW) && isInRange(cx + r, 0, viewW) && isInRange(cy - r, 0, viewH) && isInRange(cy + r, 0, viewH);
  }
  if (el.kind === 'ellipse') {
    const cx = el.cx ?? 0;
    const cy = el.cy ?? 0;
    const rx = el.rx ?? 0;
    const ry = el.ry ?? 0;
    return isInRange(cx - rx, 0, viewW) && isInRange(cx + rx, 0, viewW) && isInRange(cy - ry, 0, viewH) && isInRange(cy + ry, 0, viewH);
  }
  if (el.kind === 'path') {
    const points = pathCoordinateSamples(el.d ?? '');
    return points.length > 0 && points.every(([x, y]) => isInRange(x, 0, viewW) && isInRange(y, 0, viewH));
  }
  return false;
}

function isInRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min - 0.75 && value <= max + 0.75;
}

function pathCoordinateSamples(d: string): Array<[number, number]> {
  const tokens = tokenizePathData(d);
  const points: Array<[number, number]> = [];
  let idx = 0;
  let current: [number, number] = [0, 0];
  let subpathStart: [number, number] = [0, 0];

  while (idx < tokens.length) {
    const commandToken = tokens[idx];
    if (!commandToken || commandToken.type !== 'command') {
      throw new Error(`Expected path command in transformed path "${d}"`);
    }
    idx += 1;
    const command = commandToken.value;
    if (command !== command.toUpperCase()) {
      return [];
    }
    const arity = commandArity(command);
    if (arity === 0) {
      current = subpathStart;
      continue;
    }

    const values: number[] = [];
    while (idx < tokens.length && tokens[idx]?.type === 'number') {
      values.push(Number(tokens[idx]!.value));
      idx += 1;
    }
    if (values.length % arity !== 0) {
      return [];
    }

    for (let offset = 0; offset < values.length; offset += arity) {
      const group = values.slice(offset, offset + arity);
      if (command === 'M' || command === 'L' || command === 'T') {
        current = [group[0]!, group[1]!];
        points.push(current);
        if (command === 'M') {
          subpathStart = current;
        }
      } else if (command === 'H') {
        current = [group[0]!, current[1]];
        points.push(current);
      } else if (command === 'V') {
        current = [current[0], group[0]!];
        points.push(current);
      } else if (command === 'C') {
        points.push([group[0]!, group[1]!], [group[2]!, group[3]!], [group[4]!, group[5]!]);
        current = [group[4]!, group[5]!];
      } else if (command === 'S' || command === 'Q') {
        points.push([group[0]!, group[1]!], [group[2]!, group[3]!]);
        current = [group[2]!, group[3]!];
      } else if (command === 'A') {
        current = [group[5]!, group[6]!];
        points.push(current);
      }
    }
  }

  return points;
}

function maskSizeForAsset(w: number, h: number): { w: number; h: number } {
  return { w: DEDUPE_WIDTH, h: Math.max(1, Math.round((DEDUPE_WIDTH * h) / w)) };
}

function maskSizeForViewport(viewport: Viewport, width: number): { w: number; h: number } {
  return { w: width, h: Math.max(1, Math.round((width * viewport.h) / viewport.w)) };
}

async function rasterizeOriginalMask(
  elements: SvgElement[],
  viewport: Viewport,
  width: number,
  height: number,
  isForeground: (el: SvgElement) => boolean,
): Promise<Uint8Array> {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewport.x} ${viewport.y} ${viewport.w} ${viewport.h}" width="${width}" height="${height}">`,
    `<rect x="${viewport.x}" y="${viewport.y}" width="${viewport.w}" height="${viewport.h}" fill="#000000"/>`,
    ...elements.flatMap((el) => serializeSvgElement(el, isForeground(el) ? '#FFFFFF' : '#000000')),
    '</svg>',
  ].join('');
  return rasterizeSvgMask(svg, width, height);
}

async function rasterizeAssetMask(
  elements: TileElement[],
  wCells: number,
  hCells: number,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const viewW = wCells * OUT_CELL;
  const viewH = hCells * OUT_CELL;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${viewH}" width="${width}" height="${height}">`,
    `<rect x="0" y="0" width="${viewW}" height="${viewH}" fill="#000000"/>`,
    ...elements.map((el) => serializeTileElement(el, el.role === 'fg' ? '#FFFFFF' : '#000000')),
    '</svg>',
  ].join('');
  return rasterizeSvgMask(svg, width, height);
}

async function rasterizeSvgMask(svg: string, width: number, height: number): Promise<Uint8Array> {
  const img = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = (pixels[i * 4] ?? 0) > 127 ? 1 : 0;
  }
  return mask;
}

function dedupeAssets(candidates: CandidateAsset[]): { retained: CandidateAsset[]; drops: DedupeDrop[] } {
  const retained: CandidateAsset[] = [];
  const drops: DedupeDrop[] = [];

  for (const candidate of candidates) {
    let duplicate: { asset: CandidateAsset; iou: number } | undefined;
    for (const earlier of retained) {
      if (candidate.maskW !== earlier.maskW || candidate.maskH !== earlier.maskH) {
        continue;
      }
      const iou = maskIoU(candidate.mask, earlier.mask);
      if (iou >= DEDUPE_IOU) {
        duplicate = { asset: earlier, iou };
        break;
      }
    }

    if (duplicate) {
      drops.push({
        dropped: candidate.id,
        kept: duplicate.asset.id,
        iou: roundMetric(duplicate.iou),
        source: candidate.source,
      });
    } else {
      retained.push(candidate);
    }
  }

  return { retained, drops };
}

function maskIoU(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`Mask length mismatch: ${a.length} !== ${b.length}`);
  }
  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const aOn = a[i] !== 0;
    const bOn = b[i] !== 0;
    if (aOn && bOn) {
      intersection += 1;
    }
    if (aOn || bOn) {
      union += 1;
    }
  }
  return union === 0 ? 1 : intersection / union;
}

function maskOnCount(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) {
    if (value !== 0) {
      count += 1;
    }
  }
  return count;
}

function maskFillRatio(mask: Uint8Array): number {
  return mask.length === 0 ? 0 : maskOnCount(mask) / mask.length;
}

function serializeSvgElement(el: SvgElement, fill: '#FFFFFF' | '#000000'): string[] {
  if (el.fill === 'none') {
    return [];
  }
  const fillRule = el.fillRule ? ` fill-rule="${el.fillRule}"` : '';
  if (el.kind === 'rect') {
    return [`<rect x="${numberAttr(el.x ?? 0)}" y="${numberAttr(el.y ?? 0)}" width="${numberAttr(el.w ?? 0)}" height="${numberAttr(el.h ?? 0)}" fill="${fill}"${fillRule}/>`];
  }
  if (el.kind === 'circle') {
    return [`<circle cx="${numberAttr(el.cx ?? 0)}" cy="${numberAttr(el.cy ?? 0)}" r="${numberAttr(el.r ?? 0)}" fill="${fill}"${fillRule}/>`];
  }
  if (el.kind === 'ellipse') {
    return [`<ellipse cx="${numberAttr(el.cx ?? 0)}" cy="${numberAttr(el.cy ?? 0)}" rx="${numberAttr(el.rx ?? 0)}" ry="${numberAttr(el.ry ?? 0)}" fill="${fill}"${fillRule}/>`];
  }
  if (el.kind === 'path') {
    return [`<path d="${escapeAttr(el.d ?? '')}" fill="${fill}"${fillRule}/>`];
  }
  throw new Error(`Unsupported SVG element kind: ${(el as { kind?: string }).kind}`);
}

function serializeTileElement(el: TileElement, fill: string): string {
  const fillRule = el.fillRule ? ` fill-rule="${el.fillRule}"` : '';
  if (el.kind === 'rect') {
    return `<rect x="${numberAttr(el.x ?? 0)}" y="${numberAttr(el.y ?? 0)}" width="${numberAttr(el.w ?? 0)}" height="${numberAttr(el.h ?? 0)}" fill="${fill}"${fillRule}/>`;
  }
  if (el.kind === 'circle') {
    return `<circle cx="${numberAttr(el.cx ?? 0)}" cy="${numberAttr(el.cy ?? 0)}" r="${numberAttr(el.r ?? 0)}" fill="${fill}"${fillRule}/>`;
  }
  if (el.kind === 'ellipse') {
    return `<ellipse cx="${numberAttr(el.cx ?? 0)}" cy="${numberAttr(el.cy ?? 0)}" rx="${numberAttr(el.rx ?? 0)}" ry="${numberAttr(el.ry ?? 0)}" fill="${fill}"${fillRule}/>`;
  }
  if (el.kind === 'path') {
    return `<path d="${escapeAttr(el.d ?? '')}" fill="${fill}"${fillRule}/>`;
  }
  throw new Error(`Unsupported tile element kind: ${(el as { kind?: string }).kind}`);
}

async function writeContactSheet(assets: CandidateAsset[], shippedIds: Set<string>): Promise<void> {
  mkdirSync(dirname(SHEET_FILE), { recursive: true });
  const rows = Math.max(1, Math.ceil(assets.length / SHEET_COLS));
  const canvas = createCanvas(SHEET_COLS * SHEET_CARD_W, rows * SHEET_CARD_H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < assets.length; i += 1) {
    const asset = assets[i]!;
    const col = i % SHEET_COLS;
    const row = Math.floor(i / SHEET_COLS);
    const x = col * SHEET_CARD_W;
    const y = row * SHEET_CARD_H;
    const shipped = shippedIds.has(asset.id);

    ctx.fillStyle = shipped ? '#F9F9F8' : '#ECECEA';
    ctx.fillRect(x + 6, y + 6, SHEET_CARD_W - 12, SHEET_CARD_H - 12);
    ctx.strokeStyle = shipped ? '#D9D9D6' : '#A8A8A4';
    ctx.strokeRect(x + 6.5, y + 6.5, SHEET_CARD_W - 13, SHEET_CARD_H - 13);

    const img = await loadImage(Buffer.from(assetSvg(asset, COD, SMOKE)));
    const maxW = SHEET_CARD_W - 28;
    const maxH = SHEET_IMAGE_H;
    const naturalW = asset.w * OUT_CELL;
    const naturalH = asset.h * OUT_CELL;
    const scale = Math.min(maxW / naturalW, maxH / naturalH);
    const drawW = naturalW * scale;
    const drawH = naturalH * scale;
    const drawX = x + (SHEET_CARD_W - drawW) / 2;
    const drawY = y + 16 + (maxH - drawH) / 2;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    ctx.fillStyle = COD;
    ctx.font = '12px sans-serif';
    ctx.fillText(asset.id, x + 14, y + 174);
    ctx.fillStyle = '#555555';
    ctx.fillText(asset.source, x + 14, y + 190);
    const status = shipped ? '' : ' not shipped';
    ctx.fillText(`${asset.w}x${asset.h} ink ${asset.inkShare.toFixed(3)}${status}`, x + 14, y + 206);
  }

  writeFileSync(SHEET_FILE, canvas.toBuffer('image/png'));
}

function assetSvg(asset: FigureAsset, fg: string, cutout: string): string {
  const viewW = asset.w * OUT_CELL;
  const viewH = asset.h * OUT_CELL;
  const body = [
    `<rect x="0" y="0" width="${viewW}" height="${viewH}" fill="${cutout}"/>`,
    ...asset.elements.map((el) => serializeTileElement(el, el.role === 'fg' ? fg : cutout)),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${viewH}" width="${viewW}" height="${viewH}">${body}</svg>`;
}

function serializeValue(v: unknown, indent = 0): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const pad = '  '.repeat(indent + 1);
    const items = v.map((item) => `${pad}${serializeValue(item, indent + 1)}`).join(',\n');
    return `[\n${items},\n${'  '.repeat(indent)}]`;
  }

  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pad = '  '.repeat(indent + 1);
    const props = entries.map(([key, value]) => {
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
      return `${pad}${safeKey}: ${serializeValue(value, indent + 1)}`;
    }).join(',\n');
    return `{\n${props},\n${'  '.repeat(indent)}}`;
  }

  return JSON.stringify(v);
}

function generatedModule(sourceHash: string, assets: FigureAsset[]): string {
  const header = [
    '// GENERATED by gen:figures - do not edit',
    `// source-hash: ${sourceHash}`,
    '',
    '/* eslint-disable */',
    '',
    '// ---- Inline type declarations ----',
    '',
    "export type TileElementKind = 'rect' | 'circle' | 'ellipse' | 'path';",
    "export type TileElementRole = 'fg' | 'cutout';",
    'export interface TileElement {',
    '  kind: TileElementKind;',
    '  role: TileElementRole;',
    '  x?: number; y?: number; w?: number; h?: number;',
    '  cx?: number; cy?: number; r?: number;',
    '  rx?: number; ry?: number;',
    '  d?: string;',
    '  fillRule?: string;',
    '}',
    'export interface FigureAsset {',
    '  id: string;',
    '  source: string;',
    '  w: number;',
    '  h: number;',
    '  elements: TileElement[];',
    '  inkShare: number;',
    '}',
    '',
    '// ---- Data ----',
    '',
  ].join('\n');
  return `${header}export const FIGURES: FigureAsset[] = ${serializeValue(assets)};\n`;
}

function publicAsset(asset: CandidateAsset): FigureAsset {
  return {
    id: asset.id,
    source: asset.source,
    w: asset.w,
    h: asset.h,
    elements: asset.elements,
    inkShare: asset.inkShare,
  };
}

function printSummary(summary: ExtractionSummary): void {
  console.log(`gen-figures: extracted ${summary.extracted} candidate(s)`);
  for (const [bannerId, count] of Object.entries(summary.perBannerCandidates).filter(([, count]) => count > 0)) {
    const retained = summary.perBannerRetained[bannerId] ?? 0;
    console.log(`  ${bannerId}: ${count} candidate(s), ${retained} retained`);
  }
  console.log(`gen-figures: dedupe dropped ${summary.drops.length} candidate(s)`);
  for (const drop of summary.drops) {
    console.log(`  drop ${drop.dropped} (${drop.source}) ~= ${drop.kept} IoU ${drop.iou.toFixed(4)}`);
  }
  console.log(`gen-figures: shipping ${summary.shipped} figure(s)`);
  console.log(`gen-figures: wrote ${OUT_FILE} (${(summary.sizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`gen-figures: wrote ${SHEET_FILE}`);
  console.log(`gen-figures: source-hash ${summary.sourceHash}`);
  if (summary.sizeBytes > DATA_BUDGET_BYTES) {
    console.warn(`gen-figures: WARNING data file exceeds 250KB (${(summary.sizeBytes / 1024).toFixed(1)} KB)`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const corpusJson = readFileSync(CORPUS_PATH, 'utf8');
  const corpus = JSON.parse(corpusJson) as Corpus;
  const sourceHash = computeSourceHash(corpusJson);
  const parsedCache = new Map<string, ParsedBanner>();
  const perBannerCandidates: Record<string, number> = {};
  const candidates: CandidateAsset[] = [];

  for (const banner of corpus.banners) {
    const groups = figureGroupsForBanner(banner);
    perBannerCandidates[banner.id] = 0;
    if (groups.length === 0) {
      continue;
    }
    let parsed = parsedCache.get(banner.id);
    if (!parsed) {
      parsed = parseBanner(banner.id);
      parsedCache.set(banner.id, parsed);
    }
    for (const group of groups) {
      const asset = await buildAsset(group, parsed);
      if (asset) {
        candidates.push(asset);
        perBannerCandidates[banner.id] += 1;
      }
    }
  }

  const { retained, drops } = dedupeAssets(candidates);
  const retainedIds = new Set(retained.map((asset) => asset.id));
  const perBannerRetained: Record<string, number> = {};
  for (const asset of retained) {
    perBannerRetained[asset.bannerId] = (perBannerRetained[asset.bannerId] ?? 0) + 1;
  }

  const unknownIncludes = args.include
    ? [...args.include].filter((id) => !retainedIds.has(id))
    : [];
  if (unknownIncludes.length > 0) {
    throw new Error(`--include contains unknown or deduped id(s): ${unknownIncludes.join(', ')}`);
  }

  const shipped = args.include
    ? retained.filter((asset) => args.include!.has(asset.id))
    : retained;
  const shippedIds = new Set(shipped.map((asset) => asset.id));

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const data = generatedModule(sourceHash, shipped.map(publicAsset));
  writeFileSync(OUT_FILE, data, 'utf8');
  await writeContactSheet(retained, shippedIds);

  printSummary({
    perBannerCandidates,
    perBannerRetained,
    drops,
    extracted: candidates.length,
    retained: retained.length,
    shipped: shipped.length,
    sizeBytes: Buffer.byteLength(data),
    sourceHash,
  });
}

function transformPathDataForOrigin(d: string, origin: CellCoord): string {
  const tokens = tokenizePathData(d);
  const parts: string[] = [];
  let idx = 0;
  const state: PathTransformState = {
    current: { x: 0, y: 0 },
    subpathStart: { x: 0, y: 0 },
    hasCurrentPoint: false,
  };

  while (idx < tokens.length) {
    const commandToken = tokens[idx];
    if (!commandToken || commandToken.type !== 'command') {
      throw new Error(`Expected path command at token ${idx}`);
    }
    idx += 1;

    const command = commandToken.value;
    const upperCommand = command.toUpperCase();
    const isRelative = command !== upperCommand;
    const arity = commandArity(upperCommand);
    if (arity === 0) {
      parts.push(upperCommand);
      state.current = { ...state.subpathStart };
      state.hasCurrentPoint = true;
      continue;
    }

    const values: string[] = [];
    while (idx < tokens.length && tokens[idx]?.type === 'number') {
      values.push(tokens[idx]!.value);
      idx += 1;
    }

    if (values.length === 0) {
      throw new Error(`Path command '${command}' is missing numeric arguments`);
    }
    if (values.length % arity !== 0) {
      throw new Error(`Path command '${command}' expected argument groups of ${arity}, got ${values.length}`);
    }

    let pendingCommand: string | undefined;
    let pendingArgs: string[] = [];
    const flushPending = (): void => {
      if (pendingCommand) {
        parts.push(`${pendingCommand}${pendingArgs.join(' ')}`);
      }
      pendingCommand = undefined;
      pendingArgs = [];
    };

    let groupIndex = 0;
    for (let offset = 0; offset < values.length; offset += arity) {
      const effectiveCommand = upperCommand === 'M' && groupIndex > 0 ? 'L' : upperCommand;
      const transformed = transformCommandGroup(
        effectiveCommand,
        values.slice(offset, offset + arity),
        isRelative,
        state,
        origin,
      );
      if (pendingCommand && pendingCommand !== effectiveCommand) {
        flushPending();
      }
      pendingCommand = effectiveCommand;
      pendingArgs.push(...transformed);
      groupIndex += 1;
    }
    flushPending();
  }

  return parts.join('');
}

function tokenizePathData(d: string): PathToken[] {
  const tokenRe = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const tokens: PathToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(d)) !== null) {
    const gap = d.slice(lastIndex, match.index);
    if (!/^[\s,]*$/.test(gap)) {
      throw new Error(`Unsupported path data near "${gap}"`);
    }
    const value = match[0];
    tokens.push(isPathCommand(value) ? { type: 'command', value } : { type: 'number', value });
    lastIndex = tokenRe.lastIndex;
  }

  const tail = d.slice(lastIndex);
  if (!/^[\s,]*$/.test(tail)) {
    throw new Error(`Unsupported path data near "${tail}"`);
  }
  if (tokens.length === 0) {
    throw new Error('Path data is empty');
  }

  return tokens;
}

function isPathCommand(value: string): boolean {
  return /^[MmLlHhVvCcSsQqTtAaZz]$/.test(value);
}

function commandArity(command: string): number {
  switch (command) {
    case 'M':
    case 'L':
    case 'T':
      return 2;
    case 'H':
    case 'V':
      return 1;
    case 'C':
      return 6;
    case 'S':
    case 'Q':
      return 4;
    case 'A':
      return 7;
    case 'Z':
      return 0;
    default:
      throw new Error(`Unsupported path command '${command}'`);
  }
}

function transformCommandGroup(
  command: string,
  values: string[],
  isRelative: boolean,
  state: PathTransformState,
  origin: CellCoord,
): string[] {
  if (command === 'M') {
    const point = absolutePoint(parsePathNumber(values[0]!, command), parsePathNumber(values[1]!, command), isRelative && state.hasCurrentPoint, state.current);
    state.current = point;
    state.subpathStart = point;
    state.hasCurrentPoint = true;
    return transformPoint(point, origin);
  }

  if (command === 'L' || command === 'T') {
    const point = absolutePoint(parsePathNumber(values[0]!, command), parsePathNumber(values[1]!, command), isRelative, state.current);
    state.current = point;
    state.hasCurrentPoint = true;
    return transformPoint(point, origin);
  }

  if (command === 'H') {
    const x = isRelative ? state.current.x + parsePathNumber(values[0]!, command) : parsePathNumber(values[0]!, command);
    state.current = { x, y: state.current.y };
    state.hasCurrentPoint = true;
    return [formatNumber(transformX(x, origin.col))];
  }

  if (command === 'V') {
    const y = isRelative ? state.current.y + parsePathNumber(values[0]!, command) : parsePathNumber(values[0]!, command);
    state.current = { x: state.current.x, y };
    state.hasCurrentPoint = true;
    return [formatNumber(transformY(y, origin.row))];
  }

  if (command === 'C') {
    const points = [
      absolutePoint(parsePathNumber(values[0]!, command), parsePathNumber(values[1]!, command), isRelative, state.current),
      absolutePoint(parsePathNumber(values[2]!, command), parsePathNumber(values[3]!, command), isRelative, state.current),
      absolutePoint(parsePathNumber(values[4]!, command), parsePathNumber(values[5]!, command), isRelative, state.current),
    ];
    state.current = points[2]!;
    state.hasCurrentPoint = true;
    return points.flatMap((point) => transformPoint(point, origin));
  }

  if (command === 'S' || command === 'Q') {
    const points = [
      absolutePoint(parsePathNumber(values[0]!, command), parsePathNumber(values[1]!, command), isRelative, state.current),
      absolutePoint(parsePathNumber(values[2]!, command), parsePathNumber(values[3]!, command), isRelative, state.current),
    ];
    state.current = points[1]!;
    state.hasCurrentPoint = true;
    return points.flatMap((point) => transformPoint(point, origin));
  }

  if (command === 'A') {
    const endpoint = absolutePoint(parsePathNumber(values[5]!, command), parsePathNumber(values[6]!, command), isRelative, state.current);
    state.current = endpoint;
    state.hasCurrentPoint = true;
    return [
      formatNumber(scaleLength(parsePathNumber(values[0]!, command))),
      formatNumber(scaleLength(parsePathNumber(values[1]!, command))),
      values[2]!,
      values[3]!,
      values[4]!,
      ...transformPoint(endpoint, origin),
    ];
  }

  throw new Error(`Unsupported path command '${command}'`);
}

function absolutePoint(x: number, y: number, isRelative: boolean, current: PathPoint): PathPoint {
  return isRelative ? { x: current.x + x, y: current.y + y } : { x, y };
}

function transformPoint(point: PathPoint, origin: CellCoord): string[] {
  return [
    formatNumber(transformX(point.x, origin.col)),
    formatNumber(transformY(point.y, origin.row)),
  ];
}

function parsePathNumber(raw: string, command: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric argument "${raw}" in path command '${command}'`);
  }
  return value;
}

function transformX(value: number, originCol: number): number {
  return roundCoord((value - originCol * SOURCE_CELL) * SCALE);
}

function transformY(value: number, originRow: number): number {
  return roundCoord((value - originRow * SOURCE_CELL) * SCALE);
}

function scaleLength(value: number): number {
  return roundCoord(value * SCALE);
}

function roundCoord(value: number): number {
  return Number(formatNumber(value));
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

function numberAttr(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot serialize non-finite number: ${value}`);
  }
  return formatNumber(value);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
