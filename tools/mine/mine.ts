/**
 * mine.ts — Mining CLI
 *
 * Usage:
 *   node dist-tools/mine.mjs            # full run → corpus/corpus.json
 *   node dist-tools/mine.mjs --banner NNN  # debug mode → corpus/corpus.partial.json
 *
 * Orchestrates: parseSvgElements → segmentCells → rasterizeMask → matchCell → CellRecon
 * Builds the tile-mask library once, reuses across all banners.
 * Applies corpus/overrides.json (shallow field-wise override onto mined CellRecon — whole-field replacement, override wins).
 * Output is deterministic: two runs differ only in minedAt.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSvgElements } from './svg.js';
import { segmentCells } from './cells.js';
import { rasterizeMask } from './raster.js';
import { buildTileMaskLibrary, matchCell } from './tile-match.js';
import { resolveCssClasses, resolveTransforms } from './preprocess.js';
import {
  SCHEMA_VERSION,
  type BannerRecon,
  type CellRecon,
  type Corpus,
} from './schema.js';
import { detectForms, type ManifestTile } from './forms.js';

// ---------------------------------------------------------------------------
// Background rect injector
// Some banners exported from Figma/Illustrator omit the full-canvas background rect,
// relying on per-cell ground rects or the SVG default (white). segmentCells requires
// elements[0] to be a rect covering the full canvas. If missing, we inject one.
// Default color: #FFFFFF (SVG viewer default / white paper).
// ---------------------------------------------------------------------------

function ensureBackgroundRect(svgText: string, width = 1920, height = 960): string {
  // Find the position right after the opening <svg ...> tag (not the <?xml?> declaration)
  const svgOpenStart = svgText.indexOf('<svg');
  if (svgOpenStart === -1) return svgText;
  const svgTagEnd = svgText.indexOf('>', svgOpenStart);
  if (svgTagEnd === -1) return svgText;

  // Check if the first shape element is a full-canvas rect
  // We look for the first <rect> or <path> or <circle> or <ellipse> in the content
  const afterTag = svgText.slice(svgTagEnd + 1);
  // Strip leading whitespace/comments/defs/style to find the first shape
  const strippedContent = afterTag
    .replace(/<!--[\s\S]*?-->/g, '')   // strip comments
    .replace(/<defs[\s\S]*?<\/defs>/gi, '') // strip defs
    .trimStart();

  const firstShapeMatch = strippedContent.match(/^<(rect|path|circle|ellipse)\s([^>]*?)\/>/);
  if (firstShapeMatch && firstShapeMatch[1] === 'rect') {
    const attrs = firstShapeMatch[2]!;
    // Check if it's a full-canvas rect
    const xMatch = attrs.match(/\bx="([^"]*)"/);
    const yMatch = attrs.match(/\by="([^"]*)"/);
    const wMatch = attrs.match(/\bwidth="([^"]*)"/);
    const hMatch = attrs.match(/\bheight="([^"]*)"/);
    const x = xMatch ? parseFloat(xMatch[1]!) : 0;
    const y = yMatch ? parseFloat(yMatch[1]!) : 0;
    const w = wMatch ? parseFloat(wMatch[1]!) : 0;
    const h = hMatch ? parseFloat(hMatch[1]!) : 0;
    if (x === 0 && y === 0 && w === width && h === height) {
      return svgText; // Already has full-canvas rect as first shape
    }
  }

  // Inject background rect immediately after the <svg ...> tag
  const bgRect = `<rect x="0" y="0" width="${width}" height="${height}" fill="#FFFFFF"/>`;
  return svgText.slice(0, svgTagEnd + 1) + '\n  ' + bgRect + svgText.slice(svgTagEnd + 1);
}

// ---------------------------------------------------------------------------
// Paths (relative to project root, which is cwd when the script runs)
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve('.');
const BANNERS_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'banners');
const TILES_DIR = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles');
const MANIFEST_PATH = join(PROJECT_ROOT, 'corpus', 'reference', 'tiles-manifest.json');
const OVERRIDES_PATH = join(PROJECT_ROOT, 'corpus', 'overrides.json');
const CORPUS_PATH = join(PROJECT_ROOT, 'corpus', 'corpus.json');
const CORPUS_PARTIAL_PATH = join(PROJECT_ROOT, 'corpus', 'corpus.partial.json');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const bannerFlagIdx = args.indexOf('--banner');
const singleBanner: string | null =
  bannerFlagIdx >= 0 && args[bannerFlagIdx + 1] ? args[bannerFlagIdx + 1]! : null;

// ---------------------------------------------------------------------------
// Overrides loading
// ---------------------------------------------------------------------------

type OverridesMap = Record<string, Record<string, Partial<CellRecon>>>;

function loadOverrides(): OverridesMap {
  if (!existsSync(OVERRIDES_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) as OverridesMap;
  } catch (err) {
    console.warn(`[mine] Warning: failed to parse overrides.json: ${err}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Banner file enumeration
// ---------------------------------------------------------------------------

function listBannerFiles(): string[] {
  const files = readdirSync(BANNERS_DIR)
    .filter((f) => /^\d+\.svg$/.test(f))
    .sort(); // deterministic alphabetical = numeric order since zero-padded
  return files;
}

// ---------------------------------------------------------------------------
// Per-banner processing
// ---------------------------------------------------------------------------

async function processBanner(
  bannerId: string,
  svgPath: string,
  library: Awaited<ReturnType<typeof buildTileMaskLibrary>>,
  overrides: OverridesMap,
  manifestTiles: ManifestTile[],
): Promise<BannerRecon> {
  const rawSvg = readFileSync(svgPath, 'utf8');
  const svgText = resolveTransforms(resolveCssClasses(ensureBackgroundRect(rawSvg)));
  const parsed = parseSvgElements(svgText);
  const { ground, cells } = segmentCells(parsed);

  const bannerOverrides = overrides[bannerId] ?? {};

  const cellRecons: CellRecon[] = [];
  for (const cell of cells) {
    // Rasterize foreground mask for this cell
    const viewport = {
      x: cell.col * 320,
      y: cell.row * 320,
      w: 320,
      h: 320,
    };
    const cellMask = await rasterizeMask(
      cell.foreground,
      viewport,
      64,
      (el) => el.fill !== cell.ground,
    );

    const match = matchCell(cellMask, library);

    // Build CellRecon from match (store rotation/flip verbatim)
    let recon: CellRecon = {
      col: cell.col,
      row: cell.row,
      ground: cell.ground,
      kind: match.kind,
      ink: cell.inks[0],
      inks: cell.inks,
      candidates: match.candidates,
    };

    if (match.kind === 'tile') {
      recon.tile = match.tile;
      recon.rotation = match.rotation;
      recon.flip = match.flip;
      recon.score = match.score;
    } else if (match.kind === 'review') {
      // For review cells, carry tile/rotation/flip/score as best candidate info
      recon.tile = match.tile;
      recon.rotation = match.rotation;
      recon.flip = match.flip;
      recon.score = match.score;
    }

    // Apply overrides (field-by-field, override wins)
    const key = `${cell.col},${cell.row}`;
    const cellOverride = bannerOverrides[key];
    if (cellOverride) {
      recon = { ...recon, ...cellOverride };
    }

    cellRecons.push(recon);
  }

  // matchRate = tileCells / (18 − plainCells), 4 decimal places
  const tileCells = cellRecons.filter((c) => c.kind === 'tile').length;
  const plainCells = cellRecons.filter((c) => c.kind === 'plain').length;
  const denominator = 18 - plainCells;
  const matchRate = denominator > 0 ? Number((tileCells / denominator).toFixed(4)) : 0;

  const banner: BannerRecon = {
    id: bannerId,
    width: 1920,
    height: 960,
    cols: 6,
    rows: 3,
    ground,
    cells: cellRecons,
    forms: [],
    matchRate,
  };

  banner.forms = detectForms(banner, manifestTiles);

  return banner;
}

// ---------------------------------------------------------------------------
// Stats printing
// ---------------------------------------------------------------------------

interface TileUsage {
  tile: string;
  count: number;
}

function printStats(
  banners: BannerRecon[],
  manifestPath: string,
): void {
  // Per-banner one-liner
  console.log('\n=== Per-banner stats ===');
  for (const b of banners) {
    const counts = { tile: 0, plain: 0, freeform: 0, review: 0 };
    for (const c of b.cells) {
      counts[c.kind]++;
    }
    console.log(
      `  ${b.id}  matchRate=${b.matchRate.toFixed(4)}  tile=${counts.tile}  plain=${counts.plain}  freeform=${counts.freeform}  review=${counts.review}`,
    );
  }

  // Totals by kind
  const totals = { tile: 0, plain: 0, freeform: 0, review: 0 };
  let totalCells = 0;
  for (const b of banners) {
    for (const c of b.cells) {
      totals[c.kind]++;
      totalCells++;
    }
  }
  console.log('\n=== Totals by kind ===');
  console.log(`  Total cells : ${totalCells}`);
  console.log(`  tile        : ${totals.tile} (${pct(totals.tile, totalCells)}%)`);
  console.log(`  plain       : ${totals.plain} (${pct(totals.plain, totalCells)}%)`);
  console.log(`  freeform    : ${totals.freeform} (${pct(totals.freeform, totalCells)}%)`);
  console.log(`  review      : ${totals.review} (${pct(totals.review, totalCells)}%)`);

  // Top-10 most-used tiles
  const tileUsageMap = new Map<string, number>();
  for (const b of banners) {
    for (const c of b.cells) {
      if (c.kind === 'tile' && c.tile) {
        tileUsageMap.set(c.tile, (tileUsageMap.get(c.tile) ?? 0) + 1);
      }
    }
  }
  const tileUsage: TileUsage[] = [...tileUsageMap.entries()]
    .map(([tile, count]) => ({ tile, count }))
    .sort((a, b) => b.count - a.count || a.tile.localeCompare(b.tile))
    .slice(0, 10);

  console.log('\n=== Top-10 most-used tiles ===');
  for (const { tile, count } of tileUsage) {
    console.log(`  ${tile}: ${count}`);
  }

  // Per-family counts (derive family from manifest by tile id)
  let manifest: { tiles?: { id: string; shape_family?: string }[] } | { id: string; shape_family?: string }[];
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    console.warn('[mine] Could not load manifest for family stats');
    return;
  }

  const tilesArr = Array.isArray(manifest)
    ? (manifest as { id: string; shape_family?: string }[])
    : ((manifest as { tiles?: { id: string; shape_family?: string }[] }).tiles ?? []);

  const familyByTile = new Map<string, string>();
  for (const t of tilesArr) {
    if (t.shape_family) {
      familyByTile.set(t.id, t.shape_family);
    }
  }

  const familyCounts = new Map<string, number>();
  for (const b of banners) {
    for (const c of b.cells) {
      if (c.kind === 'tile' && c.tile) {
        const fam = familyByTile.get(c.tile) ?? 'unknown';
        familyCounts.set(fam, (familyCounts.get(fam) ?? 0) + 1);
      }
    }
  }

  console.log('\n=== Per-family tile counts ===');
  for (const [fam, count] of [...familyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fam}: ${count}`);
  }

  // Forms stats
  const totalForms = banners.reduce((s, b) => s + b.forms.length, 0);
  const avgForms = banners.length > 0 ? (totalForms / banners.length).toFixed(2) : '0.00';
  const formsByKind = { run: 0, figure: 0, frieze: 0 };
  for (const b of banners) {
    for (const f of b.forms) {
      formsByKind[f.kind]++;
    }
  }
  console.log('\n=== Forms stats ===');
  console.log(`  Total forms : ${totalForms}  avg/banner=${avgForms}`);
  console.log(`  run         : ${formsByKind.run}`);
  console.log(`  frieze      : ${formsByKind.frieze}`);
  console.log(`  figure      : ${formsByKind.figure}`);
}

function pct(n: number, total: number): string {
  return total === 0 ? '0.0' : ((n / total) * 100).toFixed(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const minedAt = new Date().toISOString();

  console.log('[mine] Building tile-mask library...');
  const library = await buildTileMaskLibrary(TILES_DIR, MANIFEST_PATH);
  console.log(`[mine] Library built: ${library.length} variants`);

  // Load manifest tiles for detectForms
  let manifestTiles: ManifestTile[] = [];
  try {
    const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as
      | ManifestTile[]
      | { tiles?: ManifestTile[] };
    manifestTiles = Array.isArray(raw) ? raw : (raw.tiles ?? []);
  } catch (err) {
    console.warn('[mine] Warning: failed to load manifest tiles for form detection:', err);
  }

  const overrides = loadOverrides();

  // Enumerate banners
  let bannerFiles = listBannerFiles();
  if (singleBanner) {
    const target = `${singleBanner.padStart(3, '0')}.svg`;
    if (!bannerFiles.includes(target)) {
      console.error(`[mine] --banner ${singleBanner}: file not found in ${BANNERS_DIR}`);
      process.exit(1);
    }
    bannerFiles = [target];
    console.log(`[mine] DEBUG MODE: processing only banner ${singleBanner}`);
    console.log(`[mine] WARNING: output will be written to corpus.partial.json — do NOT commit this as corpus.json`);
  }

  console.log(`[mine] Processing ${bannerFiles.length} banner(s)...`);

  const banners: BannerRecon[] = [];
  for (const file of bannerFiles) {
    const bannerId = file.replace(/\.svg$/, '');
    process.stdout.write(`[mine]   ${bannerId}...`);
    const svgPath = join(BANNERS_DIR, file);
    const recon = await processBanner(bannerId, svgPath, library, overrides, manifestTiles);
    banners.push(recon);
    console.log(` matchRate=${recon.matchRate.toFixed(4)}`);
  }

  // Banners are already sorted (we sorted bannerFiles alphabetically)
  const corpus: Corpus = {
    schemaVersion: SCHEMA_VERSION,
    minedAt,
    banners,
  };

  const outPath = singleBanner ? CORPUS_PARTIAL_PATH : CORPUS_PATH;
  writeFileSync(outPath, JSON.stringify(corpus, null, 2) + '\n', 'utf8');

  if (singleBanner) {
    console.log(`\n[mine] Wrote ${outPath} (PARTIAL — single-banner debug run, do NOT commit as corpus.json)`);
  } else {
    console.log(`\n[mine] Wrote ${outPath}`);
    printStats(banners, MANIFEST_PATH);
  }
}

main().catch((err) => {
  console.error('[mine] Fatal error:', err);
  process.exit(1);
});
