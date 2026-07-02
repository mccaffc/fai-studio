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
import { FIGURES, type FigureAsset } from './data/figures.js';

export type { SampleKnobs } from './types.js';
export type { BannerPlan } from './types.js';

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
  /** Largest 'run'-form cell count in the final plan (from plan.forms). */
  longestRun: number;
  /**
   * One entry per explicitly-grown run: the cell coordinates [col, row] of the
   * seed pair plus each accepted growth step, in placement order. Populated by
   * both growSerpentine and growStraight. Deterministic; no behavior change.
   */
  runPaths: [number, number][][];
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

// --- Serpentine run growth (P2 Task 2) ------------------------------------
// The connected-surface templates grow canon-length runs that TURN CORNERS
// (target length drawn from the mined form-size distribution). The rhythm
// templates keep the previous short straight growth. figure-field/mixed-quilt
// use mined-length targets but straight growth (no turns).
const SERPENTINE_TEMPLATES = new Set(['pipe-field', 'arc-mosaic']);
const MINED_LENGTH_TEMPLATES = new Set(['pipe-field', 'arc-mosaic', 'figure-field', 'mixed-quilt']);
// Direction-draw weights at each serpentine step: keep straight most of the
// time, turn either way a fifth of the time each.
const SERPENTINE_CONTINUE_WEIGHT = 0.6;
const SERPENTINE_TURN_WEIGHT = 0.2;
// The rhythm templates must never carry a run form longer than this after
// fill (their canon is rhythm, not serpents). A post-fill splitter re-inks a
// minimal interior cell of any longer same-ink run to break the join.
const RHYTHM_RUN_CAP = 6;
const RHYTHM_TEMPLATES = new Set(['repeat-rhythm', 'checker-motif']);

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
  figureId?: string;
  figureAnchor?: boolean;
  figureSpan?: [number, number];
}

interface Placement {
  tile: string;
  rotation: Rotation;
  flip: boolean;
}

export function samplePlan(
  grammar: EngineGrammar,
  seed: number,
  knobs: SampleKnobs = {},
  figures: readonly FigureAsset[] = FIGURES,
): BannerPlan {
  return sampleWithDiagnostics(grammar, seed, knobs, figures).plan;
}

export function sampleWithDiagnostics(
  grammar: EngineGrammar,
  seed: number,
  knobs: SampleKnobs = {},
  figures: readonly FigureAsset[] = FIGURES,
): SampleResult {
  const diag: SampleDiagnostics = {
    adjacencyHits: 0,
    accentZone: 'none',
    adjacencyFallbacks: 0,
    fillAdjacencyHits: 0,
    friezesPlaced: 0,
    longestRun: 0,
    runPaths: [],
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
    placeRun(cells, grammar, rng, workingSet, template, diag);
  }

  const figureSize = plannedFigureSize(template, knobs, rng);
  if (figureSize > 0) {
    placeFigure(cells, grammar, rng, figureSize, knobs.accent, figures, template.id);
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
  // Run last: cap rhythm-template run length AFTER every ink mutation, so the
  // accent passes can't re-merge a split run.
  splitRhythmRuns(cells, grammar, template);
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
    templateId: template.id,
  };
  plan.forms = detectForms(plan, grammar.tileCatalog, FAMILIES);
  diag.longestRun = plan.forms.reduce(
    (max, form) => (form.kind === 'run' && form.cells.length > max ? form.cells.length : max),
    0,
  );
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

/**
 * A serpentine growth step. Growing rightward/downward tests the seam with the
 * CURRENT cell first (its right/bottom meets the candidate's left/top); growing
 * leftward/upward tests the CANDIDATE first (its right/bottom meets the current
 * cell's left/top). `axis` is the profile-join axis: horizontal steps ('h') use
 * left/right edges, vertical steps ('v') use top/bottom edges.
 */
type Step = 'right' | 'down' | 'left' | 'up';

const STEP_INFO: Record<Step, { dc: number; dr: number; axis: Direction; currentFirst: boolean }> = {
  right: { dc: 1, dr: 0, axis: 'h', currentFirst: true },
  left: { dc: -1, dr: 0, axis: 'h', currentFirst: false },
  down: { dc: 0, dr: 1, axis: 'v', currentFirst: true },
  up: { dc: 0, dr: -1, axis: 'v', currentFirst: false },
};

/** Clockwise / counter-clockwise turns off a heading (90° in grid space). */
const TURN_CW: Record<Step, Step> = { right: 'down', down: 'left', left: 'up', up: 'right' };
const TURN_CCW: Record<Step, Step> = { right: 'up', up: 'left', left: 'down', down: 'right' };

/** True iff placing `next` after `current` along `step` satisfies the profile-join contract. */
function stepJoins(grammar: EngineGrammar, current: Placement, next: Placement, step: Step): boolean {
  const { axis, currentFirst } = STEP_INFO[step];
  return currentFirst
    ? placementsJoin(grammar, current, next, axis)
    : placementsJoin(grammar, next, current, axis);
}

function placeRun(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  template: Template,
  diag: SampleDiagnostics,
): boolean {
  const targetLength = MINED_LENGTH_TEMPLATES.has(template.id)
    ? drawRunTargetLength(grammar, rng)
    : rng.int(2, 3);
  const serpentine = SERPENTINE_TEMPLATES.has(template.id);

  const starts = cells
    .filter(cell => cell.kind === undefined && (isFree(cells, cell.col + 1, cell.row) || isFree(cells, cell.col, cell.row + 1)))
    .sort(compareCells);
  if (starts.length === 0) return false;

  const start = weightedChoice(
    rng,
    starts.map(cell => ({ value: cell, weight: 1, sortKey: positionKey(cell) })),
  );

  // Seed the run with a two-cell placement in a free adjacent direction. The
  // sampler's observed-pair tables are keyed on axis ('h'/'v'), so choose an
  // available axis (right or down from the start), then keep growing.
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

    // Start recording the run path: seed pair in order [start, next].
    const runPath: [number, number][] = [[start.col, start.row], [next.col, next.row]];

    let heading: Step = dir === 'h' ? 'right' : 'down';
    const grown = serpentine
      ? growSerpentine(cells, grammar, rng, workingSet, next, pair[1], ink, heading, targetLength, diag, runPath)
      : growStraight(cells, grammar, rng, workingSet, next, pair[1], ink, dir, targetLength, diag, runPath);
    void grown;
    diag.runPaths.push(runPath);
    return true;
  }

  return false;
}

/** Old short straight growth (the rhythm-template fallback path). */
function growStraight(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  seedCell: DraftCell,
  seedPlacement: Placement,
  ink: string,
  dir: Direction,
  targetLength: number,
  diag: SampleDiagnostics,
  runPath: [number, number][],
): number {
  let currentCell = seedCell;
  let currentPlacement = seedPlacement;
  let length = 2;
  while (length < targetLength) {
    const candidate = dir === 'h'
      ? maybeCellAt(cells, currentCell.col + 1, currentCell.row)
      : maybeCellAt(cells, currentCell.col, currentCell.row + 1);
    if (!candidate || candidate.kind !== undefined || candidate.ground === ink) break;
    const placement = drawNextRunPlacement(grammar, rng, workingSet, currentPlacement, dir, diag);
    if (!placement) break;
    assignTile(candidate, placement, ink);
    runPath.push([candidate.col, candidate.row]);
    currentCell = candidate;
    currentPlacement = placement;
    length += 1;
  }
  return length;
}

/**
 * Serpentine growth. At each step draw a heading among {continue, turn-cw,
 * turn-ccw} weighted {0.6, 0.2, 0.2}; try them in that drawn preference order.
 * A step is taken only into a free in-bounds cell whose ground differs from the
 * ink and whose candidate placement satisfies the profile-join contract on the
 * step's axis (with the correct current/candidate ordering). If the drawn
 * heading is blocked, fall through to the other headings before stopping.
 */
function growSerpentine(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  seedCell: DraftCell,
  seedPlacement: Placement,
  ink: string,
  seedHeading: Step,
  targetLength: number,
  diag: SampleDiagnostics,
  runPath: [number, number][],
): number {
  let currentCell = seedCell;
  let currentPlacement = seedPlacement;
  let heading = seedHeading;
  let length = 2;

  while (length < targetLength) {
    const order = drawHeadingOrder(rng, heading);
    let advanced = false;
    for (const step of order) {
      const { dc, dr } = STEP_INFO[step];
      const candidate = maybeCellAt(cells, currentCell.col + dc, currentCell.row + dr);
      if (!candidate || candidate.kind !== undefined || candidate.ground === ink) continue;
      const placement = drawSerpentineStep(grammar, rng, workingSet, currentPlacement, step, diag);
      if (!placement) continue;
      assignTile(candidate, placement, ink);
      runPath.push([candidate.col, candidate.row]);
      currentCell = candidate;
      currentPlacement = placement;
      heading = step;
      length += 1;
      advanced = true;
      break;
    }
    if (!advanced) break;
  }
  return length;
}

/** Ordered heading preference for one serpentine step (continue / cw / ccw). */
function drawHeadingOrder(rng: Rng, heading: Step): Step[] {
  const options: Weighted<Step>[] = [
    { value: heading, weight: SERPENTINE_CONTINUE_WEIGHT, sortKey: 'a-continue' },
    { value: TURN_CW[heading], weight: SERPENTINE_TURN_WEIGHT, sortKey: 'b-cw' },
    { value: TURN_CCW[heading], weight: SERPENTINE_TURN_WEIGHT, sortKey: 'c-ccw' },
  ];
  const order: Step[] = [];
  let remaining = options;
  while (remaining.length > 0) {
    const picked = weightedChoice(rng, remaining);
    order.push(picked);
    remaining = remaining.filter(entry => entry.value !== picked);
  }
  return order;
}

/** Draw the next placement for a serpentine step, honoring the join contract on the step's axis. */
function drawSerpentineStep(
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  current: Placement,
  step: Step,
  diag: SampleDiagnostics,
): Placement | null {
  const { axis, currentFirst } = STEP_INFO[step];
  const working = new Set(workingSet);
  const table = axis === 'h' ? grammar.stats.adjacency.horizontal : grammar.stats.adjacency.vertical;
  const entries: Weighted<Placement>[] = [];

  if (currentFirst) {
    // current → candidate: read observed out-edges from the current placement.
    const outs = table[placementKey(current)] ?? {};
    for (const toKey of Object.keys(outs).sort()) {
      const to = parsePlacementKey(toKey);
      if (!to || !working.has(to.tile)) continue;
      if (!stepJoins(grammar, current, to, step)) continue;
      entries.push({ value: to, weight: outs[toKey] ?? 0, sortKey: toKey });
    }
  } else {
    // candidate → current: read observed in-edges that lead into the current placement.
    const currentKey = placementKey(current);
    for (const fromKey of Object.keys(table).sort()) {
      const from = parsePlacementKey(fromKey);
      if (!from || !working.has(from.tile)) continue;
      const weight = table[fromKey]?.[currentKey] ?? 0;
      if (weight <= 0) continue;
      if (!stepJoins(grammar, current, from, step)) continue;
      entries.push({ value: from, weight, sortKey: fromKey });
    }
  }

  if (entries.length > 0) {
    diag.adjacencyHits += 1;
    return weightedChoice(rng, entries);
  }

  // Fallback: same tile, flipped, joined across the seam (mirrors the straight path).
  diag.adjacencyFallbacks += 1;
  const flipped: Placement = { tile: current.tile, rotation: current.rotation, flip: !current.flip };
  if (working.has(flipped.tile) && stepJoins(grammar, current, flipped, step)) return flipped;
  return null;
}

/** Target run length drawn from the mined form-size distribution (sizes ≥ 2). */
function drawRunTargetLength(grammar: EngineGrammar, rng: Rng): number {
  const sizes = grammar.stats.forms.sizes;
  const entries = Object.keys(sizes)
    .map(key => ({ key, size: Number(key) }))
    .filter(({ size }) => Number.isFinite(size) && size >= 2)
    .sort((a, b) => a.size - b.size)
    .map(({ key, size }) => ({ value: size, weight: sizes[key] ?? 0, sortKey: String(size).padStart(3, '0') }));
  if (entries.length === 0) return rng.int(2, 3);
  return weightedChoice(rng, entries);
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
  // Figures span 2–6 cells for most templates, drawn from the template's
  // figureShare range × 18 and clamped to [2, 6]. figure-field allows up to 9
  // cells (3×3 max region) to enable hero upscale placement.
  const heroCap = template.id === 'figure-field' ? 9 : 6;
  const maxCells = Math.min(heroCap, Math.floor(template.spec.figureShare[1] * CELL_COUNT + EPS));
  const minCells = Math.max(2, Math.ceil(template.spec.figureShare[0] * CELL_COUNT - EPS));
  if (maxCells < minCells) return 0;
  if (knobs.figures !== true && !rng.chance(0.55)) return 0;
  return rng.int(minCells, maxCells);
}

function placeFigure(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  size: number,
  knobAccent: string | undefined,
  figures: readonly FigureAsset[],
  templateId = '',
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
    const region = growConnectedRegion(cells, rng, start, size, templateId);
    if (region.length < size) continue;
    const ink = chooseAccent(grammar, rng, new Set(region.map(cell => cell.ground)), knobAccent);
    if (!ink) continue;
    const bounds = figureRegionBounds(region);
    if (!regionCoversBounds(region, bounds)) continue;
    const anchor = region.find(cell => cell.col === bounds.col && cell.row === bounds.row);
    const asset = anchor ? chooseFigureAsset(figures, bounds.w, bounds.h, rng) : undefined;
    for (const cell of region) {
      cell.kind = 'freeform';
      cell.ink = ink;
      cell.inks = [ink];
    }
    if (anchor && asset) {
      anchor.figureId = asset.id;
      anchor.figureAnchor = true;
      anchor.figureSpan = [bounds.w, bounds.h];
    }
    return true;
  }

  return false;
}

function figureRegionBounds(region: DraftCell[]): { col: number; row: number; w: number; h: number } {
  let minCol = COLS;
  let minRow = ROWS;
  let maxCol = 0;
  let maxRow = 0;
  for (const cell of region) {
    minCol = Math.min(minCol, cell.col);
    minRow = Math.min(minRow, cell.row);
    maxCol = Math.max(maxCol, cell.col);
    maxRow = Math.max(maxRow, cell.row);
  }
  return {
    col: minCol,
    row: minRow,
    w: maxCol - minCol + 1,
    h: maxRow - minRow + 1,
  };
}

function regionCoversBounds(
  region: DraftCell[],
  bounds: { col: number; row: number; w: number; h: number },
): boolean {
  if (region.length !== bounds.w * bounds.h) return false;
  const positions = new Set(region.map(positionKey));
  for (let row = bounds.row; row < bounds.row + bounds.h; row += 1) {
    for (let col = bounds.col; col < bounds.col + bounds.w; col += 1) {
      if (!positions.has(`${col},${row}`)) return false;
    }
  }
  return true;
}

function chooseFigureAsset(
  figures: readonly FigureAsset[],
  regionW: number,
  regionH: number,
  rng: Rng,
): FigureAsset | undefined {
  // Candidate pool: exact(k=1) ∪ upscaled(k≥2) ∪ fits-within.
  // An asset (w, h) qualifies at integer scale k when regionW===k*w && regionH===k*h.
  // Upscaled candidates (k≥2) are weighted 2× their base weight (hero bias).
  // figureSpan is set to the REGION size, so the renderer scales automatically.
  interface Candidate { asset: FigureAsset; k: number }
  const candidateEntries: Array<Weighted<Candidate>> = [];
  const addedIds = new Set<string>();

  for (const asset of [...figures].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const baseWeight = 1 / (Math.abs(asset.inkShare - 0.4) + EPS);
    // Integer-scale candidates (k≥1)
    for (let k = 1; k * asset.w <= regionW && k * asset.h <= regionH; k += 1) {
      if (k * asset.w === regionW && k * asset.h === regionH) {
        const heroBias = k >= 2 ? 2 : 1;
        candidateEntries.push({
          value: { asset, k },
          weight: baseWeight * heroBias,
          sortKey: `${asset.id}@${k}`,
        });
        addedIds.add(`${asset.id}@${k}`);
      }
    }
  }

  // fits-within fallback (if no exact/upscale match)
  if (candidateEntries.length === 0) {
    for (const asset of [...figures].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      if (asset.w <= regionW && asset.h <= regionH) {
        const baseWeight = 1 / (Math.abs(asset.inkShare - 0.4) + EPS);
        candidateEntries.push({
          value: { asset, k: 1 },
          weight: baseWeight,
          sortKey: `${asset.id}@1`,
        });
      }
    }
  }

  if (candidateEntries.length === 0) return undefined;
  return weightedChoice(rng, candidateEntries).asset;
}

/**
 * Grow a connected region of `size` cells from `start`.
 *
 * For the 'figure-field' template, a 60/40 rectangular bias is applied at each
 * step: cells that keep the region's area equal to its bounding-box area (i.e.
 * the region stays a perfect rectangle) are weighted 3× those that would
 * introduce a ragged protrusion.  This matches the canonical hero-region shape
 * that enables integer upscale matching (e.g. a 2×2 region can host a 1×1
 * asset at k=2).  Other templates use uniform weighting (existing behaviour).
 */
function growConnectedRegion(cells: DraftCell[], rng: Rng, start: DraftCell, size: number, templateId = ''): DraftCell[] {
  const figureField = templateId === 'figure-field';
  const region = [start];
  const selected = new Set([positionKey(start)]);
  while (region.length < size) {
    const frontier = region
      .flatMap(cell => neighbors(cells, cell))
      .filter(cell => cell.kind === undefined && !selected.has(positionKey(cell)))
      .sort(compareCells);
    if (frontier.length === 0) break;

    let entries: Weighted<DraftCell>[];
    if (figureField) {
      // Compute current bounding box + area
      const curBounds = figureRegionBounds(region);
      const curBboxArea = curBounds.w * curBounds.h;
      const curIsRect = region.length === curBboxArea;

      entries = frontier.map(cell => {
        // Would adding this cell keep the region rectangular?
        const newBounds = figureRegionBoundsWithExtra(curBounds, cell);
        const newBboxArea = newBounds.w * newBounds.h;
        const wouldBeRect = (region.length + 1) === newBboxArea;
        // 60/40 bias: rectangular steps get 3× weight, ragged steps get 1×
        // (3:1 ratio = 75% rect / 25% ragged, strong rectangular preference; the plan's 60/40 was a soft target)
        const rectWeight = curIsRect ? 3 : 1;
        return {
          value: cell,
          weight: wouldBeRect ? rectWeight : 1,
          sortKey: positionKey(cell),
        };
      });
    } else {
      entries = frontier.map(cell => ({ value: cell, weight: 1, sortKey: positionKey(cell) }));
    }

    const next = weightedChoice(rng, entries);
    region.push(next);
    selected.add(positionKey(next));
  }
  return region;
}

/** Compute bounding box of `region` with one extra cell added (no mutation). */
function figureRegionBoundsWithExtra(
  existing: { col: number; row: number; w: number; h: number },
  extra: DraftCell,
): { col: number; row: number; w: number; h: number } {
  const minCol = Math.min(existing.col, extra.col);
  const minRow = Math.min(existing.row, extra.row);
  const maxCol = Math.max(existing.col + existing.w - 1, extra.col);
  const maxRow = Math.max(existing.row + existing.h - 1, extra.row);
  return { col: minCol, row: minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
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
  for (const c of cells) if (c.kind === 'freeform') inZone.add(c);
  for (const c of cells) {
    if (c.kind === 'plain' || inZone.has(c)) continue;
    if (c.ink && accentSet.has(c.ink)) {
      const ink = neutralForGround(c.ground);
      c.ink = ink; c.inks = [ink];
    }
  }
}

const NEUTRAL_INKS_SET = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);

/**
 * splitRhythmRuns — cap run-form length on the rhythm templates.
 *
 * The rhythm templates' canon is rhythm, not serpents: their fill can still
 * chain a long connected same-ink tile block (which detectForms reports as one
 * big 'run' form). This pass re-inks a minimal set of interior tile cells of any
 * over-cap same-ink connected component to a contrasting neutral, breaking the
 * same-ink join without touching tile geometry, kind, rotation, flip, ground,
 * distinctTiles, plainShare, or figureShare — ink-only, so lineworkShare (a
 * family metric) is untouched too. No-op on the serpentine / mined-length
 * templates, which are allowed their long runs.
 */
function splitRhythmRuns(cells: DraftCell[], grammar: EngineGrammar, template: Template): void {
  if (!RHYTHM_TEMPLATES.has(template.id)) return;

  // Measure runs exactly as detectForms will (union over rules a/c/d), find the
  // largest run form over the cap, and re-ink its highest-degree member to break
  // its joins. Each pass strictly removes one cell from the offending run, so the
  // loop terminates (bounded by cell count).
  for (let guard = 0; guard < CELL_COUNT; guard += 1) {
    const runs = detectRunGroups(cells, grammar);
    const worst = runs.filter(group => group.length > RHYTHM_RUN_CAP).sort((a, b) => b.length - a.length)[0];
    if (!worst) return;
    const positions = new Set(worst.map(positionKey));
    const target = pickSplitCell(worst.map(c => cells[indexFor(c.col, c.row)]!), positions);
    const replacement = splitInk(target, cells);
    target.ink = replacement;
    target.inks = [replacement];
  }
}

/**
 * Connected run groups over the current draft cells, mirroring detectForms'
 * union rules for run membership: rule (a) same-ink + active shared edges,
 * rule (c) same-tile-same-rotation-same-ink frieze pairs (row-adjacent, no edge
 * requirement), and rule (d) inverted ink/ground + active shared edges.
 */
function detectRunGroups(cells: DraftCell[], grammar: EngineGrammar): DraftCell[][] {
  const tileCells = cells.filter(cell => cell.kind === 'tile' && cell.tile && cell.ink).sort(compareCells);
  const seen = new Set<string>();
  const groups: DraftCell[][] = [];
  for (const start of tileCells) {
    if (seen.has(positionKey(start))) continue;
    const group: DraftCell[] = [];
    const stack = [start];
    seen.add(positionKey(start));
    while (stack.length > 0) {
      const cur = stack.pop()!;
      group.push(cur);
      for (const n of tileCells) {
        if (seen.has(positionKey(n))) continue;
        if (Math.abs(n.col - cur.col) + Math.abs(n.row - cur.row) !== 1) continue;
        if (runJoin(grammar, cur, n)) {
          seen.add(positionKey(n));
          stack.push(n);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/**
 * Do two placed tile cells join as a run under detectForms? Rule (a): same ink
 * + both shared edges active (≥ 0.25). Rule (c): same tile+rotation+ink,
 * row-adjacent (no edge requirement). Rule (d): inverted ink/ground + active
 * edges. Any of the three unions them into one run group.
 */
function runJoin(grammar: EngineGrammar, a: DraftCell, b: DraftCell): boolean {
  if (!a.tile || !b.tile) return false;
  const dir: Direction = a.row === b.row ? 'h' : 'v';
  // Rule (c): same-tile-same-rotation-same-ink frieze pair (horizontal only).
  if (
    dir === 'h' &&
    a.tile === b.tile &&
    (a.rotation ?? 0) === (b.rotation ?? 0) &&
    a.ink && a.ink === b.ink
  ) {
    return true;
  }
  const sameInk = a.ink === b.ink;
  const inverted = a.ink === b.ground && a.ground === b.ink;
  if (!sameInk && !inverted) return false;
  const [first, second] = dir === 'h'
    ? (a.col < b.col ? [a, b] : [b, a])
    : (a.row < b.row ? [a, b] : [b, a]);
  const eFirst = orientEdges(grammar.tileCatalog[first!.tile!]?.edges ?? ZERO_EDGES, (first!.rotation ?? 0) as Rotation, first!.flip ?? false);
  const eSecond = orientEdges(grammar.tileCatalog[second!.tile!]?.edges ?? ZERO_EDGES, (second!.rotation ?? 0) as Rotation, second!.flip ?? false);
  const covFirst = dir === 'h' ? eFirst.right : eFirst.bottom;
  const covSecond = dir === 'h' ? eSecond.left : eSecond.top;
  return covFirst >= 0.25 && covSecond >= 0.25;
}

const ZERO_EDGES = { top: 0, right: 0, bottom: 0, left: 0 };

/** Pick the split target: the member with the most in-group neighbors (ties → row-major). */
function pickSplitCell(group: DraftCell[], positions: Set<string>): DraftCell {
  return [...group]
    .sort(compareCells)
    .reduce((best, cell) => {
      const degree = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .filter(([dc, dr]) => positions.has(`${cell.col + dc!},${cell.row + dr!}`)).length;
      const bestDegree = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .filter(([dc, dr]) => positions.has(`${best.col + dc!},${best.row + dr!}`)).length;
      return degree > bestDegree ? cell : best;
    }, group[0]!);
}

/**
 * A neutral ink that breaks the target's run joins to all its component
 * neighbors: distinct from the run ink (kills rule-a) and never equal to a
 * neighbor's ground (kills rule-d), while still contrasting the target's ground.
 */
function splitInk(target: DraftCell, cells: DraftCell[]): string {
  const tileNeighbors = neighbors(cells, target).filter(n => n.kind === 'tile');
  const neighborGrounds = tileNeighbors.map(n => n.ground);
  const neighborInks = tileNeighbors.map(n => n.ink ?? '');
  const forbidden = new Set<string>([target.ground, target.ink ?? '', ...neighborGrounds, ...neighborInks]);
  for (const ink of NEUTRAL_PREFS) {
    if (!forbidden.has(ink)) return ink;
  }
  // Fall back to any neutral that at least contrasts the target's ground.
  for (const ink of NEUTRAL_PREFS) {
    if (ink !== target.ground) return ink;
  }
  return neutralForGround(target.ground);
}

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

/**
 * placementsJoin — the edge-profile continuity contract. `a`'s trailing edge
 * (right for 'h', bottom for 'v') must meet `b`'s leading edge (left for 'h',
 * top for 'v'): both edges active (coverage ≥ 0.25) and, when v2 profiles are
 * present, their line-work lining up (profile IoU ≥ PROFILE_JOIN_MIN). Exported
 * for the scale test's continuity-integrity check.
 */
export function placementsJoin(grammar: EngineGrammar, a: Placement, b: Placement, dir: Direction): boolean {
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

// ---------------------------------------------------------------------------
// rezone — public API helper: re-apply accent zoning only, geometry frozen
// ---------------------------------------------------------------------------

/**
 * Deep-copy `plan` and re-run ONLY `applyAccentZoning` + `enforceAccentBudget`
 * with `accent` as the forced knob. Cell geometry (tile/rotation/flip) is
 * identical to the input; only inks/grounds may change.
 *
 * @param plan    - Source plan (must have been produced by samplePlan / sampleWithDiagnostics).
 * @param grammar - The engine grammar the plan was sampled from.
 * @param seed    - The original seed (used to replay the RNG state for accent zoning).
 * @param accent  - The new accent color to apply.
 */
export function rezone(plan: BannerPlan, grammar: EngineGrammar, seed: number, accent: string): BannerPlan {
  // Deep-copy the plan (cells carry inks/grounds that will be mutated).
  const cells: DraftCell[] = plan.cells.map(c => ({ ...c }));

  // Seed a DEDICATED RNG from (plan seed folded with the accent string's hash):
  // each distinct accent gets a reproducible but independent zone shape. Note
  // this is NOT the plan's original stream advanced past geometry — it is a
  // separate stream entirely (review 2026-07-02 flagged the earlier wording).
  const accentHash = [...accent].reduce((h, ch) => ((h * 31 + ch.charCodeAt(0)) & 0xffffffff), seed);
  const rng = mulberry32(accentHash >>> 0);

  // Find the template so applyAccentZoning has the template.id check.
  const template = grammar.templates.find(t => t.id === plan.templateId) ??
    grammar.templates.find(t => t.bannerIds.length > 0) ??
    grammar.templates[0];
  if (!template) throw new Error('rezone: grammar has no templates');

  const diag: SampleDiagnostics = {
    adjacencyHits: 0,
    accentZone: 'none',
    adjacencyFallbacks: 0,
    fillAdjacencyHits: 0,
    friezesPlaced: 0,
    longestRun: 0,
    runPaths: [],
  };

  const knobs: SampleKnobs = { accent };
  applyAccentZoning(cells, grammar, rng, template, knobs, diag);
  enforceAccentBudget(cells, grammar);

  const finalCells = finalizeCells(cells);
  return {
    ...plan,
    cells: finalCells,
    // Re-run forms to reflect any ink changes.
    forms: (() => {
      const tmp: BannerPlan = { ...plan, cells: finalCells, forms: [] };
      return detectForms(tmp, grammar.tileCatalog, FAMILIES);
    })(),
  };
}
