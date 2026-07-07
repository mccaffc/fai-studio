/**
 * gen-engine-data.ts — Generates src/engine/corpus/data/grammar.ts and tiles.ts
 * from corpus/grammar.json + the tile SVG files.
 *
 * Run via: npm run gen:engine-data
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseSvgElements, type SvgElement } from '../mine/svg.js';
import { resolveCssClasses, resolveTransforms } from '../mine/preprocess.js';
import { loadMergedManifest } from '../mine/render-recon.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const GRAMMAR_PATH = join(ROOT, 'corpus', 'grammar.json');
const OUT_DIR = join(ROOT, 'src', 'engine', 'corpus', 'data');
const OUT_GRAMMAR = join(OUT_DIR, 'grammar.ts');
const OUT_TILES = join(OUT_DIR, 'tiles.ts');

// ---------------------------------------------------------------------------
// Raw Grammar types (as stored in corpus/grammar.json)
// ---------------------------------------------------------------------------

interface RawGrammar {
  schemaVersion: number;
  builtAt: string;
  stats: {
    schemaVersion: number;
    families: Record<string, number>;
    tiles: Record<string, number>;
    tileRotations: Record<string, Record<string, number>>;
    tileFlipShare: Record<string, number>;
    adjacency: { horizontal: Record<string, Record<string, number>>; vertical: Record<string, Record<string, number>> };
    inkByGround: Record<string, Record<string, number>>;
    globalGrounds: Record<string, number>;
    groundSchemes: { perBanner: unknown; counts: Record<string, number> };
    forms: {
      kinds: Record<string, number>;
      sizes: Record<string, number>;
      byFamily: Record<string, number>;
      friezeRows: Record<string, number>;
    };
    plain: {
      perBannerHistogram: Record<string, number>;
      byRow: [number, number, number];
      positions: Record<string, number>;
    };
    economy: unknown;
  };
  templates: unknown[];
  tileCatalog: Record<string, {
    family: string;
    edges: { top: number; right: number; bottom: number; left: number };
    rotations: Record<string, number>;
    flipShare: number;
    profiles?: unknown;
    programOnly?: boolean;
  }>;
  palette: {
    globalGrounds: Record<string, number>;
    inkByGround: Record<string, Record<string, number>>;
    accentOrder: string[];
  };
}

// ---------------------------------------------------------------------------
// Source-hash computation
// ---------------------------------------------------------------------------

function computeSourceHash(grammarJson: string, manifest: Map<string, { filename: string; baseDir: string }>): string {
  const hash = createHash('sha256');
  hash.update(grammarJson);

  // Sort tile IDs for determinism
  const sortedIds = [...manifest.keys()].sort();
  for (const id of sortedIds) {
    const entry = manifest.get(id)!;
    try {
      const svg = readFileSync(join(entry.baseDir, entry.filename), 'utf8');
      hash.update(id);
      hash.update(svg);
    } catch {
      // skip missing files gracefully
    }
  }
  return hash.digest('hex');
}

// ---------------------------------------------------------------------------
// Background detection (mirrors render-recon.ts recoloredTile logic exactly)
// ---------------------------------------------------------------------------

function tileBackgroundIndex(elements: SvgElement[], hasBackgroundRect: boolean): number {
  const first = elements[0];
  const isFullTileRect =
    first != null &&
    first.kind === 'rect' &&
    (first.x ?? 0) === 0 &&
    (first.y ?? 0) === 0 &&
    first.w === 200 &&
    first.h === 200;
  if (hasBackgroundRect || isFullTileRect) return 0;
  return -1;
}

// ---------------------------------------------------------------------------
// Engine types (mirrored in the generated file headers)
// ---------------------------------------------------------------------------

interface TileElement {
  kind: 'rect' | 'circle' | 'ellipse' | 'path';
  role: 'fg' | 'cutout';
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

interface EngineTile {
  family: string;
  dominantDirection?: string;
  background: boolean;
  elements: TileElement[];
}

// ---------------------------------------------------------------------------
// Parse a tile SVG into EngineTile
// ---------------------------------------------------------------------------

function parseTile(tileId: string, manifest: Map<string, { filename: string; baseDir: string; has_background_rect?: boolean; dominant_direction?: string; shape_family: string }>): EngineTile {
  const entry = manifest.get(tileId);
  if (!entry) throw new Error(`Tile ${tileId} not found in manifest`);

  const raw = readFileSync(join(entry.baseDir, entry.filename), 'utf8');
  const preprocessed = resolveTransforms(resolveCssClasses(raw));
  const parsed = parseSvgElements(preprocessed);

  const bgIdx = tileBackgroundIndex(parsed.elements, entry.has_background_rect === true);
  const background = bgIdx >= 0;
  const bgFill = background ? parsed.elements[bgIdx]!.fill : undefined;

  const elements: TileElement[] = [];

  for (let i = 0; i < parsed.elements.length; i++) {
    const el = parsed.elements[i]!;

    // Skip the background element and fill:'none' elements
    if (i === bgIdx || el.fill === 'none') continue;

    // Classify: cutout = same fill as background, fg = everything else
    const role: 'fg' | 'cutout' = el.fill === bgFill ? 'cutout' : 'fg';

    // Build TileElement — only include geometry fields relevant to each kind
    const te: TileElement = { kind: el.kind, role };

    if (el.kind === 'rect') {
      te.x = el.x; te.y = el.y; te.w = el.w; te.h = el.h;
    } else if (el.kind === 'circle') {
      te.cx = el.cx; te.cy = el.cy; te.r = el.r;
    } else if (el.kind === 'ellipse') {
      te.cx = el.cx; te.cy = el.cy; te.rx = el.rx; te.ry = el.ry;
    } else if (el.kind === 'path') {
      te.d = el.d;
      if (el.fillRule) te.fillRule = el.fillRule;
    }

    elements.push(te);
  }

  const result: EngineTile = {
    family: entry.shape_family,
    background,
    elements,
  };
  if (entry.dominant_direction) result.dominantDirection = entry.dominant_direction;
  return result;
}

// ---------------------------------------------------------------------------
// TS serialization helpers
// ---------------------------------------------------------------------------

function serializeValue(v: unknown, indent = 0): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);

  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const pad = '  '.repeat(indent + 1);
    const items = v.map(item => `${pad}${serializeValue(item, indent + 1)}`).join(',\n');
    return `[\n${items},\n${'  '.repeat(indent)}]`;
  }

  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const pad = '  '.repeat(indent + 1);
    const props = entries.map(([k, val]) => {
      // Use quoted keys if they contain special characters (e.g. '#', '-', ',', '/')
      const key = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
      return `${pad}${key}: ${serializeValue(val, indent + 1)}`;
    }).join(',\n');
    return `{\n${props},\n${'  '.repeat(indent)}}`;
  }

  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log('gen-engine-data: reading corpus/grammar.json...');
  const grammarJson = readFileSync(GRAMMAR_PATH, 'utf8');
  const raw: RawGrammar = JSON.parse(grammarJson);

  console.log('gen-engine-data: loading tile manifests...');
  const manifest = loadMergedManifest();

  console.log('gen-engine-data: computing source hash...');
  const sourceHash = computeSourceHash(grammarJson, manifest);

  // ---- Build trimmed EngineGrammar ----
  // Drop: builtAt (top-level), stats.economy, stats.groundSchemes.perBanner
  const engineGrammar = {
    schemaVersion: raw.schemaVersion,
    stats: {
      schemaVersion: raw.stats.schemaVersion,
      families: raw.stats.families,
      tiles: raw.stats.tiles,
      tileRotations: raw.stats.tileRotations,
      tileFlipShare: raw.stats.tileFlipShare,
      adjacency: raw.stats.adjacency,
      inkByGround: raw.stats.inkByGround,
      globalGrounds: raw.stats.globalGrounds,
      groundSchemes: {
        counts: raw.stats.groundSchemes.counts,
      },
      forms: {
        kinds: raw.stats.forms.kinds,
        sizes: raw.stats.forms.sizes,
        byFamily: raw.stats.forms.byFamily,
        friezeRows: raw.stats.forms.friezeRows,
      },
      plain: {
        positions: raw.stats.plain.positions,
      },
    },
    templates: raw.templates,
    tileCatalog: raw.tileCatalog,
    palette: raw.palette,
  };

  // ---- Build TILES ----
  console.log(`gen-engine-data: parsing ${Object.keys(raw.tileCatalog).length} tiles...`);
  const tiles: Record<string, EngineTile> = {};
  let parseErrors = 0;
  for (const tileId of Object.keys(raw.tileCatalog).sort()) {
    try {
      tiles[tileId] = parseTile(tileId, manifest as Map<string, { filename: string; baseDir: string; has_background_rect?: boolean; dominant_direction?: string; shape_family: string }>);
    } catch (err) {
      console.error(`  WARN: skipping ${tileId}: ${(err as Error).message}`);
      parseErrors++;
    }
  }
  if (parseErrors > 0) {
    console.error(`gen-engine-data: ${parseErrors} tiles had parse errors — aborting so the committed data can't go stale`);
    process.exit(1);
  }

  // ---- Write grammar.ts ----
  mkdirSync(OUT_DIR, { recursive: true });

  const grammarHeader = [
    '// GENERATED by gen:engine-data — do not edit',
    `// source-hash: ${sourceHash}`,
    '',
    '/* eslint-disable */',
    '',
    '// ---- Inline type declarations ----',
    '',
    'export interface EngineGroundSchemes { counts: Record<string, number>; }',
    'export interface EngineForms { kinds: Record<string, number>; sizes: Record<string, number>; byFamily: Record<string, number>; friezeRows: Record<string, number>; }',
    'export interface EnginePlain { positions: Record<string, number>; }',
    'export interface EngineStats {',
    '  schemaVersion: number;',
    '  families: Record<string, number>;',
    '  tiles: Record<string, number>;',
    '  tileRotations: Record<string, Record<string, number>>;',
    '  tileFlipShare: Record<string, number>;',
    '  adjacency: { horizontal: Record<string, Record<string, number>>; vertical: Record<string, Record<string, number>>; };',
    '  inkByGround: Record<string, Record<string, number>>;',
    '  globalGrounds: Record<string, number>;',
    '  groundSchemes: EngineGroundSchemes;',
    '  forms: EngineForms;',
    '  plain: EnginePlain;',
    '}',
    'export interface EdgeProfileSet { top: string; right: string; bottom: string; left: string; }',
    "export type VariantKey = `${0 | 90 | 180 | 270}/${'f' | '-'}`;",
    'export type TileEdgeProfiles = Record<VariantKey, EdgeProfileSet>;',
    'export interface TileCatalogEntry { family: string; edges: { top: number; right: number; bottom: number; left: number }; rotations: Record<string, number>; flipShare: number; profiles?: TileEdgeProfiles; programOnly?: boolean; }',
    "export type GroundSchemeKind = 'uniform' | 'checker' | 'banded-rows' | 'banded-cols' | 'zoned' | 'scatter';",
    'export interface TemplateSpec {',
    '  groundSchemes: GroundSchemeKind[];',
    '  dominantFamilies: string[];',
    '  distinctTiles: [number, number];',
    '  forms: { run: [number, number]; frieze: [number, number]; figure: [number, number] };',
    '  figureShare: [number, number];',
    '  plainShare: [number, number];',
    '  lineworkShare: [number, number];',
    '}',
    'export interface Template { id: string; name: string; bannerIds: string[]; spec: TemplateSpec; }',
    'export interface EngineGrammar {',
    '  schemaVersion: number;',
    '  stats: EngineStats;',
    '  templates: Template[];',
    '  tileCatalog: Record<string, TileCatalogEntry>;',
    '  palette: { globalGrounds: Record<string, number>; inkByGround: Record<string, Record<string, number>>; accentOrder: string[]; };',
    '}',
    '',
    '// ---- Data ----',
    '',
  ].join('\n');

  const grammarBody = `export const GRAMMAR: EngineGrammar = ${serializeValue(engineGrammar)};\n`;
  writeFileSync(OUT_GRAMMAR, grammarHeader + grammarBody);
  const grammarSize = Buffer.byteLength(grammarHeader + grammarBody);

  // ---- Write tiles.ts ----
  const tilesHeader = [
    '// GENERATED by gen:engine-data — do not edit',
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
    'export interface EngineTile {',
    '  family: string;',
    '  dominantDirection?: string;',
    '  background: boolean;',
    '  elements: TileElement[];',
    '}',
    '',
    '// ---- Data ----',
    '',
  ].join('\n');

  const tilesBody = `export const TILES: Record<string, EngineTile> = ${serializeValue(tiles)};\n`;
  writeFileSync(OUT_TILES, tilesHeader + tilesBody);
  const tilesSize = Buffer.byteLength(tilesHeader + tilesBody);

  console.log(`gen-engine-data: wrote grammar.ts (${(grammarSize / 1024).toFixed(1)} KB)`);
  console.log(`gen-engine-data: wrote tiles.ts (${(tilesSize / 1024).toFixed(1)} KB)`);
  console.log(`gen-engine-data: source-hash ${sourceHash}`);
  console.log(`gen-engine-data: done. ${Object.keys(tiles).length} tiles, ${(raw.templates as unknown[]).length} templates`);
}

main();
