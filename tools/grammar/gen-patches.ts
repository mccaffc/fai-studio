/**
 * gen-patches.ts - Generates src/engine/corpus/data/patches.ts
 * from curated rectangular BannerRecon cell crops.
 *
 * Run via: npm run gen:patches
 * Optional curation: npm run gen:patches -- --include patch-036-dome,patch-042-robot
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import canvasPkg from 'canvas';
import { loadMergedManifest, recoloredTile } from '../mine/render-recon.js';
import type { BannerRecon, CellRecon, Corpus } from '../mine/schema.js';

const { createCanvas } = canvasPkg;

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const OUT_FILE = join(ROOT, 'src', 'engine', 'corpus', 'data', 'patches.ts');
const SHEET_FILE = join(ROOT, 'corpus', 'samples', 'patches-sheet.png');

const DATA_BUDGET_BYTES = 60 * 1024;
const SHEET_COLS = 4;
const SHEET_CARD_W = 256;
const SHEET_CARD_H = 214;
const SHEET_CELL = 44;
const ROLE_DEFAULTS = {
  ink: '#121212',
  accent: '#FF4F00',
  ink2: '#F3F3F3',
  g0: '#F3F3F3',
  g1: '#D9D9D6',
  g2: '#121212',
} as const;

type InkRole = 'ink' | 'accent' | 'ink2';
type GroundRole = 'g0' | 'g1' | 'g2';
type PatchKind = 'tile' | 'plain';

interface SeedPatch {
  id: string;
  banner: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PatchCell {
  dx: number;
  dy: number;
  kind: PatchKind;
  tile?: string;
  rotation?: 0 | 90 | 180 | 270;
  flip?: boolean;
  inkRole?: InkRole;
  groundRole: GroundRole;
}

interface IconicPatch {
  id: string;
  source: string;
  w: number;
  h: number;
  cells: PatchCell[];
}

interface ExtractionNote {
  id: string;
  source: string;
  inkRoles: Record<string, InkRole>;
  groundRoles: Record<string, GroundRole>;
  skippedFreeform: number;
  cells: number;
}

export const SEED_PATCHES: SeedPatch[] = [
  { id: 'patch-036-dome', banner: '036', x: 1, y: 1, w: 4, h: 2 },
  { id: 'patch-037-dome', banner: '037', x: 1, y: 1, w: 4, h: 2 },
  { id: 'patch-042-robot', banner: '042', x: 1, y: 0, w: 3, h: 2 },
  { id: 'patch-044-robot', banner: '044', x: 1, y: 1, w: 3, h: 2 },
  { id: 'patch-018-house', banner: '018', x: 0, y: 1, w: 3, h: 2 },
  { id: 'patch-023-arcs', banner: '023', x: 2, y: 1, w: 2, h: 2 },
  { id: 'patch-011-discface', banner: '011', x: 2, y: 0, w: 2, h: 2 },
];

/**
 * CURATED SHIP LIST - seeded P4 Task 1 list. Defaults to all seeds for the
 * first visual pass; use --include to emit a narrower operator-curated subset.
 */
const CURATED = new Set(SEED_PATCHES.map(patch => patch.id));

function parseArgs(argv: string[]): { include: Set<string> } {
  const includeIdx = argv.indexOf('--include');
  if (includeIdx === -1) {
    return { include: CURATED };
  }
  const value = argv[includeIdx + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('Missing value for --include');
  }
  const ids = value.split(',').map(id => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error('--include must contain at least one patch id');
  }
  return { include: new Set(ids) };
}

function computeSourceHash(corpusJson: string): string {
  return createHash('sha256').update(corpusJson).digest('hex');
}

function rowMajor(a: CellRecon, b: CellRecon): number {
  return a.row - b.row || a.col - b.col;
}

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function patchSource(seed: SeedPatch): string {
  return `${seed.banner}/${seed.x},${seed.y}/${seed.w}x${seed.h}`;
}

function cropCells(banner: BannerRecon, seed: SeedPatch): CellRecon[] {
  const byPos = new Map(banner.cells.map(cell => [cellKey(cell.col, cell.row), cell]));
  const cells: CellRecon[] = [];
  for (let row = seed.y; row < seed.y + seed.h; row += 1) {
    for (let col = seed.x; col < seed.x + seed.w; col += 1) {
      const cell = byPos.get(cellKey(col, row));
      if (!cell) {
        throw new Error(`${seed.id}: missing source cell ${col},${row}`);
      }
      cells.push(cell);
    }
  }
  return cells.sort(rowMajor);
}

function buildRoleMap<Role extends string>(
  counts: Map<string, number>,
  roles: readonly Role[],
  overflowRole: Role,
  patchId: string,
  label: string,
): Record<string, Role> {
  const ordered = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const map: Record<string, Role> = {};
  ordered.forEach(([fill], index) => {
    if (index >= roles.length) {
      console.warn(`gen-patches: WARN ${patchId}: ${label} ${fill} exceeds ${roles.length} roles; mapping to ${overflowRole}`);
    }
    map[fill] = roles[index] ?? overflowRole;
  });
  return map;
}

function countRoles(cells: CellRecon[], seed: SeedPatch): {
  inkRoles: Record<string, InkRole>;
  groundRoles: Record<string, GroundRole>;
} {
  const inkCounts = new Map<string, number>();
  const groundCounts = new Map<string, number>();
  for (const cell of cells) {
    groundCounts.set(cell.ground, (groundCounts.get(cell.ground) ?? 0) + 1);
    if (cell.kind === 'tile' && cell.ink) {
      inkCounts.set(cell.ink, (inkCounts.get(cell.ink) ?? 0) + 1);
    }
  }
  return {
    inkRoles: buildRoleMap(inkCounts, ['ink', 'accent', 'ink2'] as const, 'ink', seed.id, 'ink'),
    groundRoles: buildRoleMap(groundCounts, ['g0', 'g1', 'g2'] as const, 'g2', seed.id, 'ground'),
  };
}

function extractPatch(seed: SeedPatch, banner: BannerRecon): { patch: IconicPatch; note: ExtractionNote } {
  const sourceCells = cropCells(banner, seed);
  const { inkRoles, groundRoles } = countRoles(sourceCells, seed);
  let skippedFreeform = 0;
  const cells: PatchCell[] = [];

  for (const cell of sourceCells) {
    if (cell.kind === 'freeform' || cell.kind === 'review') {
      console.warn(`gen-patches: WARN ${seed.id}: skipping ${cell.kind} cell ${cell.col},${cell.row}`);
      skippedFreeform += 1;
      continue;
    }

    const groundRole = groundRoles[cell.ground] ?? 'g0';
    const patchCell: PatchCell = {
      dx: cell.col - seed.x,
      dy: cell.row - seed.y,
      kind: cell.kind === 'tile' ? 'tile' : 'plain',
      groundRole,
    };

    if (cell.kind === 'tile') {
      if (!cell.tile) {
        throw new Error(`${seed.id}: tile cell ${cell.col},${cell.row} has no tile id`);
      }
      patchCell.tile = cell.tile;
      patchCell.rotation = cell.rotation ?? 0;
      patchCell.flip = cell.flip ?? false;
      if (cell.ink) {
        patchCell.inkRole = inkRoles[cell.ink] ?? 'ink';
      }
    }

    cells.push(patchCell);
  }

  const patch: IconicPatch = {
    id: seed.id,
    source: patchSource(seed),
    w: seed.w,
    h: seed.h,
    cells,
  };
  return {
    patch,
    note: {
      id: seed.id,
      source: patch.source,
      inkRoles,
      groundRoles,
      skippedFreeform,
      cells: cells.length,
    },
  };
}

async function drawPatchSheet(patches: IconicPatch[]): Promise<void> {
  const rows = Math.max(1, Math.ceil(patches.length / SHEET_COLS));
  const canvas = createCanvas(SHEET_COLS * SHEET_CARD_W, rows * SHEET_CARD_H);
  const ctx = canvas.getContext('2d');
  const manifest = loadMergedManifest();

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'top';

  for (let index = 0; index < patches.length; index += 1) {
    const patch = patches[index]!;
    const cardX = (index % SHEET_COLS) * SHEET_CARD_W;
    const cardY = Math.floor(index / SHEET_COLS) * SHEET_CARD_H;
    const gridW = patch.w * SHEET_CELL;
    const gridH = patch.h * SHEET_CELL;
    const gridX = cardX + Math.floor((SHEET_CARD_W - gridW) / 2);
    const gridY = cardY + 18;

    ctx.fillStyle = '#F8F8F8';
    ctx.fillRect(cardX + 8, cardY + 8, SHEET_CARD_W - 16, SHEET_CARD_H - 16);
    ctx.strokeStyle = '#D9D9D6';
    ctx.strokeRect(cardX + 8.5, cardY + 8.5, SHEET_CARD_W - 17, SHEET_CARD_H - 17);

    for (const cell of patch.cells) {
      const x = gridX + cell.dx * SHEET_CELL;
      const y = gridY + cell.dy * SHEET_CELL;
      const ground = ROLE_DEFAULTS[cell.groundRole];
      ctx.fillStyle = ground;
      ctx.fillRect(x, y, SHEET_CELL, SHEET_CELL);
      if (cell.kind === 'tile' && cell.tile) {
        const ink = cell.inkRole ? ROLE_DEFAULTS[cell.inkRole] : ROLE_DEFAULTS.ink;
        const img = await recoloredTile(cell.tile, ink, ground, manifest);
        ctx.save();
        ctx.translate(x + SHEET_CELL / 2, y + SHEET_CELL / 2);
        ctx.rotate(((cell.rotation ?? 0) * Math.PI) / 180);
        if (cell.flip) ctx.scale(-1, 1);
        ctx.drawImage(img, -SHEET_CELL / 2, -SHEET_CELL / 2, SHEET_CELL, SHEET_CELL);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(18,18,18,0.18)';
      ctx.strokeRect(x + 0.5, y + 0.5, SHEET_CELL - 1, SHEET_CELL - 1);
    }

    const labelY = gridY + gridH + 12;
    ctx.fillStyle = '#121212';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(patch.id, cardX + 16, labelY);
    ctx.font = '11px sans-serif';
    ctx.fillText(`${patch.source}  ${patch.w}x${patch.h}`, cardX + 16, labelY + 17);
  }

  mkdirSync(dirname(SHEET_FILE), { recursive: true });
  writeFileSync(SHEET_FILE, canvas.toBuffer('image/png'));
}

function serializeValue(value: unknown, indent = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = '  '.repeat(indent + 1);
    const items = value.map(item => `${pad}${serializeValue(item, indent + 1)}`).join(',\n');
    return `[\n${items},\n${'  '.repeat(indent)}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, val]) => val !== undefined);
    if (entries.length === 0) return '{}';
    const pad = '  '.repeat(indent + 1);
    const props = entries.map(([key, val]) => {
      const prop = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
      return `${pad}${prop}: ${serializeValue(val, indent + 1)}`;
    }).join(',\n');
    return `{\n${props},\n${'  '.repeat(indent)}}`;
  }

  return JSON.stringify(value);
}

function writeDataModule(sourceHash: string, patches: IconicPatch[]): number {
  const header = [
    '// GENERATED by gen:patches - do not edit',
    `// source-hash: ${sourceHash}`,
    '',
    '/* eslint-disable */',
    '',
    '// ---- Inline type declarations ----',
    '',
    "export type PatchKind = 'tile' | 'plain';",
    "export type PatchInkRole = 'ink' | 'accent' | 'ink2';",
    "export type PatchGroundRole = 'g0' | 'g1' | 'g2';",
    'export interface SeedPatch { id: string; banner: string; x: number; y: number; w: number; h: number; }',
    'export interface PatchCell {',
    '  dx: number;',
    '  dy: number;',
    "  kind: 'tile' | 'plain';",
    '  tile?: string;',
    '  rotation?: 0 | 90 | 180 | 270;',
    '  flip?: boolean;',
    "  inkRole?: 'ink' | 'accent' | 'ink2';",
    "  groundRole: 'g0' | 'g1' | 'g2';",
    '}',
    'export interface IconicPatch { id: string; source: string; w: number; h: number; cells: PatchCell[] }',
    '',
    '// ---- Data ----',
    '',
  ].join('\n');

  const body = [
    `export const SEED_PATCHES: SeedPatch[] = ${serializeValue(SEED_PATCHES)};`,
    '',
    `export const PATCHES: IconicPatch[] = ${serializeValue(patches)};`,
    '',
  ].join('\n');
  const content = header + body;
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, content);
  return Buffer.byteLength(content);
}

async function main(): Promise<void> {
  const { include } = parseArgs(process.argv.slice(2));
  const corpusJson = readFileSync(CORPUS_PATH, 'utf8');
  const corpus = JSON.parse(corpusJson) as Corpus;
  const sourceHash = computeSourceHash(corpusJson);
  const bannerById = new Map(corpus.banners.map(banner => [banner.id, banner]));
  const selectedSeeds = SEED_PATCHES.filter(seed => include.has(seed.id));
  const unknown = [...include].filter(id => !SEED_PATCHES.some(seed => seed.id === id)).sort();
  if (unknown.length > 0) {
    throw new Error(`Unknown patch id(s): ${unknown.join(', ')}`);
  }

  const patches: IconicPatch[] = [];
  const notes: ExtractionNote[] = [];
  for (const seed of selectedSeeds) {
    const banner = bannerById.get(seed.banner);
    if (!banner) {
      throw new Error(`${seed.id}: banner ${seed.banner} not found in corpus.json`);
    }
    const { patch, note } = extractPatch(seed, banner);
    patches.push(patch);
    notes.push(note);
  }

  const sizeBytes = writeDataModule(sourceHash, patches);
  if (sizeBytes > DATA_BUDGET_BYTES) {
    console.warn(`gen-patches: WARN patches.ts ${(sizeBytes / 1024).toFixed(1)} KB exceeds ${(DATA_BUDGET_BYTES / 1024).toFixed(0)} KB budget`);
  }
  await drawPatchSheet(patches);

  console.log(`gen-patches: wrote patches.ts (${(sizeBytes / 1024).toFixed(1)} KB)`);
  console.log(`gen-patches: wrote ${SHEET_FILE}`);
  console.log(`gen-patches: source-hash ${sourceHash}`);
  for (const note of notes) {
    const inks = Object.entries(note.inkRoles).map(([fill, role]) => `${fill}->${role}`).join(', ') || '(none)';
    const grounds = Object.entries(note.groundRoles).map(([fill, role]) => `${fill}->${role}`).join(', ') || '(none)';
    console.log(`gen-patches: ${note.id} ${note.source}: cells=${note.cells}, skippedFreeform=${note.skippedFreeform}, inks=[${inks}], grounds=[${grounds}]`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
