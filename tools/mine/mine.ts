/**
 * mine.ts — Mining CLI
 *
 * Usage:
 *   node dist-tools/mine.mjs            # full run → corpus/corpus.json
 *   node dist-tools/mine.mjs --banner NNN  # debug mode → corpus/corpus.partial.json
 *
 * Orchestrates: parseSvgElements → segmentCells → rasterizeMask → matchCell → CellRecon
 * Builds the tile-mask library once, reuses across all banners.
 * Applies corpus/overrides.json (deep-merge onto mined CellRecon, override wins field-by-field).
 * Output is deterministic: two runs differ only in minedAt.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSvgElements } from './svg.js';
import { segmentCells } from './cells.js';
import { rasterizeMask } from './raster.js';
import { buildTileMaskLibrary, matchCell } from './tile-match.js';
import {
  SCHEMA_VERSION,
  type BannerRecon,
  type CellRecon,
  type Corpus,
} from './schema.js';

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
// CSS class resolver
// Some banners (exported from Adobe Illustrator) use CSS class-based fill declarations
// instead of inline fill attributes. We extract the class→fill mapping from the <style>
// block and inline them as fill/fill-rule attributes on the shape elements.
// ---------------------------------------------------------------------------

function resolveCssClasses(svgText: string): string {
  // Extract <style> block
  const styleMatch = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return svgText;

  const styleText = styleMatch[1]!;

  // Parse CSS class rules: .className { fill: #xxx; fill-rule: yyy; }
  // Also handles multi-selector rules like .st0, .st1 { fill: #xxx; }
  const classFills = new Map<string, string>();       // className → fill hex
  const classFillRules = new Map<string, string>();   // className → fill-rule

  // Match CSS rules: selector { declarations }
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let ruleMatch: RegExpExecArray | null;
  while ((ruleMatch = ruleRe.exec(styleText)) !== null) {
    const selector = ruleMatch[1]!.trim();
    const declarations = ruleMatch[2]!;

    // Extract fill value from declarations
    const fillMatch = declarations.match(/\bfill\s*:\s*([^;]+)/);
    const fillRuleMatch = declarations.match(/\bfill-rule\s*:\s*([^;]+)/);

    // Split multi-selector (e.g. ".st0, .st1")
    for (const part of selector.split(',')) {
      const className = part.trim().replace(/^\./, '');
      if (!className) continue;
      if (fillMatch) {
        classFills.set(className, fillMatch[1]!.trim());
      }
      if (fillRuleMatch) {
        classFillRules.set(className, fillRuleMatch[1]!.trim());
      }
    }
  }

  if (classFills.size === 0 && classFillRules.size === 0) return svgText;

  // Replace class="..." attributes on shape elements with inline fill/fill-rule
  return svgText.replace(
    /<(rect|path|circle|ellipse)([^>]*?)class="([^"]*)"([^>]*?)\/>/g,
    (_match, tag: string, before: string, classAttr: string, after: string) => {
      // Collect all classes; last fill/fill-rule wins (CSS cascade)
      let fill: string | undefined;
      let fillRule: string | undefined;
      for (const cls of classAttr.split(/\s+/)) {
        if (classFills.has(cls)) fill = classFills.get(cls);
        if (classFillRules.has(cls)) fillRule = classFillRules.get(cls);
      }
      let extras = '';
      if (fill !== undefined) extras += ` fill="${fill}"`;
      if (fillRule !== undefined) extras += ` fill-rule="${fillRule}"`;
      // Remove class attribute; inject fill/fill-rule before the closing />
      return `<${tag}${before}${after}${extras}/>`;
    },
  );
}

// ---------------------------------------------------------------------------
// SVG transform resolver
// Banners contain circle/ellipse elements with simple transforms (rotate, matrix)
// that parseSvgElements rejects. We resolve them analytically before parsing.
// Supported:
//   rotate(angle cx cy) on <circle>  → no-op (circles are rotationally symmetric), strip transform
//   rotate(angle cx cy) on <ellipse> → if rx===ry, strip; if ±90/±270 & different rx/ry, swap rx/ry
//   rotate(180/0) on <ellipse>       → strip (no visual change for rx/ry)
//   matrix(-1 0 0 1 tx ty) on <ellipse> → horizontal flip at center; reposition cx = tx - cx; strip
//   matrix(1 ~0 ~0 -1 tx ty) on <ellipse> → vertical flip; cy = ty - cy; strip
//   matrix(-1 ~0 ~0 1 tx ty) on <ellipse> → horizontal flip; cx = tx - cx; strip
// Any transform that doesn't match is left in place and will cause a parse error.
// ---------------------------------------------------------------------------

function resolveTransforms(svgText: string): string {
  // Match circle or ellipse elements that have a transform attribute
  // We handle them element-by-element with a regex over the SVG text
  return svgText.replace(
    /<(circle|ellipse)([^>]*?)transform="([^"]*)"([^>]*?)\/>/g,
    (match, tag: string, before: string, transformStr: string, after: string) => {
      const attrs = before + after;
      try {
        const resolved = resolveShapeTransform(tag, attrs, transformStr);
        return `<${tag}${resolved}/>`;
      } catch {
        // Return original, will fail in parseSvgElements (and get caught at banner level)
        return match;
      }
    },
  );
}

function resolveShapeTransform(tag: string, attrs: string, transformStr: string): string {
  const t = transformStr.trim();

  // rotate(angle) or rotate(angle cx cy)
  const rotateMatch = t.match(/^rotate\(\s*([-\d.e]+)(?:\s+[-\d.e]+\s+[-\d.e]+)?\s*\)$/i);
  if (rotateMatch) {
    const angle = parseFloat(rotateMatch[1]!);
    const normalizedAngle = ((angle % 360) + 360) % 360;

    if (tag === 'circle') {
      // Circles are rotationally symmetric — strip transform
      return attrs;
    }

    // Ellipse
    const rx = parseAttrNum(attrs, 'rx');
    const ry = parseAttrNum(attrs, 'ry');

    if (rx === null || ry === null) {
      throw new Error('Cannot resolve ellipse without rx/ry');
    }

    if (Math.abs(rx - ry) < 0.001) {
      // Circle-as-ellipse, rotationally symmetric
      return attrs;
    }

    // For ±90/±270 degrees, swap rx and ry
    if (
      Math.abs(normalizedAngle - 90) < 0.5 ||
      Math.abs(normalizedAngle - 270) < 0.5
    ) {
      return setAttr(setAttr(attrs, 'rx', ry), 'ry', rx);
    }

    // For 0/180, no visual change
    if (normalizedAngle < 0.5 || Math.abs(normalizedAngle - 180) < 0.5) {
      return attrs;
    }

    // Other angles — can't resolve without full matrix math; throw
    throw new Error(`Cannot resolve rotate(${angle}) on ellipse with different rx/ry`);
  }

  // matrix(a b c d e f) — handle specific common patterns
  const matrixMatch = t.match(
    /^matrix\(\s*([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s*\)$/i,
  );
  if (matrixMatch) {
    const [, aS, bS, cS, dS, eS, fS] = matrixMatch;
    const a = parseFloat(aS!);
    const b = parseFloat(bS!);
    const c = parseFloat(cS!);
    const d = parseFloat(dS!);
    const e = parseFloat(eS!);
    const f = parseFloat(fS!);

    const cx = parseAttrNum(attrs, 'cx');
    const cy = parseAttrNum(attrs, 'cy');
    const rx = parseAttrNum(attrs, 'rx');
    const ry = parseAttrNum(attrs, 'ry');

    if (cx === null || cy === null || rx === null || ry === null) {
      throw new Error('Cannot resolve ellipse matrix without cx/cy/rx/ry');
    }

    // Compute new center: [newCx, newCy] = [a*cx + c*cy + e, b*cx + d*cy + f]
    const newCx = a * cx + c * cy + e;
    const newCy = b * cx + d * cy + f;

    // Determine new rx/ry from the matrix scale factors
    // For a pure scale+translate matrix: newRx = |a|*rx + |c|*ry, newRy = |b|*rx + |d|*ry
    // For common cases: matrix(-1 0 0 1 tx 0) → flip x, matrix(1 0 0 -1 0 ty) → flip y
    // These don't change rx/ry magnitudes for axis-aligned ellipses

    // Check if this is a simple reflection/scale (no shear, |det|=1)
    const det = a * d - b * c;
    const isReflection = Math.abs(Math.abs(det) - 1) < 0.001;

    if (!isReflection) {
      throw new Error(`Cannot resolve non-unit-det matrix transform on ellipse`);
    }

    // For reflections: new rx = sqrt((a*rx)^2 + (c*ry)^2), new ry = sqrt((b*rx)^2 + (d*ry)^2)
    const newRx = Math.sqrt(a * a * rx * rx + c * c * ry * ry);
    const newRy = Math.sqrt(b * b * rx * rx + d * d * ry * ry);

    let result = attrs;
    result = setAttr(result, 'cx', newCx);
    result = setAttr(result, 'cy', newCy);
    result = setAttr(result, 'rx', newRx);
    result = setAttr(result, 'ry', newRy);
    return result;
  }

  throw new Error(`Unrecognized transform: ${transformStr}`);
}

function parseAttrNum(attrs: string, name: string): number | null {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (!m) return null;
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) ? v : null;
}

function setAttr(attrs: string, name: string, value: number): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, '');
  const re = new RegExp(`(\\b${name}=")[^"]*(")`, 'g');
  return attrs.replace(re, `$1${formatted}$2`);
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

  return {
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
    const recon = await processBanner(bannerId, svgPath, library, overrides);
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
