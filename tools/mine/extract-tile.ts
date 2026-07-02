import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseSvgElements, type SvgElement } from './svg.js';
import { segmentCells, type CellSlice } from './cells.js';
import { ensureBackgroundRect, resolveCssClasses, resolveTransforms } from './preprocess.js';
import { maskFillRatio, maskIoU, rasterizeMask } from './raster.js';
import { buildTileMaskLibrary, matchCell, transformMask } from './tile-match.js';

type Rotation = 0 | 90 | 180 | 270;

interface CellCoord {
  col: number;
  row: number;
}

interface MinedTileManifestEntry {
  id: string;
  filename: string;
  shape_family: string;
  visual_weight: number;
  edge_coverage: { top: number; right: number; bottom: number; left: number };
  dominant_direction: 'neutral';
  renderable: true;
  has_background_rect: true;
  mined_from: string;
}

type PathToken =
  | { type: 'command'; value: string }
  | { type: 'number'; value: string };

const PROJECT_ROOT = resolve('.');
const BANNERS_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'banners');
const TILES_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles');
const MANIFEST_PATH = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const MINED_TILES_DIR = join(PROJECT_ROOT, 'corpus', 'mined-tiles');
const MINED_MANIFEST_PATH = join(MINED_TILES_DIR, 'manifest.json');
const BANNER_CELL = 320;
const TILE_SIZE = 200;
const MASK_SIZE = 64;
const TILE_SCALE = TILE_SIZE / BANNER_CELL;
const TILE_GROUND = '#F3F3F3';
const TILE_INK = '#121212';
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const FLIPS = [false, true] as const;

export function transformPathDataForCell(d: string, cell: CellCoord): string {
  const tokens = tokenizePathData(d);
  const parts: string[] = [];
  let idx = 0;

  while (idx < tokens.length) {
    const commandToken = tokens[idx];
    if (!commandToken || commandToken.type !== 'command') {
      throw new Error(`Expected path command at token ${idx}`);
    }
    idx += 1;

    const command = commandToken.value;
    if (command !== command.toUpperCase()) {
      throw new Error(`Relative path command '${command}' is not supported`);
    }

    const arity = commandArity(command);
    if (arity === 0) {
      parts.push(command);
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

    const transformed: string[] = [];
    for (let offset = 0; offset < values.length; offset += arity) {
      transformed.push(...transformCommandGroup(command, values.slice(offset, offset + arity), cell));
    }
    parts.push(`${command}${transformed.join(' ')}`);
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
    tokens.push(/[A-Za-z]/.test(value) ? { type: 'command', value } : { type: 'number', value });
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

function transformCommandGroup(command: string, values: string[], cell: CellCoord): string[] {
  if (command === 'H') {
    return [formatNumber(transformX(parsePathNumber(values[0]!, command), cell.col))];
  }
  if (command === 'V') {
    return [formatNumber(transformY(parsePathNumber(values[0]!, command), cell.row))];
  }
  if (command === 'A') {
    return [
      formatNumber(scaleLength(parsePathNumber(values[0]!, command))),
      formatNumber(scaleLength(parsePathNumber(values[1]!, command))),
      values[2]!,
      values[3]!,
      values[4]!,
      formatNumber(transformX(parsePathNumber(values[5]!, command), cell.col)),
      formatNumber(transformY(parsePathNumber(values[6]!, command), cell.row)),
    ];
  }

  const transformed: string[] = [];
  for (let idx = 0; idx < values.length; idx += 2) {
    transformed.push(formatNumber(transformX(parsePathNumber(values[idx]!, command), cell.col)));
    transformed.push(formatNumber(transformY(parsePathNumber(values[idx + 1]!, command), cell.row)));
  }
  return transformed;
}

function parsePathNumber(raw: string, command: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric argument "${raw}" in path command '${command}'`);
  }
  return value;
}

function transformElementToTileSpace(el: SvgElement, cell: CellCoord): SvgElement {
  if (el.kind === 'rect') {
    return {
      ...el,
      x: transformX(el.x ?? 0, cell.col),
      y: transformY(el.y ?? 0, cell.row),
      w: scaleLength(el.w ?? 0),
      h: scaleLength(el.h ?? 0),
    };
  }
  if (el.kind === 'circle') {
    return {
      ...el,
      cx: transformX(el.cx ?? 0, cell.col),
      cy: transformY(el.cy ?? 0, cell.row),
      r: scaleLength(el.r ?? 0),
    };
  }
  if (el.kind === 'ellipse') {
    return {
      ...el,
      cx: transformX(el.cx ?? 0, cell.col),
      cy: transformY(el.cy ?? 0, cell.row),
      rx: scaleLength(el.rx ?? 0),
      ry: scaleLength(el.ry ?? 0),
    };
  }
  if (el.kind === 'path') {
    return {
      ...el,
      d: transformPathDataForCell(el.d ?? '', cell),
    };
  }
  return el;
}

function transformX(value: number, col: number): number {
  return (value - col * BANNER_CELL) * TILE_SCALE;
}

function transformY(value: number, row: number): number {
  return (value - row * BANNER_CELL) * TILE_SCALE;
}

function scaleLength(value: number): number {
  return value * TILE_SCALE;
}

function recolorElement(el: SvgElement, cellGround: string): SvgElement {
  return { ...el, fill: el.fill === cellGround ? TILE_GROUND : TILE_INK };
}

function serializeTileElement(el: SvgElement): string {
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

function tileSvg(elements: SvgElement[]): string {
  const body = [
    `<rect width="${TILE_SIZE}" height="${TILE_SIZE}" fill="${TILE_GROUND}"/>`,
    ...elements.map(serializeTileElement),
  ].join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}" width="${TILE_SIZE}" height="${TILE_SIZE}">\n  ${body}\n</svg>\n`;
}

function backgroundElement(): SvgElement {
  return { kind: 'rect', fill: TILE_GROUND, x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };
}

async function tileMask(elements: SvgElement[]): Promise<Uint8Array> {
  return rasterizeMask(
    [backgroundElement(), ...elements],
    { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE },
    MASK_SIZE,
    (el) => el.fill !== 'none' && el.fill !== TILE_GROUND,
  );
}

function edgeCoverage(mask: Uint8Array, size: number): MinedTileManifestEntry['edge_coverage'] {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;

  for (let idx = 0; idx < size; idx += 1) {
    top += mask[idx] ?? 0;
    right += mask[idx * size + size - 1] ?? 0;
    bottom += mask[(size - 1) * size + idx] ?? 0;
    left += mask[idx * size] ?? 0;
  }

  return {
    top: roundMetric(top / size),
    right: roundMetric(right / size),
    bottom: roundMetric(bottom / size),
    left: roundMetric(left / size),
  };
}

function readMinedManifest(): MinedTileManifestEntry[] {
  if (!existsSync(MINED_MANIFEST_PATH)) {
    return [];
  }
  const raw = JSON.parse(readFileSync(MINED_MANIFEST_PATH, 'utf8')) as
    | MinedTileManifestEntry[]
    | { tiles?: MinedTileManifestEntry[] };
  const entries = Array.isArray(raw) ? raw : raw.tiles;
  if (!Array.isArray(entries)) {
    throw new Error(`Mined tile manifest must be an array or contain a tiles array: ${MINED_MANIFEST_PATH}`);
  }
  return entries;
}

function writeMinedManifest(entry: MinedTileManifestEntry): void {
  const entries = readMinedManifest();
  const existingIndex = entries.findIndex((candidate) => candidate.id === entry.id);
  if (existingIndex >= 0) {
    entries[existingIndex] = entry;
  } else {
    entries.push(entry);
  }
  writeFileSync(MINED_MANIFEST_PATH, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

async function printRematchReport(cells: CellSlice[], minedMask: Uint8Array): Promise<void> {
  const referenceLibrary = await buildTileMaskLibrary(TILES_DIR, MANIFEST_PATH);
  const minedVariants = ROTATIONS.flatMap((rotation) =>
    FLIPS.map((flip) => ({
      rotation,
      flip,
      mask: transformMask(minedMask, MASK_SIZE, rotation, flip),
    })),
  );

  console.log('\nREMATCH REPORT');
  console.log('cell currentKind bestVariant(rot/flip) score');

  let printed = 0;
  for (const cell of cells) {
    const cellMask = await rasterizeMask(
      cell.foreground,
      { x: cell.col * BANNER_CELL, y: cell.row * BANNER_CELL, w: BANNER_CELL, h: BANNER_CELL },
      MASK_SIZE,
      (el) => el.fill !== cell.ground,
    );
    const current = matchCell(cellMask, referenceLibrary);
    if (current.kind !== 'review' && current.kind !== 'freeform') {
      continue;
    }

    const best = minedVariants
      .map((variant) => ({
        rotation: variant.rotation,
        flip: variant.flip,
        score: maskIoU(cellMask, variant.mask),
      }))
      .sort((a, b) => b.score - a.score || a.rotation - b.rotation || Number(a.flip) - Number(b.flip))[0];

    if (!best) {
      continue;
    }
    printed += 1;
    console.log(`${cell.col},${cell.row} ${current.kind} ${best.rotation}/${best.flip} ${best.score.toFixed(4)}`);
  }

  if (printed === 0) {
    console.log('(no review/freeform cells in this banner under the current reference library)');
  }
}

function parseArgs(argv: string[]): { banner: string; cell: CellCoord; id: string; family: string } {
  const banner = requiredArg(argv, '--banner').padStart(3, '0');
  const cell = parseCell(requiredArg(argv, '--cell'));
  const id = requiredArg(argv, '--id');
  const family = requiredArg(argv, '--family');
  return { banner, cell, id, family };
}

function requiredArg(argv: string[], name: string): string {
  const idx = argv.indexOf(name);
  const value = idx >= 0 ? argv[idx + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing required argument ${name}`);
  }
  return value;
}

function parseCell(raw: string): CellCoord {
  const match = raw.match(/^(\d+),(\d+)$/);
  if (!match) {
    throw new Error(`--cell must be in "col,row" form, got "${raw}"`);
  }
  const col = Number(match[1]);
  const row = Number(match[2]);
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) {
    throw new Error(`Invalid cell coordinate "${raw}"`);
  }
  return { col, row };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bannerPath = join(BANNERS_DIR, `${args.banner}.svg`);
  if (!existsSync(bannerPath)) {
    throw new Error(`Banner not found: ${bannerPath}`);
  }

  const rawSvg = readFileSync(bannerPath, 'utf8');
  const parsed = parseSvgElements(resolveTransforms(resolveCssClasses(ensureBackgroundRect(rawSvg))));
  const { cells } = segmentCells(parsed);
  const cell = cells.find((candidate) => candidate.col === args.cell.col && candidate.row === args.cell.row);
  if (!cell) {
    throw new Error(`Cell ${args.cell.col},${args.cell.row} not found in banner ${args.banner}`);
  }
  if (cell.foreground.length === 0) {
    throw new Error(`Cell ${args.cell.col},${args.cell.row} has no foreground elements to extract`);
  }

  const tileElements = cell.foreground
    .map((el) => transformElementToTileSpace(el, args.cell))
    .map((el) => recolorElement(el, cell.ground));

  mkdirSync(MINED_TILES_DIR, { recursive: true });
  const tilePath = join(MINED_TILES_DIR, `${args.id}.svg`);
  writeFileSync(tilePath, tileSvg(tileElements), 'utf8');

  const mask = await tileMask(tileElements);
  const entry: MinedTileManifestEntry = {
    id: args.id,
    filename: `${args.id}.svg`,
    shape_family: args.family,
    visual_weight: roundMetric(maskFillRatio(mask)),
    edge_coverage: edgeCoverage(mask, MASK_SIZE),
    dominant_direction: 'neutral',
    renderable: true,
    has_background_rect: true,
    mined_from: `${args.banner}/${args.cell.col},${args.cell.row}`,
  };
  writeMinedManifest(entry);

  console.log(`Wrote ${tilePath}`);
  console.log(`Updated ${MINED_MANIFEST_PATH}`);
  await printRematchReport(cells, mask);
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
