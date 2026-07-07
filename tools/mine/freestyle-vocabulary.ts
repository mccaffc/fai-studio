import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import canvasPkg from 'canvas';
import { parseSvgElements, type SvgElement } from './svg.js';
import { resolveCssClasses, resolveTransforms } from './preprocess.js';
import { maskFillRatio, maskIoU, rasterizeMask } from './raster.js';
import { transformMask } from './tile-match.js';
import { loadMergedManifest, recoloredTile, renderRecon } from './render-recon.js';
import type { BannerRecon, CellRecon, ManifestTile } from './schema.js';

const { createCanvas } = canvasPkg;

type SuggestedFamily = 'capsule/lens-like' | 'wave/scallop-like' | 'other';
type AcceptedFamily = 'float' | 'wave';
type Rotation = 0 | 90 | 180 | 270;

interface CandidateManifestEntry {
  id: string;
  filename: string;
  source: string;
  illustration: string;
  cell: { col: number; row: number };
  bbox: { x: number; y: number; width: number; height: number };
  suggested_family: SuggestedFamily;
  novelty_score: number;
  mask_fill: number;
}

interface CandidateManifest {
  candidates: CandidateManifestEntry[];
}

interface CandidateAnalysis {
  candidate: CandidateManifestEntry;
  mask: Uint8Array;
  fillRatio: number;
  edgeCoverage: EdgeCoverage;
  edgeTouches: EdgeTouches;
  acceptedFamily: AcceptedFamily;
  duplicateOf?: string;
}

interface AcceptedTile extends CandidateAnalysis {
  acceptedId: string;
  acceptedFilename: string;
}

interface EdgeCoverage {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface EdgeTouches {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

interface SelectionStats {
  totalCandidates: number;
  excludedFamily: number;
  targetFamilyPool: number;
  coverageLow: number;
  coverageHigh: number;
  edgeContact: number;
  novelty: number;
  duplicate: number;
  rankOverflow: number;
  survivorsBeforeDedupe: number;
  survivorsAfterDedupe: number;
}

interface VocabularyReport {
  generatedAt: string;
  stats: SelectionStats;
  accepted: Array<{
    id: string;
    sourceCandidate: string;
    suggestedFamily: SuggestedFamily;
    shapeFamily: AcceptedFamily;
    novelty: number;
    fillRatio: number;
    edges: EdgeCoverage;
    touches: EdgeTouches;
  }>;
  rankOverflow: Array<{
    sourceCandidate: string;
    suggestedFamily: SuggestedFamily;
    novelty: number;
  }>;
}

type PathToken =
  | { type: 'command'; value: string }
  | { type: 'number'; value: string };

interface PathPoint {
  x: number;
  y: number;
}

interface PathTransformState {
  current: PathPoint;
  subpathStart: PathPoint;
  hasCurrentPoint: boolean;
}

const PROJECT_ROOT = resolve('.');
const CANDIDATE_DIR = join(PROJECT_ROOT, 'corpus', 'mined-tiles', 'freestyle-candidates');
const CANDIDATE_MANIFEST_PATH = join(CANDIDATE_DIR, 'manifest.json');
const MINED_TILES_DIR = join(PROJECT_ROOT, 'corpus', 'mined-tiles');
const MINED_MANIFEST_PATH = join(MINED_TILES_DIR, 'manifest.json');
const ACCEPTED_SHEET_PATH = join(CANDIDATE_DIR, 'ACCEPTED.png');
const MASK_SIZE = 64;
const TILE_SIZE = 200;
const TILE_GROUND = '#F3F3F3';
const TILE_INK = '#121212';
const EDGE_SYMMETRY_TOLERANCE = 0.125;
const DEDUPE_IOU = 0.85;
const MIN_FILL = 0.08;
const MAX_FILL = 0.85;
const MIN_NOVELTY = 0.25;
const FAMILY_LIMIT = 8;
const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const FLIPS = [false, true] as const;

const FAMILY_MAP: Record<Exclude<SuggestedFamily, 'other'>, AcceptedFamily> = {
  'capsule/lens-like': 'float',
  'wave/scallop-like': 'wave',
};

function readCandidateManifest(): CandidateManifest {
  const raw = JSON.parse(readFileSync(CANDIDATE_MANIFEST_PATH, 'utf8')) as CandidateManifest;
  if (!Array.isArray(raw.candidates)) {
    throw new Error(`Candidate manifest must contain a candidates array: ${CANDIDATE_MANIFEST_PATH}`);
  }
  return raw;
}

async function analyzeCandidate(candidate: CandidateManifestEntry): Promise<CandidateAnalysis> {
  if (candidate.suggested_family === 'other') {
    throw new Error(`Cannot analyze excluded candidate family: ${candidate.id}`);
  }
  const raw = readFileSync(join(CANDIDATE_DIR, candidate.filename), 'utf8');
  const parsed = parseSvgElements(resolveTransforms(resolveCssClasses(raw)));
  const mask = await rasterizeMask(
    parsed.elements,
    {
      x: candidate.bbox.x,
      y: candidate.bbox.y,
      w: candidate.bbox.width,
      h: candidate.bbox.height,
    },
    MASK_SIZE,
    el => el.fill !== 'none' && el.fill !== TILE_GROUND,
  );
  const edgeCoverage = computeEdgeCoverage(mask);
  return {
    candidate,
    mask,
    fillRatio: maskFillRatio(mask),
    edgeCoverage,
    edgeTouches: edgeTouches(edgeCoverage),
    acceptedFamily: FAMILY_MAP[candidate.suggested_family],
  };
}

function passesEdgeContact(coverage: EdgeCoverage): boolean {
  const touches = edgeTouches(coverage);
  const count = Object.values(touches).filter(Boolean).length;
  if (count <= 3) return true;
  return (
    Math.abs(coverage.top - coverage.bottom) <= EDGE_SYMMETRY_TOLERANCE &&
    Math.abs(coverage.left - coverage.right) <= EDGE_SYMMETRY_TOLERANCE
  );
}

function edgeTouches(coverage: EdgeCoverage): EdgeTouches {
  return {
    top: coverage.top > 0,
    right: coverage.right > 0,
    bottom: coverage.bottom > 0,
    left: coverage.left > 0,
  };
}

function computeEdgeCoverage(mask: Uint8Array): EdgeCoverage {
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

function compareCandidateRank(a: CandidateAnalysis, b: CandidateAnalysis): number {
  const noveltyDiff = b.candidate.novelty_score - a.candidate.novelty_score;
  if (noveltyDiff !== 0) return noveltyDiff;
  return a.candidate.id.localeCompare(b.candidate.id);
}

function candidateVariants(mask: Uint8Array): Uint8Array[] {
  const variants: Uint8Array[] = [];
  const seen = new Set<string>();
  for (const rotation of ROTATIONS) {
    for (const flip of FLIPS) {
      const transformed = transformMask(mask, MASK_SIZE, rotation, flip);
      const key = Buffer.from(transformed).toString('base64');
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(transformed);
    }
  }
  return variants;
}

function maxVariantIoU(a: Uint8Array, bVariants: Uint8Array[]): number {
  let best = 0;
  for (const variant of bVariants) {
    best = Math.max(best, maskIoU(a, variant));
  }
  return best;
}

async function selectAcceptedTiles(): Promise<{ accepted: AcceptedTile[]; report: VocabularyReport }> {
  const manifest = readCandidateManifest();
  const stats: SelectionStats = {
    totalCandidates: manifest.candidates.length,
    excludedFamily: 0,
    targetFamilyPool: 0,
    coverageLow: 0,
    coverageHigh: 0,
    edgeContact: 0,
    novelty: 0,
    duplicate: 0,
    rankOverflow: 0,
    survivorsBeforeDedupe: 0,
    survivorsAfterDedupe: 0,
  };
  const survivors: CandidateAnalysis[] = [];

  for (const candidate of manifest.candidates) {
    if (candidate.suggested_family === 'other') {
      stats.excludedFamily += 1;
      continue;
    }
    stats.targetFamilyPool += 1;

    const analysis = await analyzeCandidate(candidate);
    if (analysis.fillRatio < MIN_FILL) {
      stats.coverageLow += 1;
      continue;
    }
    if (analysis.fillRatio > MAX_FILL) {
      stats.coverageHigh += 1;
      continue;
    }
    if (!passesEdgeContact(analysis.edgeCoverage)) {
      stats.edgeContact += 1;
      continue;
    }
    if (candidate.novelty_score < MIN_NOVELTY) {
      stats.novelty += 1;
      continue;
    }
    survivors.push(analysis);
  }

  stats.survivorsBeforeDedupe = survivors.length;

  const deduped: CandidateAnalysis[] = [];
  const dedupedVariants: Array<{ id: string; variants: Uint8Array[] }> = [];
  for (const candidate of [...survivors].sort(compareCandidateRank)) {
    const duplicate = dedupedVariants.find(entry => maxVariantIoU(candidate.mask, entry.variants) >= DEDUPE_IOU);
    if (duplicate) {
      candidate.duplicateOf = duplicate.id;
      stats.duplicate += 1;
      continue;
    }
    deduped.push(candidate);
    dedupedVariants.push({ id: candidate.candidate.id, variants: candidateVariants(candidate.mask) });
  }

  stats.survivorsAfterDedupe = deduped.length;

  const accepted: AcceptedTile[] = [];
  const rankOverflow: CandidateAnalysis[] = [];
  for (const family of ['float', 'wave'] as const) {
    const ranked = deduped
      .filter(candidate => candidate.acceptedFamily === family)
      .sort(compareCandidateRank);
    ranked.slice(0, FAMILY_LIMIT).forEach((candidate, idx) => {
      const acceptedId = `mined-fs-${family}-${String(idx + 1).padStart(2, '0')}`;
      accepted.push({
        ...candidate,
        acceptedId,
        acceptedFilename: `${acceptedId}.svg`,
      });
    });
    rankOverflow.push(...ranked.slice(FAMILY_LIMIT));
  }
  stats.rankOverflow = rankOverflow.length;

  accepted.sort((a, b) => a.acceptedId.localeCompare(b.acceptedId));

  return {
    accepted,
    report: {
      generatedAt: new Date().toISOString(),
      stats,
      accepted: accepted.map(tile => ({
        id: tile.acceptedId,
        sourceCandidate: tile.candidate.id,
        suggestedFamily: tile.candidate.suggested_family,
        shapeFamily: tile.acceptedFamily,
        novelty: tile.candidate.novelty_score,
        fillRatio: roundMetric(tile.fillRatio),
        edges: tile.edgeCoverage,
        touches: tile.edgeTouches,
      })),
      rankOverflow: rankOverflow
        .sort(compareCandidateRank)
        .map(tile => ({
          sourceCandidate: tile.candidate.id,
          suggestedFamily: tile.candidate.suggested_family,
          novelty: tile.candidate.novelty_score,
        })),
    },
  };
}

function readMinedManifest(): ManifestTile[] {
  if (!existsSync(MINED_MANIFEST_PATH)) return [];
  const raw = JSON.parse(readFileSync(MINED_MANIFEST_PATH, 'utf8')) as ManifestTile[] | { tiles?: ManifestTile[] };
  const entries = Array.isArray(raw) ? raw : raw.tiles;
  if (!Array.isArray(entries)) {
    throw new Error(`Mined tile manifest must be an array or contain a tiles array: ${MINED_MANIFEST_PATH}`);
  }
  return entries;
}

function writeAcceptedTiles(accepted: AcceptedTile[]): void {
  mkdirSync(MINED_TILES_DIR, { recursive: true });
  for (const file of readdirSync(MINED_TILES_DIR)) {
    if (/^mined-fs-(?:float|wave)-\d\d\.svg$/.test(file)) {
      unlinkSync(join(MINED_TILES_DIR, file));
    }
  }

  for (const tile of accepted) {
    writeFileSync(
      join(MINED_TILES_DIR, tile.acceptedFilename),
      normalizedTileSvg(tile.candidate),
      'utf8',
    );
  }

  const keep = readMinedManifest().filter(tile => !/^mined-fs-(?:float|wave)-\d\d$/.test(tile.id));
  const additions: ManifestTile[] = accepted.map(tile => ({
    id: tile.acceptedId,
    filename: tile.acceptedFilename,
    shape_family: tile.acceptedFamily,
    visual_weight: roundMetric(tile.fillRatio),
    edge_coverage: tile.edgeCoverage,
    dominant_direction: 'neutral',
    renderable: true,
    has_background_rect: true,
    mined_from: `freestyle-candidates/${tile.candidate.id}`,
    // wave tiles are program-context-only: invisible to auto mode, reachable
    // only when a familyFloor covering 'wave' is active (e.g. Energy program).
    ...(tile.acceptedFamily === 'wave' ? { program_only: true } : {}),
  }));
  writeFileSync(MINED_MANIFEST_PATH, `${JSON.stringify([...keep, ...additions], null, 2)}\n`, 'utf8');
}

function normalizedTileSvg(candidate: CandidateManifestEntry): string {
  const raw = readFileSync(join(CANDIDATE_DIR, candidate.filename), 'utf8');
  const parsed = parseSvgElements(resolveTransforms(resolveCssClasses(raw)));
  const body = parsed.elements
    .filter((el, idx) => !isCandidateBackground(el, candidate, idx))
    .filter(el => el.fill !== 'none')
    .map(el => serializeTileElement(transformElement(el, candidate.bbox)))
    .join('\n  ');
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE_SIZE} ${TILE_SIZE}" width="${TILE_SIZE}" height="${TILE_SIZE}">`,
    `  <rect width="${TILE_SIZE}" height="${TILE_SIZE}" fill="${TILE_GROUND}"/>`,
  ];
  if (body) lines.push(`  ${body}`);
  lines.push('</svg>', '');
  return lines.join('\n');
}

function isCandidateBackground(el: SvgElement, candidate: CandidateManifestEntry, idx: number): boolean {
  if (idx !== 0 || el.kind !== 'rect') return false;
  return (
    el.fill === TILE_GROUND &&
    nearlyEqual(el.x ?? 0, candidate.bbox.x) &&
    nearlyEqual(el.y ?? 0, candidate.bbox.y) &&
    nearlyEqual(el.w ?? 0, candidate.bbox.width) &&
    nearlyEqual(el.h ?? 0, candidate.bbox.height)
  );
}

function transformElement(el: SvgElement, bbox: CandidateManifestEntry['bbox']): SvgElement {
  const scaleX = TILE_SIZE / bbox.width;
  const scaleY = TILE_SIZE / bbox.height;
  const tx = (value: number): number => (value - bbox.x) * scaleX;
  const ty = (value: number): number => (value - bbox.y) * scaleY;
  const sx = (value: number): number => value * scaleX;
  const sy = (value: number): number => value * scaleY;

  if (el.kind === 'rect') {
    return { ...el, x: tx(el.x ?? 0), y: ty(el.y ?? 0), w: sx(el.w ?? 0), h: sy(el.h ?? 0) };
  }
  if (el.kind === 'circle') {
    return { ...el, cx: tx(el.cx ?? 0), cy: ty(el.cy ?? 0), r: sx(el.r ?? 0) };
  }
  if (el.kind === 'ellipse') {
    return { ...el, cx: tx(el.cx ?? 0), cy: ty(el.cy ?? 0), rx: sx(el.rx ?? 0), ry: sy(el.ry ?? 0) };
  }
  if (el.kind === 'path') {
    return { ...el, d: transformPathData(el.d ?? '', bbox) };
  }
  return el;
}

function transformPathData(d: string, bbox: CandidateManifestEntry['bbox']): string {
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
        bbox,
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
    tokens.push(/^[A-Za-z]$/.test(value) ? { type: 'command', value } : { type: 'number', value });
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

function transformCommandGroup(
  command: string,
  values: string[],
  isRelative: boolean,
  state: PathTransformState,
  bbox: CandidateManifestEntry['bbox'],
): string[] {
  if (command === 'M') {
    const point = absolutePoint(pathNumber(values[0]!, command), pathNumber(values[1]!, command), isRelative && state.hasCurrentPoint, state.current);
    state.current = point;
    state.subpathStart = point;
    state.hasCurrentPoint = true;
    return transformPoint(point, bbox);
  }
  if (command === 'L' || command === 'T') {
    const point = absolutePoint(pathNumber(values[0]!, command), pathNumber(values[1]!, command), isRelative, state.current);
    state.current = point;
    state.hasCurrentPoint = true;
    return transformPoint(point, bbox);
  }
  if (command === 'H') {
    const x = isRelative ? state.current.x + pathNumber(values[0]!, command) : pathNumber(values[0]!, command);
    state.current = { x, y: state.current.y };
    state.hasCurrentPoint = true;
    return [formatNumber(transformX(x, bbox))];
  }
  if (command === 'V') {
    const y = isRelative ? state.current.y + pathNumber(values[0]!, command) : pathNumber(values[0]!, command);
    state.current = { x: state.current.x, y };
    state.hasCurrentPoint = true;
    return [formatNumber(transformY(y, bbox))];
  }
  if (command === 'C') {
    const points = [
      absolutePoint(pathNumber(values[0]!, command), pathNumber(values[1]!, command), isRelative, state.current),
      absolutePoint(pathNumber(values[2]!, command), pathNumber(values[3]!, command), isRelative, state.current),
      absolutePoint(pathNumber(values[4]!, command), pathNumber(values[5]!, command), isRelative, state.current),
    ];
    state.current = points[2]!;
    state.hasCurrentPoint = true;
    return points.flatMap(point => transformPoint(point, bbox));
  }
  if (command === 'S' || command === 'Q') {
    const points = [
      absolutePoint(pathNumber(values[0]!, command), pathNumber(values[1]!, command), isRelative, state.current),
      absolutePoint(pathNumber(values[2]!, command), pathNumber(values[3]!, command), isRelative, state.current),
    ];
    state.current = points[1]!;
    state.hasCurrentPoint = true;
    return points.flatMap(point => transformPoint(point, bbox));
  }
  if (command === 'A') {
    const endpoint = absolutePoint(pathNumber(values[5]!, command), pathNumber(values[6]!, command), isRelative, state.current);
    state.current = endpoint;
    state.hasCurrentPoint = true;
    return [
      formatNumber(scaleX(pathNumber(values[0]!, command), bbox)),
      formatNumber(scaleY(pathNumber(values[1]!, command), bbox)),
      values[2]!,
      values[3]!,
      values[4]!,
      ...transformPoint(endpoint, bbox),
    ];
  }
  throw new Error(`Unsupported path command '${command}'`);
}

function absolutePoint(x: number, y: number, isRelative: boolean, current: PathPoint): PathPoint {
  return isRelative ? { x: current.x + x, y: current.y + y } : { x, y };
}

function transformPoint(point: PathPoint, bbox: CandidateManifestEntry['bbox']): string[] {
  return [formatNumber(transformX(point.x, bbox)), formatNumber(transformY(point.y, bbox))];
}

function transformX(value: number, bbox: CandidateManifestEntry['bbox']): number {
  return (value - bbox.x) * (TILE_SIZE / bbox.width);
}

function transformY(value: number, bbox: CandidateManifestEntry['bbox']): number {
  return (value - bbox.y) * (TILE_SIZE / bbox.height);
}

function scaleX(value: number, bbox: CandidateManifestEntry['bbox']): number {
  return value * (TILE_SIZE / bbox.width);
}

function scaleY(value: number, bbox: CandidateManifestEntry['bbox']): number {
  return value * (TILE_SIZE / bbox.height);
}

function pathNumber(raw: string, command: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric argument "${raw}" in path command '${command}'`);
  }
  return value;
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

async function renderAcceptedSheet(accepted: AcceptedTile[]): Promise<void> {
  const rowH = 156;
  const margin = 28;
  const thumb = 112;
  const stripW = 360;
  const stripH = 120;
  const sheetW = margin * 2 + thumb + 24 + stripW + 300;
  const sheetH = margin * 2 + 34 + Math.max(accepted.length, 1) * rowH;
  const canvas = createCanvas(sheetW, sheetH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sheetW, sheetH);
  ctx.fillStyle = '#121212';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(`Accepted freestyle vocabulary (${accepted.length})`, margin, margin + 18);

  const manifest = loadMergedManifest();
  let y = margin + 48;
  for (const tile of accepted) {
    ctx.fillStyle = '#F7F7F7';
    ctx.fillRect(margin, y, thumb, thumb);
    ctx.strokeStyle = '#C7C7C7';
    ctx.strokeRect(margin + 0.5, y + 0.5, thumb - 1, thumb - 1);
    const tileImage = await recoloredTile(tile.acceptedId, TILE_INK, TILE_GROUND, manifest);
    ctx.drawImage(tileImage, margin + 8, y + 8, thumb - 16, thumb - 16);

    const strip = await renderContextStrip(tile.acceptedId);
    ctx.drawImage(strip, margin + thumb + 24, y, stripW, stripH);

    const labelX = margin + thumb + 24 + stripW + 22;
    ctx.fillStyle = '#121212';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(tile.acceptedId, labelX, y + 20);
    ctx.font = '12px monospace';
    ctx.fillText(`src ${tile.candidate.id}`, labelX, y + 42);
    ctx.fillText(`novelty ${tile.candidate.novelty_score.toFixed(4)}`, labelX, y + 62);
    ctx.fillText(`fill ${tile.fillRatio.toFixed(4)}`, labelX, y + 82);
    ctx.fillText(`edges ${edgeSummary(tile.edgeCoverage)}`, labelX, y + 102);
    y += rowH;
  }

  writeFileSync(ACCEPTED_SHEET_PATH, canvas.toBuffer('image/png'));
}

async function renderContextStrip(tileId: string): Promise<ReturnType<typeof createCanvas>> {
  const cells: CellRecon[] = [
    contextCell(0, '#F3F3F3', '#121212', tileId),
    contextCell(1, '#121212', '#F3F3F3', tileId),
    contextCell(2, '#D9D9D6', '#121212', tileId),
  ];
  const banner: BannerRecon = {
    id: `accepted-${tileId}`,
    width: 720,
    height: 360,
    cols: 6,
    rows: 3,
    ground: '#F3F3F3',
    cells,
    forms: [],
    matchRate: 1,
  };
  const rendered = await renderRecon(banner, null, loadMergedManifest());
  const strip = createCanvas(360, 120);
  const ctx = strip.getContext('2d');
  ctx.drawImage(rendered, 0, 0, 360, 120, 0, 0, 360, 120);
  ctx.strokeStyle = '#C7C7C7';
  ctx.strokeRect(0.5, 0.5, 359, 119);
  return strip;
}

function contextCell(col: number, ground: string, ink: string, tile: string): CellRecon {
  return {
    col,
    row: 0,
    ground,
    kind: 'tile',
    tile,
    rotation: 0,
    flip: false,
    ink,
    score: 1,
    candidates: [],
  };
}

function edgeSummary(edges: EdgeCoverage): string {
  return `${edges.top}/${edges.right}/${edges.bottom}/${edges.left}`;
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

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.001;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function main(): Promise<void> {
  const { accepted, report } = await selectAcceptedTiles();
  writeAcceptedTiles(accepted);
  await renderAcceptedSheet(accepted);

  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${MINED_MANIFEST_PATH}`);
  console.log(`Wrote ${ACCEPTED_SHEET_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
