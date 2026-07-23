/**
 * patches.test.ts - P4 Task 1 iconic patch extraction + stamping coverage.
 *
 * Tool-side checks import the committed generated data module directly; they do
 * not re-run gen:patches in test setup.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { GRAMMAR as RAW_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { PATCHES, SEED_PATCHES, type IconicPatch } from '../../src/engine/corpus/data/patches.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import { sampleWithDiagnostics } from '../../src/engine/corpus/sample.js';
import { renderPlanSvg } from '../../src/engine/corpus/render.js';
import { PROGRAMS, applyProgramPalette } from '../../src/engine/corpus/programs.js';
import type { BannerPlan, CellPlan, EngineGrammar } from '../../src/engine/corpus/types.js';
import type { Corpus } from '../../tools/mine/schema.js';
import { assertProgramPalettePlan, assertProgramPaletteSvg } from './helpers.js';

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const PATCHES_PATH = join(ROOT, 'src', 'engine', 'corpus', 'data', 'patches.ts');
const DATA_BUDGET_BYTES = 60 * 1024;
const GRAMMAR = RAW_GRAMMAR as unknown as EngineGrammar;
const FIGURE_FIELD_KNOBS = { template: 'figure-field', figures: true } as const;
const PROBE_SEEDS = Array.from({ length: 20 }, (_v, i) => 11000 + i);

function corpus(): Corpus {
  return JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
}

function extractHash(filePath: string): string {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/^\/\/ source-hash: ([0-9a-f]{64})$/m);
  if (!match) throw new Error(`No source-hash comment found in ${filePath}`);
  return match[1]!;
}

function seedForPatch(patch: IconicPatch) {
  const seed = SEED_PATCHES.find(candidate => candidate.id === patch.id);
  if (!seed) throw new Error(`No seed rect for ${patch.id}`);
  return seed;
}

function skippedFreeformAllowance(patch: IconicPatch): number {
  const seed = seedForPatch(patch);
  const banner = corpus().banners.find(candidate => candidate.id === seed.banner);
  if (!banner) throw new Error(`Missing banner ${seed.banner}`);
  return banner.cells.filter(cell =>
    cell.col >= seed.x &&
    cell.col < seed.x + seed.w &&
    cell.row >= seed.y &&
    cell.row < seed.y + seed.h &&
    (cell.kind === 'freeform' || cell.kind === 'review')
  ).length;
}

function patchAnchors(plan: BannerPlan): CellPlan[] {
  return plan.cells.filter(cell => cell.patchId !== undefined);
}

function patchSignature(plan: BannerPlan): Array<{ col: number; row: number; patchId?: string }> {
  return patchAnchors(plan).map(cell => ({ col: cell.col, row: cell.row, patchId: cell.patchId }));
}

function firstPlanWithPatch(): { seed: number; result: ReturnType<typeof sampleWithDiagnostics>; anchor: CellPlan } {
  for (let seed = 1; seed < 200; seed += 1) {
    const result = sampleWithDiagnostics(GRAMMAR, seed, FIGURE_FIELD_KNOBS);
    const anchor = patchAnchors(result.plan)[0];
    if (anchor) return { seed, result, anchor };
  }
  throw new Error('No figure-field patch placement found in seeds 1..199');
}

function planForPatchId(patchId: string): { seed: number; result: ReturnType<typeof sampleWithDiagnostics>; anchor: CellPlan; patch: IconicPatch } {
  for (let seed = 1; seed < 20_000; seed += 1) {
    const result = sampleWithDiagnostics(GRAMMAR, seed, FIGURE_FIELD_KNOBS);
    const anchor = patchAnchors(result.plan).find(cell => cell.patchId === patchId);
    if (!anchor) continue;
    const patch = PATCHES.find(candidate => candidate.id === patchId);
    if (!patch) throw new Error(`Missing patch ${patchId}`);
    return { seed, result, anchor, patch };
  }
  throw new Error(`No figure-field placement found for ${patchId}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tilePath(tileId: string): string {
  const path = TILES[tileId]?.elements.find(el => el.kind === 'path')?.d;
  if (!path) throw new Error(`No path element found in tile ${tileId}`);
  return path;
}

describe('engine corpus patches - generated data integrity', () => {
  it('patches.ts source-hash matches corpus.json', () => {
    const fresh = createHash('sha256').update(readFileSync(CORPUS_PATH, 'utf8')).digest('hex');
    expect(extractHash(PATCHES_PATH)).toBe(fresh);
  });

  it('has unique ids and valid crop coverage with skipped-freeform allowance', () => {
    const seen = new Set<string>();
    for (const patch of PATCHES) {
      expect(seen.has(patch.id), `duplicate patch id ${patch.id}`).toBe(false);
      seen.add(patch.id);
      expect(patch.id).toMatch(/^patch-\d{3}-[a-z0-9-]+$/);
      expect(patch.source.trim(), `${patch.id} source`).not.toBe('');
      expect(patch.w, `${patch.id} w`).toBeGreaterThanOrEqual(2);
      expect(patch.h, `${patch.id} h`).toBeGreaterThanOrEqual(2);
      expect(patch.w, `${patch.id} w cap`).toBeLessThanOrEqual(4);
      expect(patch.h, `${patch.id} h cap`).toBeLessThanOrEqual(3);
      const skipped = skippedFreeformAllowance(patch);
      expect(patch.cells.length, `${patch.id} cells <= area`).toBeLessThanOrEqual(patch.w * patch.h);
      expect(patch.cells.length + skipped, `${patch.id} cells + skipped freeform`).toBe(patch.w * patch.h);
    }
  });

  it('stays within the 60KB generated source budget', () => {
    expect(statSync(PATCHES_PATH).size).toBeLessThanOrEqual(DATA_BUDGET_BYTES);
  });

  it('references only engine tile ids that exist in TILES and GRAMMAR.tileCatalog', () => {
    for (const patch of PATCHES) {
      for (const cell of patch.cells) {
        if (cell.kind !== 'tile') continue;
        expect(cell.tile, `${patch.id} tile id`).toEqual(expect.any(String));
        expect(TILES[cell.tile!], `${patch.id} ${cell.tile} in TILES`).toBeDefined();
        expect(GRAMMAR.tileCatalog[cell.tile!], `${patch.id} ${cell.tile} in grammar catalog`).toBeDefined();
      }
    }
  });
});

describe('engine corpus patches - sampler stamping', () => {
  it('is deterministic for patch count and anchor metadata', () => {
    const { seed, result } = firstPlanWithPatch();
    const again = sampleWithDiagnostics(GRAMMAR, seed, FIGURE_FIELD_KNOBS);
    expect(again.diag.patchesPlaced).toBe(result.diag.patchesPlaced);
    expect(patchSignature(again.plan)).toEqual(patchSignature(result.plan));
    expect(result.diag.patchesPlaced).toBeGreaterThanOrEqual(1);
  });

  it('places patches in at least 30% of 20 figure-field seeds', () => {
    let placed = 0;
    for (const seed of PROBE_SEEDS) {
      const result = sampleWithDiagnostics(GRAMMAR, seed, FIGURE_FIELD_KNOBS);
      if (result.diag.patchesPlaced >= 1) placed += 1;
    }
    const rate = placed / PROBE_SEEDS.length;
    console.log(`[patches.test] patch placement rate ${placed}/${PROBE_SEEDS.length} = ${rate.toFixed(2)}`);
    expect(rate).toBeGreaterThanOrEqual(0.3);
  });

  it('renders a distinctive multi-tile patch signature in SVG output', () => {
    const { result, anchor, patch } = planForPatchId('patch-023-arcs');
    const svg = renderPlanSvg(result.plan, TILES, { cellPx: 100, nodeIds: true });
    const lines04 = patch.cells.find(cell => cell.tile === 'lines-04')!;
    const lines03 = patch.cells.find(cell => cell.tile === 'lines-03')!;
    const lines04Cell = result.plan.cells.find(cell => cell.col === anchor.col + lines04.dx && cell.row === anchor.row + lines04.dy)!;
    const lines03Cell = result.plan.cells.find(cell => cell.col === anchor.col + lines03.dx && cell.row === anchor.row + lines03.dy)!;

    expect(lines04Cell.kind).toBe('tile');
    expect(lines03Cell.kind).toBe('tile');
    expect(lines04Cell.tile).toBe('lines-04');
    expect(lines03Cell.tile).toBe('lines-03');
    expect(svg).toContain(`data-node-id="${lines04Cell.col},${lines04Cell.row}"`);
    expect(svg).toContain(`data-node-id="${lines03Cell.col},${lines03Cell.row}"`);
    expect(svg).toMatch(new RegExp(`d="${escapeRegExp(tilePath('lines-04'))}"[^>]+fill="${escapeRegExp(lines04Cell.ink ?? '#121212')}"`));
    expect(svg).toMatch(new RegExp(`d="${escapeRegExp(tilePath('lines-03'))}"[^>]+fill="${escapeRegExp(lines03Cell.ink ?? '#121212')}"`));
  });

  it('maps patch accent-role cells through program hue and preserves palette law', () => {
    const { result, anchor, patch } = planForPatchId('patch-036-dome');
    const hue = PROGRAMS['artificial-intelligence'].hue;
    const programPlan = applyProgramPalette(result.plan, hue);
    const accentRoleCells = patch.cells.filter(cell => cell.inkRole === 'accent');
    expect(accentRoleCells.length).toBeGreaterThan(0);

    for (const patchCell of accentRoleCells) {
      const cell = programPlan.cells.find(candidate =>
        candidate.col === anchor.col + patchCell.dx &&
        candidate.row === anchor.row + patchCell.dy
      );
      expect(cell?.ink, `${patch.id} accent cell ${patchCell.dx},${patchCell.dy}`).toBe(hue);
    }

    const svg = renderPlanSvg(programPlan, TILES);
    assertProgramPalettePlan(programPlan, hue, 'patch program plan');
    assertProgramPaletteSvg(svg, hue, 'patch program svg');
  });

  it('maximum accent strength preserves protected non-accent patch inks', () => {
    const seed = 450_021;
    const atDefault = sampleWithDiagnostics(GRAMMAR, seed, {
      accent: '#FF4F00',
      accentStrength: 0.75,
    }).plan;
    const atMaximum = sampleWithDiagnostics(GRAMMAR, seed, {
      accent: '#FF4F00',
      accentStrength: 1,
    }).plan;
    const anchor = patchAnchors(atDefault)[0];
    expect(anchor, 'fixture must place a patch').toBeDefined();
    const patch = PATCHES.find(candidate => candidate.id === anchor!.patchId);
    expect(patch, `missing ${anchor!.patchId}`).toBeDefined();

    for (const patchCell of patch!.cells.filter(cell => cell.kind === 'tile' && cell.inkRole !== 'accent')) {
      const col = anchor!.col + patchCell.dx;
      const row = anchor!.row + patchCell.dy;
      const defaultCell = atDefault.cells.find(cell => cell.col === col && cell.row === row);
      const maximumCell = atMaximum.cells.find(cell => cell.col === col && cell.row === row);
      expect(maximumCell?.ink, `${patch!.id} protected ink at ${col},${row}`).toBe(defaultCell?.ink);
    }
  });
});

describe('enforceAccentBudget — patch coherence (P4 track-item)', () => {
  const mk = (col: number, row: number, ink: string, patchAccent = false) => ({
    col, row, kind: 'tile' as const, tile: 'lines-03', rotation: 0 as const, flip: false,
    ground: '#F3F3F3', ink, inks: [ink],
    ...(patchAccent ? { patchInkRole: 'accent' as const } : {}),
  });
  it('strips non-patch accents first; patch accents survive when possible', async () => {
    const { enforceAccentBudget } = await import('../../src/engine/corpus/sample');
    const { GRAMMAR } = await import('../../src/engine/corpus/data/grammar');
    // 18 tile cells, 10 accent (budget = floor(18*0.35) = 6, excess 4), 4 of them patch-accent
    const cells: any[] = [];
    for (let i = 0; i < 18; i++) {
      const accent = i < 10 ? '#FF4F00' : '#121212';
      cells.push(mk(i % 6, Math.floor(i / 6), accent, i >= 6 && i < 10));
    }
    enforceAccentBudget(cells, GRAMMAR as any);
    const patchAccents = cells.filter(c => c.patchInkRole === 'accent' && c.ink === '#FF4F00');
    expect(patchAccents).toHaveLength(4); // untouched — excess covered by non-patch cells
    expect(cells.filter(c => c.ink === '#FF4F00')).toHaveLength(6); // budget met
  });
  it('all-or-nothing when the budget forces into the patch', async () => {
    const { enforceAccentBudget } = await import('../../src/engine/corpus/sample');
    const { GRAMMAR } = await import('../../src/engine/corpus/data/grammar');
    // 18 cells, ALL accent, 14 of them patch-accent (excess 12 > 4 non-patch):
    // the loop must eat into the patch → the whole patch group goes
    const cells: any[] = [];
    for (let i = 0; i < 18; i++) cells.push(mk(i % 6, Math.floor(i / 6), '#FF4F00', i >= 4));
    enforceAccentBudget(cells, GRAMMAR as any);
    const surviving = cells.filter(c => c.patchInkRole === 'accent' && c.ink === '#FF4F00');
    expect(surviving).toHaveLength(0); // never half a dome
    expect(cells.filter(c => c.ink === '#FF4F00').length).toBeLessThanOrEqual(6);
  });
});
