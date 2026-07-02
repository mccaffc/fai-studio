/**
 * sample.ts — seeded grammar sampler for BannerPlan plans (engine, zero-dep).
 *
 * RNG draw order is intentionally linear:
 * 1. template if knobs.template is absent
 * 2. global ground
 * 3. ground scheme, then scheme-specific ground/cell draws
 * 4. dominant family, distinct-tile target, working-set tiles
 * 5. form counts and form placements
 * 6. optional figure region/accent
 * 7. plain positions
 * 8. tile fills: tile, rotation, flip, ink per remaining cell
 *
 * Every object-backed weighted draw iterates sorted keys. Arrays whose order is
 * semantic, such as palette.accentOrder, carry explicit sort keys before draw.
 *
 * This module imports ONLY from src/engine/corpus/** — including the baked
 * TILES data (for the tile→family map detectForms needs). It uses no Node
 * builtins, no filesystem, no wall-clock, and no nondeterministic randomness —
 * mulberry32 (rng.ts) is the sole source of entropy. Enforced by
 * test/engine-corpus/purity.test.ts.
 */

import type {
  BannerPlan,
  CellPlan,
  EngineGrammar,
  GroundSchemeKind,
  SampleKnobs,
  Template,
  VariantKey,
} from './types.js';
import { detectForms, orientEdges } from './forms.js';
import { profileIoU } from './profiles.js';
import { mulberry32, type Rng } from './rng.js';
import { TILES } from './data/tiles.js';

export type { SampleKnobs } from './types.js';

/** tile-id → shape family, derived once from the baked tile catalog. */
const FAMILIES: Record<string, string> = Object.fromEntries(
  Object.entries(TILES).map(([id, tile]) => [id, tile.family]),
);

/** Families whose cells read as line-work in the canonical sense. */
const LINEWORK_FAMILIES = new Set(['lines', 'circle', 'curve', 'wave']);

export interface SampleDiagnostics {
  adjacencyHits: number;
  accentZone: 'ink' | 'ground' | 'figure' | 'none';
  adjacencyFallbacks: number;
  fillAdjacencyHits: number;
  friezesPlaced: number;
}

export interface SampleResult {
  plan: BannerPlan;
  diag: SampleDiagnostics;
}

const COLS = 6;
const ROWS = 3;
const CELL_COUNT = COLS * ROWS;
const EPS = 1e-9;
const DOMINANT_FAMILY_QUOTA = 0.18;
const LINEWORK_STEERING_STRENGTH = 1;

const BRAND_FILLS = new Set([
  '#121212',
  '#F3F3F3',
  '#D9D9D6',
  '#FF4F00',
  '#4997D0',
  '#FFA300',
  '#FFFFFF',
]);

const NEUTRAL_PREFS = ['#121212', '#F3F3F3', '#FFFFFF', '#D9D9D6'] as const;
const ROTATIONS = [0, 90, 180, 270] as const;
const FRIEZE_FAMILIES = new Set(['lines', 'wave', 'circle', 'float', 'mirror', 'square']);

type Rotation = typeof ROTATIONS[number];
type Direction = 'h' | 'v';

interface Weighted<T> {
  value: T;
  weight: number;
  sortKey: string;
}

interface DraftCell {
  col: number;
  row: number;
  ground: string;
  kind?: CellPlan['kind'];
  tile?: string;
  rotation?: Rotation;
  flip?: boolean;
  ink?: string;
  inks?: string[];
  score?: number;
}

interface Placement {
  tile: string;
  rotation: Rotation;
  flip: boolean;
}

export function samplePlan(grammar: EngineGrammar, seed: number, knobs: SampleKnobs = {}): BannerPlan {
  return sampleWithDiagnostics(grammar, seed, knobs).plan;
}

export function sampleWithDiagnostics(grammar: EngineGrammar, seed: number, knobs: SampleKnobs = {}): SampleResult {
  const diag: SampleDiagnostics = {
    adjacencyHits: 0,
    accentZone: 'none',
    adjacencyFallbacks: 0,
    fillAdjacencyHits: 0,
    friezesPlaced: 0,
  };
  const rng = mulberry32(seed);
  const template = chooseTemplate(grammar, rng, knobs.template);
  const globalGround = drawGlobalGround(grammar, rng);
  const groundScheme = drawGroundScheme(grammar, template, rng);
  const cells = makeDraftCells(generateGrounds(grammar, rng, groundScheme, globalGround));

  const dominantFamily = drawDominantFamily(grammar, template, rng);
  let targetDistinct = drawIntegerRange(template.spec.distinctTiles, rng);
  if (template.spec.distinctTiles[1] > 0 && targetDistinct === 0) {
    targetDistinct = 1;
  }
  let workingSet = selectWorkingSet(grammar, rng, template, dominantFamily, targetDistinct);
  if (workingSet.length === 0) {
    workingSet = selectWorkingSet(grammar, rng, template, firstAvailableFamily(grammar), 1);
  }
  targetDistinct = workingSet.length;

  const friezeCount = drawIntegerRange(template.spec.forms.frieze, rng);
  placeFriezes(cells, grammar, rng, workingSet, friezeCount, diag);

  const rawRunCount = drawIntegerRange(template.spec.forms.run, rng);
  const runCount = template.spec.forms.run[1] > 0 ? Math.max(1, rawRunCount) : 0;
  for (let i = 0; i < runCount; i += 1) {
    placeRun(cells, grammar, rng, workingSet, diag);
  }

  const figureSize = plannedFigureSize(template, knobs, rng);
  if (figureSize > 0) {
    placeFigure(cells, grammar, rng, figureSize, knobs.accent);
  } else if (knobs.accent && !grammar.palette.accentOrder.includes(knobs.accent)) {
    throw new Error(`Unknown accent ink: ${knobs.accent}`);
  }

  const usedTiles = usedTileSet(cells);
  const emptyBeforePlain = cells.filter(cell => cell.kind === undefined).length;
  const requiredTileCells = Math.max(0, targetDistinct - usedTiles.size);
  const basePlainTarget = plainTargetCount(template, knobs.density ?? 0.5);
  const plainTarget = Math.max(0, Math.min(basePlainTarget, emptyBeforePlain - requiredTileCells));
  placePlainCells(cells, grammar, rng, plainTarget);

  fillTileCells(cells, grammar, rng, workingSet, template, diag);
  applyAccentZoning(cells, grammar, rng, template, knobs, diag);
  enforceAccentBudget(cells, grammar);
  ensureAccentPresence(cells, grammar, rng);
  applyLogomarkGuard(cells);

  const finalCells = finalizeCells(cells);
  const plan: BannerPlan = {
    id: `sample-${seed}`,
    width: 1920,
    height: 960,
    cols: COLS,
    rows: ROWS,
    ground: globalGround,
    cells: finalCells,
    forms: [],
    matchRate: 1,
  };
  plan.forms = detectForms(plan, grammar.tileCatalog, FAMILIES);
  return { plan, diag };
}

function chooseTemplate(grammar: EngineGrammar, rng: Rng, id: string | undefined): Template {
  if (id) {
    const found = grammar.templates.find(template => template.id === id);
    if (!found) throw new Error(`Unknown template: ${id}`);
    return found;
  }

  return weightedChoice(
    rng,
    grammar.templates.map(template => ({
      value: template,
      weight: template.bannerIds.length,
      sortKey: template.id,
    })),
  );
}

function drawGlobalGround(grammar: EngineGrammar, rng: Rng): string {
  return drawWeightedRecord(
    grammar.palette.globalGrounds,
    rng,
    key => BRAND_FILLS.has(key),
    '#F3F3F3',
  );
}

function drawGroundScheme(grammar: EngineGrammar, template: Template, rng: Rng): GroundSchemeKind {
  const schemes = [...template.spec.groundSchemes].sort();
  if (schemes.length === 0) return 'uniform';
  return weightedChoice(
    rng,
    schemes.map(kind => ({
      value: kind,
      weight: grammar.stats.groundSchemes.counts[kind] || 1,
      sortKey: kind,
    })),
  );
}

function generateGrounds(
  grammar: EngineGrammar,
  rng: Rng,
  scheme: GroundSchemeKind,
  globalGround: string,
): string[] {
  const grounds = Array.from({ length: CELL_COUNT }, () => globalGround);
  const pool = groundPool(grammar, globalGround);

  switch (scheme) {
    case 'uniform':
      return grounds;

    case 'checker': {
      const second = drawGroundFromPool(pool, rng, new Set([globalGround]));
      forEachPosition((col, row, idx) => {
        grounds[idx] = (col + row) % 2 === 0 ? globalGround : second;
      });
      return grounds;
    }

    case 'banded-rows': {
      const distinct = drawDistinctGrounds(pool, rng, Math.min(3, Math.max(2, pool.length)));
      const offset = distinct.length > 1 ? rng.int(0, distinct.length - 1) : 0;
      forEachPosition((_col, row, idx) => {
        grounds[idx] = distinct[(row + offset) % distinct.length] ?? globalGround;
      });
      return grounds;
    }

    case 'banded-cols': {
      const distinct = drawDistinctGrounds(pool, rng, Math.min(3, Math.max(2, pool.length)));
      const offset = distinct.length > 1 ? rng.int(0, distinct.length - 1) : 0;
      forEachPosition((col, _row, idx) => {
        grounds[idx] = distinct[(col + offset) % distinct.length] ?? globalGround;
      });
      return grounds;
    }

    case 'zoned': {
      const offGrounds = drawDistinctGrounds(
        pool.filter(ground => ground !== globalGround),
        rng,
        Math.min(rng.int(1, 3), Math.max(1, pool.length - 1)),
      );
      const occupied = new Set<string>();
      for (const ground of offGrounds) {
        const rect = drawRegionRect(rng, occupied);
        for (let row = rect.row; row < rect.row + rect.h; row += 1) {
          for (let col = rect.col; col < rect.col + rect.w; col += 1) {
            grounds[indexFor(col, row)] = ground;
            occupied.add(`${col},${row}`);
          }
        }
      }
      return grounds;
    }

    case 'scatter': {
      forEachPosition((_col, _row, idx) => {
        if (rng.chance(0.2)) {
          grounds[idx] = drawGroundFromPool(pool, rng, new Set([globalGround]));
        }
      });
      return grounds;
    }
  }
}

function groundPool(grammar: EngineGrammar, globalGround: string): string[] {
  const fromInkTables = Object.keys(grammar.palette.inkByGround).filter(key => BRAND_FILLS.has(key));
  if (!fromInkTables.includes(globalGround) && BRAND_FILLS.has(globalGround)) {
    fromInkTables.push(globalGround);
  }
  const sorted = [...new Set(fromInkTables)].sort();
  return sorted.length > 0 ? sorted : ['#121212', '#F3F3F3'];
}

function drawGroundFromPool(pool: string[], rng: Rng, exclude = new Set<string>()): string {
  const candidates = pool.filter(ground => !exclude.has(ground)).sort();
  const usable = candidates.length > 0 ? candidates : pool.filter(ground => BRAND_FILLS.has(ground)).sort();
  return weightedChoice(
    rng,
    usable.map(ground => ({ value: ground, weight: 1, sortKey: ground })),
  );
}

function drawDistinctGrounds(pool: string[], rng: Rng, count: number): string[] {
  let remaining = [...new Set(pool)].sort();
  const selected: string[] = [];
  while (remaining.length > 0 && selected.length < count) {
    const picked = weightedChoice(
      rng,
      remaining.map(ground => ({ value: ground, weight: 1, sortKey: ground })),
    );
    selected.push(picked);
    remaining = remaining.filter(ground => ground !== picked);
  }
  return selected.length > 0 ? selected : ['#F3F3F3'];
}

function drawRegionRect(rng: Rng, occupied: Set<string>): { col: number; row: number; w: number; h: number } {
  let fallback = { col: 0, row: 0, w: 2, h: 1 };
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const w = rng.int(1, 3);
    const h = rng.int(1, 3);
    const area = w * h;
    if (area < 2 || area > 6) continue;
    const col = rng.int(0, COLS - w);
    const row = rng.int(0, ROWS - h);
    const rect = { col, row, w, h };
    fallback = rect;
    if (!rectCells(rect).some(([c, r]) => occupied.has(`${c},${r}`))) {
      return rect;
    }
  }
  return fallback;
}

function rectCells(rect: { col: number; row: number; w: number; h: number }): [number, number][] {
  const cells: [number, number][] = [];
  for (let row = rect.row; row < rect.row + rect.h; row += 1) {
    for (let col = rect.col; col < rect.col + rect.w; col += 1) {
      cells.push([col, row]);
    }
  }
  return cells;
}

function drawDominantFamily(grammar: EngineGrammar, template: Template, rng: Rng): string {
  const availableFamilies = new Set(Object.values(grammar.tileCatalog).map(entry => entry.family));
  const families = template.spec.dominantFamilies
    .filter(family => availableFamilies.has(family))
    .sort();
  const candidates = families.length > 0 ? families : [...availableFamilies].sort();
  return weightedChoice(
    rng,
    candidates.map(family => ({
      value: family,
      weight: 1,
      sortKey: family,
    })),
  );
}

function selectWorkingSet(
  grammar: EngineGrammar,
  rng: Rng,
  template: Template,
  dominantFamily: string,
  targetDistinct: number,
): string[] {
  const allTiles = Object.keys(grammar.tileCatalog).sort();
  const preferredFamilies = new Set(template.spec.dominantFamilies);
  const preferred = allTiles.filter(tile => preferredFamilies.has(grammar.tileCatalog[tile]?.family ?? ''));
  const dominant = preferred.filter(tile => grammar.tileCatalog[tile]?.family === dominantFamily);
  const selected: string[] = [];

  const quota = Math.min(targetDistinct, Math.ceil(targetDistinct * DOMINANT_FAMILY_QUOTA));
  selected.push(...drawTileIds(grammar, rng, dominant, quota, selected));
  if (selected.length < targetDistinct) {
    selected.push(...drawTileIdsByFamily(grammar, rng, preferred, targetDistinct - selected.length, selected));
  }
  if (selected.length < targetDistinct) {
    selected.push(...drawTileIdsByFamily(grammar, rng, allTiles, targetDistinct - selected.length, selected));
  }

  return [...new Set(selected)].sort();
}

function drawTileIds(
  grammar: EngineGrammar,
  rng: Rng,
  candidates: string[],
  count: number,
  alreadySelected: string[],
): string[] {
  let remaining = [...new Set(candidates)]
    .filter(tile => !alreadySelected.includes(tile))
    .sort();
  const picked: string[] = [];
  while (remaining.length > 0 && picked.length < count) {
    const tile = weightedChoice(
      rng,
      remaining.map(id => ({ value: id, weight: tileWeight(grammar, id), sortKey: id })),
    );
    picked.push(tile);
    remaining = remaining.filter(id => id !== tile);
  }
  return picked;
}

function drawTileIdsByFamily(
  grammar: EngineGrammar,
  rng: Rng,
  candidates: string[],
  count: number,
  alreadySelected: string[],
): string[] {
  let remaining = [...new Set(candidates)]
    .filter(tile => !alreadySelected.includes(tile))
    .sort();
  const picked: string[] = [];
  while (remaining.length > 0 && picked.length < count) {
    const families = [...new Set(remaining.map(tile => grammar.tileCatalog[tile]?.family).filter((family): family is string => !!family))].sort();
    if (families.length === 0) break;
    const family = weightedChoice(
      rng,
      families.map(value => ({ value, weight: 1, sortKey: value })),
    );
    const familyTiles = remaining.filter(tile => grammar.tileCatalog[tile]?.family === family);
    const tile = weightedChoice(
      rng,
      familyTiles.map(id => ({ value: id, weight: tileWeight(grammar, id), sortKey: id })),
    );
    picked.push(tile);
    remaining = remaining.filter(id => id !== tile);
  }
  return picked;
}

function firstAvailableFamily(grammar: EngineGrammar): string {
  return Object.values(grammar.tileCatalog)
    .map(entry => entry.family)
    .sort()[0] ?? 'lines';
}

function placeFriezes(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  count: number,
  diag: SampleDiagnostics,
): void {
  const capable = friezePlacements(grammar, workingSet);
  if (capable.length === 0) return;

  for (let i = 0; i < count; i += 1) {
    const row = drawFriezeRow(grammar, rng);
    if (!rowIsFree(cells, row)) continue;
    const placement = weightedChoice(rng, capable);
    const rowCells = Array.from({ length: COLS }, (_v, col) => cellAt(cells, col, row));
    const ink = drawInkForCells(grammar, rng, rowCells);
    for (const cell of rowCells) {
      assignTile(cell, { tile: placement.tile, rotation: placement.rotation, flip: cell.col % 2 === 1 }, ink);
    }
    diag.friezesPlaced += 1;
  }
}

function friezePlacements(grammar: EngineGrammar, workingSet: string[]): Weighted<Placement>[] {
  const entries: Weighted<Placement>[] = [];
  for (const tile of [...workingSet].sort()) {
    const entry = grammar.tileCatalog[tile];
    if (!entry) continue;
    const familyEligible = FRIEZE_FAMILIES.has(entry.family);
    for (const rotation of ROTATIONS) {
      const edges = orientEdges(entry.edges, rotation, false);
      const edgeEligible = edges.left + edges.right >= 0.25;
      if (!edgeEligible && !familyEligible) continue;
      entries.push({
        value: { tile, rotation, flip: false },
        weight: tileWeight(grammar, tile) * (entry.rotations[String(rotation)] ?? 0),
        sortKey: `${tile}/${String(rotation).padStart(3, '0')}`,
      });
    }
  }
  return entries;
}

function drawFriezeRow(grammar: EngineGrammar, rng: Rng): number {
  const rowKey = drawWeightedRecord(grammar.stats.forms.friezeRows, rng, key => /^[0-2]$/.test(key), '1');
  return Number(rowKey);
}

function placeRun(cells: DraftCell[], grammar: EngineGrammar, rng: Rng, workingSet: string[], diag: SampleDiagnostics): boolean {
  const starts = cells
    .filter(cell => cell.kind === undefined && (isFree(cells, cell.col + 1, cell.row) || isFree(cells, cell.col, cell.row + 1)))
    .sort(compareCells);
  if (starts.length === 0) return false;

  const desiredSteps = rng.int(1, 3);
  const start = weightedChoice(
    rng,
    starts.map(cell => ({ value: cell, weight: 1, sortKey: positionKey(cell) })),
  );
  const availableDirs: Direction[] = [];
  if (isFree(cells, start.col + 1, start.row)) availableDirs.push('h');
  if (isFree(cells, start.col, start.row + 1)) availableDirs.push('v');
  if (availableDirs.length === 0) return false;

  const firstDir = weightedChoice(
    rng,
    availableDirs.map(dir => ({ value: dir, weight: 1, sortKey: dir })),
  );
  const dirs = [firstDir, ...availableDirs.filter(dir => dir !== firstDir)].sort((a, b) => (a === firstDir ? -1 : b === firstDir ? 1 : compareCodepoint(a, b)));

  for (const dir of dirs) {
    const next = dir === 'h' ? cellAt(cells, start.col + 1, start.row) : cellAt(cells, start.col, start.row + 1);
    const pair = drawRunPair(grammar, rng, workingSet, dir, diag);
    if (!pair) continue;
    const ink = drawInkForCells(grammar, rng, [start, next]);
    assignTile(start, pair[0], ink);
    assignTile(next, pair[1], ink);

    let currentCell = next;
    let currentPlacement = pair[1];
    for (let step = 1; step < desiredSteps; step += 1) {
      const candidate = dir === 'h'
        ? maybeCellAt(cells, currentCell.col + 1, currentCell.row)
        : maybeCellAt(cells, currentCell.col, currentCell.row + 1);
      if (!candidate || candidate.kind !== undefined || candidate.ground === ink) break;
      const placement = drawNextRunPlacement(grammar, rng, workingSet, currentPlacement, dir, diag);
      if (!placement) break;
      assignTile(candidate, placement, ink);
      currentCell = candidate;
      currentPlacement = placement;
    }
    return true;
  }

  return false;
}

function drawRunPair(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  dir: Direction,
  diag: SampleDiagnostics,
): [Placement, Placement] | null {
  const primary = observedRunPairEntries(grammar, workingSet, dir, false);
  if (primary.length > 0) {
    diag.adjacencyHits += 1;
    return weightedChoice(rng, primary);
  }
  const relaxed = observedRunPairEntries(grammar, workingSet, dir, true);
  if (relaxed.length > 0) {
    diag.adjacencyHits += 1;
    return weightedChoice(rng, relaxed);
  }
  diag.adjacencyFallbacks += 1;
  return drawFallbackPair(grammar, rng, workingSet, dir);
}

function observedRunPairEntries(
  grammar: EngineGrammar,
  workingSet: string[],
  dir: Direction,
  allowHorizontalFriezePair: boolean,
): Weighted<[Placement, Placement]>[] {
  const working = new Set(workingSet);
  const table = dir === 'h' ? grammar.stats.adjacency.horizontal : grammar.stats.adjacency.vertical;
  const entries: Weighted<[Placement, Placement]>[] = [];
  for (const fromKey of Object.keys(table).sort()) {
    const from = parsePlacementKey(fromKey);
    if (!from || !working.has(from.tile)) continue;
    const outs = table[fromKey] ?? {};
    for (const toKey of Object.keys(outs).sort()) {
      const to = parsePlacementKey(toKey);
      if (!to || !working.has(to.tile)) continue;
      if (!allowHorizontalFriezePair && dir === 'h' && from.tile === to.tile && from.rotation === to.rotation) {
        continue;
      }
      if (!placementsJoin(grammar, from, to, dir)) continue;
      entries.push({
        value: [from, to],
        weight: outs[toKey] ?? 0,
        sortKey: `${fromKey}>${toKey}`,
      });
    }
  }
  return entries;
}

function drawNextRunPlacement(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  current: Placement,
  dir: Direction,
  diag: SampleDiagnostics,
): Placement | null {
  const working = new Set(workingSet);
  const table = dir === 'h' ? grammar.stats.adjacency.horizontal : grammar.stats.adjacency.vertical;
  const currentKey = placementKey(current);
  const outs = table[currentKey] ?? {};
  const entries: Weighted<Placement>[] = [];
  for (const toKey of Object.keys(outs).sort()) {
    const to = parsePlacementKey(toKey);
    if (!to || !working.has(to.tile)) continue;
    if (dir === 'h' && current.tile === to.tile && current.rotation === to.rotation) continue;
    if (!placementsJoin(grammar, current, to, dir)) continue;
    entries.push({ value: to, weight: outs[toKey] ?? 0, sortKey: toKey });
  }
  if (entries.length > 0) {
    diag.adjacencyHits += 1;
    return weightedChoice(rng, entries);
  }

  const fallback = fallbackPlacement(grammar, current, dir);
  diag.adjacencyFallbacks += 1;
  return fallback && working.has(fallback.tile) ? fallback : null;
}

function drawFallbackPair(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  dir: Direction,
): [Placement, Placement] | null {
  const entries: Weighted<[Placement, Placement]>[] = [];
  for (const tile of [...workingSet].sort()) {
    for (const rotation of ROTATIONS) {
      for (const flip of [false, true]) {
        const from = { tile, rotation, flip };
        const to = { tile, rotation, flip: !flip };
        if (!placementsJoin(grammar, from, to, dir)) continue;
        entries.push({
          value: [from, to],
          weight: tileWeight(grammar, tile),
          sortKey: `${placementKey(from)}>${placementKey(to)}`,
        });
      }
    }
  }
  return entries.length > 0 ? weightedChoice(rng, entries) : null;
}

function fallbackPlacement(grammar: EngineGrammar, current: Placement, dir: Direction): Placement | null {
  const next = { ...current, flip: !current.flip };
  return placementsJoin(grammar, current, next, dir) ? next : null;
}

function plannedFigureSize(template: Template, knobs: SampleKnobs, rng: Rng): number {
  if (knobs.figures === false) return 0;
  if (template.spec.forms.figure[1] <= 0) return 0;
  const maxCells = Math.min(4, Math.floor(template.spec.figureShare[1] * CELL_COUNT + EPS));
  const minCells = Math.max(2, Math.ceil(template.spec.figureShare[0] * CELL_COUNT - EPS));
  if (maxCells < minCells) return 0;
  if (knobs.figures !== true && !rng.chance(0.55)) return 0;
  return Math.min(2, maxCells);
}

function placeFigure(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  size: number,
  knobAccent: string | undefined,
): boolean {
  if (knobAccent && !grammar.palette.accentOrder.includes(knobAccent)) {
    throw new Error(`Unknown accent ink: ${knobAccent}`);
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const empty = cells.filter(cell => cell.kind === undefined).sort(compareCells);
    if (empty.length < size) return false;
    const start = weightedChoice(
      rng,
      empty.map(cell => ({ value: cell, weight: 1, sortKey: positionKey(cell) })),
    );
    const region = growConnectedRegion(cells, rng, start, size);
    if (region.length < size) continue;
    const ink = chooseAccent(grammar, rng, new Set(region.map(cell => cell.ground)), knobAccent);
    if (!ink) continue;
    for (const cell of region) {
      cell.kind = 'freeform';
      cell.ink = ink;
      cell.inks = [ink];
    }
    return true;
  }

  return false;
}

function growConnectedRegion(cells: DraftCell[], rng: Rng, start: DraftCell, size: number): DraftCell[] {
  const region = [start];
  const selected = new Set([positionKey(start)]);
  while (region.length < size) {
    const frontier = region
      .flatMap(cell => neighbors(cells, cell))
      .filter(cell => cell.kind === undefined && !selected.has(positionKey(cell)))
      .sort(compareCells);
    if (frontier.length === 0) break;
    const next = weightedChoice(
      rng,
      frontier.map(cell => ({ value: cell, weight: 1, sortKey: positionKey(cell) })),
    );
    region.push(next);
    selected.add(positionKey(next));
  }
  return region;
}

function chooseAccent(
  grammar: EngineGrammar,
  rng: Rng,
  excludedGrounds: Set<string>,
  knobAccent: string | undefined,
): string | null {
  if (knobAccent && !excludedGrounds.has(knobAccent)) return knobAccent;
  if (knobAccent) return null;

  const accents = grammar.palette.accentOrder
    .map((accent, index) => ({ accent, index }))
    .filter(({ accent }) => BRAND_FILLS.has(accent) && !excludedGrounds.has(accent));
  if (accents.length === 0) return null;
  return weightedChoice(
    rng,
    accents.map(({ accent, index }) => ({
      value: accent,
      weight: grammar.palette.accentOrder.length - index,
      sortKey: accent,
    })),
  );
}

function plainTargetCount(template: Template, density: number): number {
  const d = Math.max(0, Math.min(1, density));
  const [lo, hi] = template.spec.plainShare;
  const targetShare = lo + (hi - lo) * ((1 - d) ** 2);
  const minCount = Math.ceil(lo * CELL_COUNT - EPS);
  const maxCount = Math.floor(hi * CELL_COUNT + EPS);
  return Math.max(minCount, Math.min(maxCount, Math.round(targetShare * CELL_COUNT)));
}

function placePlainCells(cells: DraftCell[], grammar: EngineGrammar, rng: Rng, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const empty = cells.filter(cell => cell.kind === undefined).sort(compareCells);
    if (empty.length === 0) return;
    const cell = weightedChoice(
      rng,
      empty.map(candidate => ({
        value: candidate,
        weight: grammar.stats.plain.positions[positionKey(candidate)] ?? 1,
        sortKey: positionKey(candidate),
      })),
    );
    cell.kind = 'plain';
  }
}

function fillTileCells(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  template: Template,
  diag: SampleDiagnostics,
): void {
  const targetLinework = midpoint(template.spec.lineworkShare);
  const used = usedTileSet(cells);
  let tileCells = 0;
  let lineworkCells = 0;
  for (const cell of cells) {
    if (cell.kind === 'tile' && cell.tile) {
      tileCells += 1;
      if (isLineworkTile(grammar, cell.tile)) lineworkCells += 1;
    }
  }

  const fillTargets = cells.filter(cell => cell.kind === undefined).sort(compareCells);
  for (let i = 0; i < fillTargets.length; i += 1) {
    const cell = fillTargets[i]!;
    const remainingSlots = fillTargets.length - i;
    const adjacent = drawAdjacentFillPlacement(
      grammar,
      rng,
      workingSet,
      used,
      remainingSlots,
      cell,
      cells,
      targetLinework,
      tileCells,
      lineworkCells,
    );
    if (adjacent.attempted && !adjacent.placement) {
      diag.adjacencyFallbacks += 1;
    }
    const placement = adjacent.placement ?? independentFillPlacement(
      grammar,
      rng,
      workingSet,
      used,
      remainingSlots,
      targetLinework,
      tileCells,
      lineworkCells,
    );
    if (adjacent.placement) {
      diag.fillAdjacencyHits += 1;
    }
    const ink = drawInkForGround(grammar, rng, cell.ground);
    assignTile(cell, placement, ink);
    used.add(placement.tile);
    tileCells += 1;
    if (isLineworkTile(grammar, placement.tile)) lineworkCells += 1;
  }
}

function drawAdjacentFillPlacement(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  used: Set<string>,
  remainingSlots: number,
  cell: DraftCell,
  cells: DraftCell[],
  targetLinework: number,
  tileCells: number,
  lineworkCells: number,
): { attempted: boolean; placement: Placement | null } {
  const working = new Set(workingSet);
  const unused = workingSet.filter(tile => !used.has(tile));
  const requireUnused = unused.length > 0 && unused.length >= remainingSlots;
  const candidates = new Map<string, Weighted<Placement>>();
  let attempted = false;

  const left = maybeCellAt(cells, cell.col - 1, cell.row);
  const top = maybeCellAt(cells, cell.col, cell.row - 1);
  const sources: { source: DraftCell | undefined; dir: Direction }[] = [
    { source: left, dir: 'h' },
    { source: top, dir: 'v' },
  ];

  for (const { source, dir } of sources) {
    if (!isPlacedTile(source)) continue;
    attempted = true;
    const table = dir === 'h' ? grammar.stats.adjacency.horizontal : grammar.stats.adjacency.vertical;
    const outs = table[placementKey(source)] ?? {};
    for (const toKey of Object.keys(outs).sort()) {
      const to = parsePlacementKey(toKey);
      if (!to || !working.has(to.tile)) continue;
      if (requireUnused && used.has(to.tile)) continue;
      const previous = candidates.get(toKey);
      const weight = outs[toKey] ?? 0;
      if (previous) {
        previous.weight += weight;
      } else {
        candidates.set(toKey, { value: to, weight, sortKey: toKey });
      }
    }
  }

  const entries = steerPlacementEntries(grammar, [...candidates.values()], targetLinework, tileCells, lineworkCells);
  return {
    attempted,
    placement: entries.length > 0 ? weightedChoice(rng, entries) : null,
  };
}

function steerPlacementEntries(
  grammar: EngineGrammar,
  entries: Weighted<Placement>[],
  targetLinework: number,
  tileCells: number,
  lineworkCells: number,
): Weighted<Placement>[] {
  const currentShare = tileCells === 0 ? targetLinework : lineworkCells / tileCells;
  const wantLinework = currentShare < targetLinework;
  const shaped = entries.filter(entry => isLineworkTile(grammar, entry.value.tile) === wantLinework);
  return shaped.length > 0 ? shaped : entries;
}

function independentFillPlacement(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  used: Set<string>,
  remainingSlots: number,
  targetLinework: number,
  tileCells: number,
  lineworkCells: number,
): Placement {
  const tile = chooseFillTile(grammar, rng, workingSet, used, remainingSlots, targetLinework, tileCells, lineworkCells);
  return {
    tile,
    rotation: drawRotation(grammar, rng, tile),
    flip: rng.chance(grammar.tileCatalog[tile]?.flipShare ?? 0),
  };
}

function chooseFillTile(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  used: Set<string>,
  remainingSlots: number,
  targetLinework: number,
  tileCells: number,
  lineworkCells: number,
): string {
  const unused = workingSet.filter(tile => !used.has(tile)).sort();
  let pool = unused.length > 0 ? unused : [...workingSet].sort();
  if (pool.length === 0) pool = Object.keys(grammar.tileCatalog).sort();

  const currentShare = tileCells === 0 ? targetLinework : lineworkCells / tileCells;
  const wantLinework = currentShare < targetLinework;
  const shaped = pool.filter(tile => isLineworkTile(grammar, tile) === wantLinework);
  return weightedChoice(
    rng,
    pool.map(tile => ({
      value: tile,
      weight: tileWeight(grammar, tile) * (shaped.includes(tile) && unused.length < remainingSlots ? 1 + LINEWORK_STEERING_STRENGTH : 1),
      sortKey: tile,
    })),
  );
}

function drawRotation(grammar: EngineGrammar, rng: Rng, tile: string): Rotation {
  const rotations = grammar.tileCatalog[tile]?.rotations ?? {};
  return weightedChoice(
    rng,
    ROTATIONS.map(rotation => ({
      value: rotation,
      weight: rotations[String(rotation)] ?? 0,
      sortKey: String(rotation).padStart(3, '0'),
    })),
  );
}

function drawInkForGround(grammar: EngineGrammar, rng: Rng, ground: string): string {
  return drawInkForGrounds(grammar, rng, [ground]);
}

function drawInkForCells(grammar: EngineGrammar, rng: Rng, cells: DraftCell[]): string {
  return drawInkForGrounds(grammar, rng, cells.map(cell => cell.ground));
}

function drawInkForGrounds(grammar: EngineGrammar, rng: Rng, grounds: string[]): string {
  const dominant = dominantGround(grounds);
  const excluded = new Set(grounds);
  const inkMap = grammar.palette.inkByGround[dominant] ?? {};
  const entries = Object.keys(inkMap)
    .filter(ink => BRAND_FILLS.has(ink) && !excluded.has(ink))
    .sort()
    .map(ink => ({ value: ink, weight: inkMap[ink] ?? 0, sortKey: ink }));
  if (entries.length === 0) return neutralForGrounds(grounds);
  return weightedChoice(rng, entries);
}

function dominantGround(grounds: string[]): string {
  const counts = new Map<string, number>();
  for (const ground of grounds) {
    counts.set(ground, (counts.get(ground) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodepoint(a[0], b[0]))[0]?.[0] ?? '#F3F3F3';
}


/**
 * Accent zoning (visual-gate iteration 1): the corpus carries its accent on
 * ONE form or ground region — never scattered singles. Draw one accent + one
 * zone; de-scatter every accent ink outside it. Modes: 'ink' recolors a
 * same-tile flood's inks to the accent; 'ground' turns the zone's grounds
 * into a colored block (canonical black-on-orange move); 'figure' adopts an
 * existing freeform figure as the zone. A second zone fires at p=0.2 on the
 * large templates (mixed-quilt / figure-field), echoing two-accent banners.
 */
function applyAccentZoning(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  template: Template,
  knobs: SampleKnobs,
  diag: SampleDiagnostics,
): void {
  const accents = grammar.palette.accentOrder.filter(a => BRAND_FILLS.has(a));
  if (accents.length === 0) return;
  const drawAccentInk = (): string => {
    if (knobs.accent) return knobs.accent;
    return weightedChoice(rng, accents.map((a, i) => ({ value: a, weight: accents.length - i, sortKey: a })))!;
  };

  const zones: Set<DraftCell>[] = [];
  const zoneAccents: string[] = [];

  const figureCells = cells.filter(c => c.kind === 'freeform');
  if (figureCells.length > 0 && rng.next() < 0.5) {
    // adopt the figure as the accent zone (its ink is already an accent by construction)
    zones.push(new Set(figureCells));
    zoneAccents.push(figureCells[0]!.ink ?? drawAccentInk());
    diag.accentZone = 'figure';
  } else {
    const accent = drawAccentInk();
    const anchors = cells
      .filter(c => c.kind === 'tile' && c.tile)
      .sort(compareCells);
    if (anchors.length === 0) return;
    const anchor = weightedChoice(rng, anchors.map(c => ({ value: c, weight: 1, sortKey: `${c.col},${c.row}` })))!;
    // same-tile flood from the anchor (captures a run/frieze segment), cap 6
    const zone = new Set<DraftCell>([anchor]);
    const queue = [anchor];
    while (queue.length > 0 && zone.size < 6) {
      const cur = queue.shift()!;
      for (const n of cells) {
        if (zone.size >= 6 || zone.has(n) || n.kind !== 'tile' || n.tile !== cur.tile) continue;
        const adj = Math.abs(n.col - cur.col) + Math.abs(n.row - cur.row) === 1;
        if (adj) { zone.add(n); queue.push(n); }
      }
    }
    const mode = rng.next() < 0.6 ? 'ink' : 'ground';
    if (mode === 'ink') {
      for (const c of zone) if (accent !== c.ground) { c.ink = accent; c.inks = [accent]; }
      diag.accentZone = 'ink';
    } else {
      for (const c of zone) {
        c.ground = accent;
        const ink = c.ink === accent || c.ink === undefined ? '#121212' : c.ink;
        c.ink = NEUTRAL_INKS_SET.has(ink) ? ink : '#121212';
        if (c.ink === accent) c.ink = '#121212';
        c.inks = c.ink ? [c.ink] : [];
      }
      diag.accentZone = 'ground';
    }
    zones.push(zone);
    zoneAccents.push(accent);
  }

  // optional second zone on large templates
  if ((template.id === 'mixed-quilt' || template.id === 'figure-field') && rng.next() < 0.2) {
    const accent2 = drawAccentInk();
    const outside = cells.filter(c => c.kind === 'tile' && c.tile && !zones[0]!.has(c)).sort(compareCells);
    if (outside.length > 0) {
      const a2 = weightedChoice(rng, outside.map(c => ({ value: c, weight: 1, sortKey: `${c.col},${c.row}` })))!;
      const z2 = new Set<DraftCell>([a2]);
      if (accent2 !== a2.ground) { a2.ink = accent2; a2.inks = [accent2]; }
      zones.push(z2); zoneAccents.push(accent2);
    }
  }

  // de-scatter: accent inks outside all zones revert to neutral
  const accentSet = new Set(accents);
  const inZone = new Set<DraftCell>(); for (const z of zones) for (const c of z) inZone.add(c);
  for (const c of cells) {
    if (c.kind === 'plain' || inZone.has(c)) continue;
    if (c.ink && accentSet.has(c.ink)) {
      const ink = neutralForGround(c.ground);
      c.ink = ink; c.inks = [ink];
    }
  }
}

const NEUTRAL_INKS_SET = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);

function enforceAccentBudget(cells: DraftCell[], grammar: EngineGrammar): void {
  const accents = new Set(grammar.palette.accentOrder);
  const nonPlain = cells.filter(cell => cell.kind !== 'plain');
  const maxAccent = Math.floor(nonPlain.length * 0.35 + EPS);
  const accentCells = nonPlain
    .filter(cell => cell.ink && accents.has(cell.ink))
    .sort((a, b) => {
      const kindA = a.kind === 'freeform' ? 1 : 0;
      const kindB = b.kind === 'freeform' ? 1 : 0;
      return kindA - kindB || compareCells(a, b);
    });
  const excess = accentCells.length - maxAccent;
  for (let i = 0; i < excess; i += 1) {
    const cell = accentCells[i]!;
    const ink = neutralForGround(cell.ground);
    cell.ink = ink;
    cell.inks = [ink];
  }
}

function ensureAccentPresence(cells: DraftCell[], grammar: EngineGrammar, rng: Rng): void {
  const accents = new Set(grammar.palette.accentOrder);
  const nonPlain = cells.filter(cell => cell.kind !== 'plain');
  if (nonPlain.some(cell => cell.ink && accents.has(cell.ink))) return;
  if (Math.floor(nonPlain.length * 0.35 + EPS) <= 0) return;

  const candidates: Weighted<{ cell: DraftCell; entries: Weighted<string>[] }>[] = [];
  for (const cell of nonPlain.sort(compareCells)) {
    const entries = accentInkEntriesForGround(grammar, cell.ground);
    if (entries.length === 0) continue;
    candidates.push({
      value: { cell, entries },
      weight: entries.reduce((sum, entry) => sum + entry.weight, 0),
      sortKey: positionKey(cell),
    });
  }
  if (candidates.length === 0) return;

  const { cell, entries } = weightedChoice(rng, candidates);
  const ink = weightedChoice(rng, entries);
  cell.ink = ink;
  cell.inks = [ink];
}

function accentInkEntriesForGround(grammar: EngineGrammar, ground: string): Weighted<string>[] {
  const accents = new Set(grammar.palette.accentOrder);
  const inkMap = grammar.palette.inkByGround[ground] ?? {};
  return Object.keys(inkMap)
    .filter(ink => accents.has(ink) && BRAND_FILLS.has(ink) && ink !== ground)
    .sort()
    .map(ink => ({ value: ink, weight: inkMap[ink] ?? 0, sortKey: ink }));
}

function applyLogomarkGuard(cells: DraftCell[]): void {
  // TODO(P2): port the REAL logo-guard (src/engine/render/logo-guard.ts) at render level.
  // The P0 brand law targets exactly tri/dart + tri/chevron-notch primitives, forbids
  // exactly-two (not 3+) same-direction chevrons adjacent along the pointing axis, with
  // direction = flip ? (rot+180)%360 : rot, on BOTH axes. A prior plan-level approximation
  // here keyed off manifest dominant_direction (45 tiles, wrong set) and toggled flip
  // (which does not change dominant_direction), i.e. it mutated legal friezes while
  // failing to establish its own invariant — final P1 review, 2026-07-02.
  // SAFE AS NO-OP FOR P1: the catalog contains no chevron primitives (closest family is
  // 'angle', which is not the mark), and P1 plans are offline artifacts — nothing renders
  // to shippable SVG until P2, where the real guard must run.
  void cells;
}

function finalizeCells(cells: DraftCell[]): CellPlan[] {
  return cells.sort(compareCells).map(cell => {
    if (cell.kind === undefined) {
      throw new Error(`Unresolved sampled cell ${positionKey(cell)}`);
    }
    return { ...cell } as CellPlan;
  });
}

function makeDraftCells(grounds: string[]): DraftCell[] {
  const cells: DraftCell[] = [];
  forEachPosition((col, row, idx) => {
    cells.push({ col, row, ground: grounds[idx] ?? '#F3F3F3' });
  });
  return cells;
}

function assignTile(cell: DraftCell, placement: Placement, ink: string): void {
  cell.kind = 'tile';
  cell.tile = placement.tile;
  cell.rotation = placement.rotation;
  cell.flip = placement.flip;
  cell.ink = ink;
  cell.inks = [ink];
  cell.score = 1;
}

function usedTileSet(cells: DraftCell[]): Set<string> {
  const used = new Set<string>();
  for (const cell of cells) {
    if (cell.kind === 'tile' && cell.tile) used.add(cell.tile);
  }
  return used;
}

/** Minimum edge-profile IoU for two placements to count as truly continuous at the seam. */
const PROFILE_JOIN_MIN = 0.5;

function placementsJoin(grammar: EngineGrammar, a: Placement, b: Placement, dir: Direction): boolean {
  const aEntry = grammar.tileCatalog[a.tile];
  const bEntry = grammar.tileCatalog[b.tile];
  if (!aEntry || !bEntry) return false;
  const aEdges = orientEdges(aEntry.edges, a.rotation, a.flip);
  const bEdges = orientEdges(bEntry.edges, b.rotation, b.flip);
  const active = dir === 'h'
    ? aEdges.right >= 0.25 && bEdges.left >= 0.25
    : aEdges.bottom >= 0.25 && bEdges.top >= 0.25;
  if (!active) return false;
  // v2 edge-matching contract: the line-work must actually LINE UP at the seam,
  // not merely both touch it. Activity-only when profiles are absent (v1 grammar).
  const aProf = aEntry.profiles?.[variantKey(a)];
  const bProf = bEntry.profiles?.[variantKey(b)];
  if (!aProf || !bProf) return true;
  const iou = dir === 'h' ? profileIoU(aProf.right, bProf.left) : profileIoU(aProf.bottom, bProf.top);
  return iou >= PROFILE_JOIN_MIN;
}

function variantKey(p: Placement): VariantKey {
  return `${p.rotation}/${p.flip ? 'f' : '-'}` as VariantKey;
}

function parsePlacementKey(key: string): Placement | null {
  const [tile, rotationRaw, flipRaw] = key.split('/');
  const rotation = Number(rotationRaw);
  if (!tile || !isRotation(rotation) || (flipRaw !== 'f' && flipRaw !== '-')) return null;
  return { tile, rotation, flip: flipRaw === 'f' };
}

function placementKey(placement: Placement): string {
  return `${placement.tile}/${placement.rotation}/${placement.flip ? 'f' : '-'}`;
}

function isRotation(value: number): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function rowIsFree(cells: DraftCell[], row: number): boolean {
  for (let col = 0; col < COLS; col += 1) {
    if (cellAt(cells, col, row).kind !== undefined) return false;
  }
  return true;
}

function neighbors(cells: DraftCell[], cell: DraftCell): DraftCell[] {
  return [
    maybeCellAt(cells, cell.col - 1, cell.row),
    maybeCellAt(cells, cell.col + 1, cell.row),
    maybeCellAt(cells, cell.col, cell.row - 1),
    maybeCellAt(cells, cell.col, cell.row + 1),
  ].filter((candidate): candidate is DraftCell => candidate !== undefined);
}

function isFree(cells: DraftCell[], col: number, row: number): boolean {
  const cell = maybeCellAt(cells, col, row);
  return cell !== undefined && cell.kind === undefined;
}

function isPlacedTile(cell: DraftCell | undefined): cell is DraftCell & Required<Pick<DraftCell, 'tile' | 'rotation' | 'flip'>> {
  return cell !== undefined && cell.kind === 'tile' && !!cell.tile && cell.rotation !== undefined && cell.flip !== undefined;
}

function maybeCellAt(cells: DraftCell[], col: number, row: number): DraftCell | undefined {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return undefined;
  return cells[indexFor(col, row)];
}

function cellAt(cells: DraftCell[], col: number, row: number): DraftCell {
  const cell = maybeCellAt(cells, col, row);
  if (!cell) throw new Error(`Cell out of bounds: ${col},${row}`);
  return cell;
}

function indexFor(col: number, row: number): number {
  return row * COLS + col;
}

function positionKey(cell: Pick<DraftCell, 'col' | 'row'>): string {
  return `${cell.col},${cell.row}`;
}

function compareCells(a: Pick<DraftCell, 'col' | 'row'>, b: Pick<DraftCell, 'col' | 'row'>): number {
  return a.row - b.row || a.col - b.col;
}

function forEachPosition(fn: (col: number, row: number, idx: number) => void): void {
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      fn(col, row, indexFor(col, row));
    }
  }
}

function neutralForGround(ground: string): string {
  return ground === '#121212' ? '#F3F3F3' : '#121212';
}

function neutralForGrounds(grounds: string[]): string {
  for (const ink of NEUTRAL_PREFS) {
    if (!grounds.includes(ink)) return ink;
  }
  return '#121212';
}

function isLineworkTile(grammar: EngineGrammar, tile: string): boolean {
  const family = grammar.tileCatalog[tile]?.family;
  return family !== undefined && LINEWORK_FAMILIES.has(family);
}

function tileWeight(grammar: EngineGrammar, tile: string): number {
  return grammar.stats.tiles[tile] ?? 1;
}

function midpoint(range: [number, number]): number {
  return (range[0] + range[1]) / 2;
}

function drawIntegerRange(range: [number, number], rng: Rng): number {
  const lo = Math.ceil(range[0] - EPS);
  const hi = Math.floor(range[1] + EPS);
  if (hi <= lo) return lo;
  return rng.int(lo, hi);
}

function drawWeightedRecord(
  record: Record<string, number>,
  rng: Rng,
  include: (key: string) => boolean,
  fallback: string,
): string {
  const entries = Object.keys(record)
    .filter(include)
    .sort()
    .map(key => ({ value: key, weight: record[key] ?? 0, sortKey: key }));
  if (entries.length === 0) return fallback;
  return weightedChoice(rng, entries);
}

function weightedChoice<T>(rng: Rng, entries: Weighted<T>[]): T {
  if (entries.length === 0) {
    throw new Error('weightedChoice requires at least one entry');
  }

  const sorted = [...entries].sort((a, b) => compareCodepoint(a.sortKey, b.sortKey));
  const positive = sorted.filter(entry => entry.weight > 0);
  // A fully zero-weight candidate set still represents an allowed set; draw it uniformly.
  const usable = positive.length > 0 ? positive : sorted.map(entry => ({ ...entry, weight: 1 }));
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  for (const entry of usable) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return usable[usable.length - 1]!.value;
}

function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
