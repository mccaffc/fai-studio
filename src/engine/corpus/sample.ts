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
 * 9. optional mirror symmetry after post-fill forms are known
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

const ACCENT_POOL_HEXES = ['#FF4F00', '#FFA300', '#7150D6', '#0E8C88', '#268B41', '#4997D0', '#C8102E'] as const;
function isAllowedExplicitAccent(accent: string, order: readonly string[]): boolean {
  return order.includes(accent) || (ACCENT_POOL_HEXES as readonly string[]).includes(accent);
}

import type {
  ArrangementId,
  BannerPlan,
  CellPlan,
  EngineGrammar,
  FormGroup,
  GroundSchemeKind,
  SampleKnobs,
  Template,
  VariantKey,
} from './types.js';
import { ARRANGEMENTS, IDENTITY_ACCENT_STRENGTH } from './types.js';
import { detectForms, orientEdges } from './forms.js';
import { profileIoU } from './profiles.js';
import { mulberry32, type Rng } from './rng.js';
import { TILES } from './data/tiles.js';
import { FIGURES, type FigureAsset } from './data/figures.js';
import { PATCHES, type IconicPatch, type PatchCell, type PatchGroundRole, type PatchInkRole } from './data/patches.js';
import { lumRatio, relativeLuminance } from './programs.js';

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
  /** Program-agnostic counter: requested family floor had no mapped candidates. */
  familyFloorMisses: number;
  /** Shape family drawn before working-set selection. */
  dominantFamily: string;
  /** Mode of the FIRST accent zone at placement time. Not recomputed by later
   *  passes (mirror/budget can remove or reshape zones); only the accent COUNT
   *  is re-synced — treat this as a placement diagnostic, not final-plan truth. */
  accentZone: 'ink' | 'ground' | 'figure' | 'none';
  accentZonesPlaced: number;
  accentsUsed: string[];
  accentWarmSide?: 'left' | 'right';
  adjacencyFallbacks: number;
  fillAdjacencyHits: number;
  friezesPlaced: number;
  patchesPlaced: number;
  mirrored: boolean;
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

type FamilyBias = NonNullable<SampleKnobs['familyBias']>;
type TemplateBias = NonNullable<SampleKnobs['templateBias']>;
type FamilyFloor = NonNullable<SampleKnobs['familyFloor']>;

const CELL_PX = 320;
const BANNER_CELL_COUNT = ARRANGEMENTS.banner.cols * ARRANGEMENTS.banner.rows;
const SOURCE_STAT_MAX_COL = ARRANGEMENTS.banner.cols - 1;
const SOURCE_STAT_MAX_ROW = ARRANGEMENTS.banner.rows - 1;
const EPS = 1e-9;
const DOMINANT_FAMILY_QUOTA = 0.18;
const LINEWORK_STEERING_STRENGTH = 1;
// Shipped NEUTRAL (0 = uniform draw over the template's distinctTiles range).
// The hook is the seam for steering rhythmQuality toward the canon p50 (0.595);
// every non-zero value tried in P6 broke figure/patch/multi-accent/template
// gates, so steering waits for a calibration pass that can move those together.
const FILL_VARIETY_STEERING_STRENGTH = 0;

// --- Serpentine run growth (P2 Task 2) ------------------------------------
// The connected-surface templates grow canon-length runs that TURN CORNERS
// (target length drawn from the mined form-size distribution). The rhythm
// templates keep the previous short straight growth. figure-field/mixed-quilt
// use mined-length targets but straight growth (no turns).
const SERPENTINE_TEMPLATES = new Set(['pipe-field', 'arc-mosaic']);
const MINED_LENGTH_TEMPLATES = new Set(['pipe-field', 'arc-mosaic', 'figure-field', 'mixed-quilt']);
const PHRASE_COMPLETION_WEIGHT = 2;
const PHRASE_TEMPLATES = new Set(['arc-mosaic', 'checker-motif', 'pipe-field', 'repeat-rhythm']);
// Direction-draw weights at each serpentine step: keep straight most of the
// time, turn either way a fifth of the time each.
const SERPENTINE_CONTINUE_WEIGHT = 0.6;
const SERPENTINE_TURN_WEIGHT = 0.2;
// The rhythm templates must never carry a run form longer than this after
// fill (their canon is rhythm, not serpents). A post-fill splitter re-inks a
// minimal interior cell of any longer same-ink run to break the join.
const RHYTHM_RUN_CAP = 6;
const RHYTHM_TEMPLATES = new Set(['repeat-rhythm', 'checker-motif']);
// P10 Law 2 baseline (seeds 80000..80199, 6x3 auto): focal center-cell share
// was 76/199 = 38.2%, below the canon band of 45-65%. These multipliers steer
// existing form/figure/patch anchor draws toward center-cell focal centroids.
const FOCAL_CENTER_ANCHOR_WEIGHT = 5;
const FOCAL_NEAR_CENTER_ANCHOR_WEIGHT = 2;

// P6 Task 1 mirror calibration from corpus/corpus.json, pair-match metric
// tile+ink >= 70% across (c,r)/(cols-1-c,r) pairs:
// 024 figure-field 1.000; 029 figure-field 1.000; 031 repeat-rhythm 1.000;
// 037 figure-field 1.000; 038 repeat-rhythm 1.000; 039 pipe-field 1.000;
// 048 pipe-field 1.000; 005 pipe-field 0.889; 008 pipe-field 0.889;
// 036 figure-field 0.889; 050 mixed-quilt 0.889; 028 arc-mosaic 0.778.
// Eligible templates: arc-mosaic, figure-field, mixed-quilt, pipe-field,
// repeat-rhythm. checker-motif had no >=70% canon near-mirror exemplar.
// Single probability draw; deterministic rollbacks below pull the accepted
// output rate back into the canon 24% band.
// P10 Law 2 focal anchor steering slightly reduces mirror acceptance. Raising
// the proposal rate preserves the shipped 24% +/- 8% accepted mirror band.
const MIRROR_RATE = 0.55;
const MIRROR_TEMPLATE_IDS = new Set(['arc-mosaic', 'figure-field', 'mixed-quilt', 'pipe-field', 'repeat-rhythm']);
const MIRROR_MAX_BLACK_INK_SHARE = 0.85;

const CORPUS_GROUND_FILLS = new Set([
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

const ACCENT_POOL: readonly Weighted<string>[] = [
  { value: '#FF4F00', weight: 2, sortKey: '00-#FF4F00' },
  { value: '#FFA300', weight: 1, sortKey: '01-#FFA300' },
  { value: '#7150D6', weight: 1, sortKey: '02-#7150D6' },
  { value: '#0E8C88', weight: 1, sortKey: '03-#0E8C88' },
  { value: '#268B41', weight: 1, sortKey: '04-#268B41' },
  { value: '#4997D0', weight: 1, sortKey: '05-#4997D0' },
  { value: '#C8102E', weight: 1, sortKey: '06-#C8102E' },
] as const;
const ACCENT_POOL_SET = new Set<string>(ACCENT_POOL_HEXES);

interface AccentRequest {
  forcedAccent?: string;
  poolChoices?: readonly Weighted<string>[];
  poolAccents: readonly string[];
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
  patchId?: string;
  patchInkRole?: PatchInkRole;
  patchSpan?: [number, number];
}

interface Placement {
  tile: string;
  rotation: Rotation;
  flip: boolean;
}

interface GridDims {
  cols: number;
  rows: number;
  cellCount: number;
}

interface RelativeGridStats {
  plainPositionWeights: Record<string, number>;
  friezeRowWeights: Record<string, number>;
}

export function samplePlan(
  grammar: EngineGrammar,
  seed: number,
  knobs: SampleKnobs = {},
  figures: readonly FigureAsset[] = FIGURES,
  patches: readonly IconicPatch[] = PATCHES,
): BannerPlan {
  return sampleWithDiagnostics(grammar, seed, knobs, figures, patches).plan;
}

export function sampleWithDiagnostics(
  grammar: EngineGrammar,
  seed: number,
  knobs: SampleKnobs = {},
  figures: readonly FigureAsset[] = FIGURES,
  patches: readonly IconicPatch[] = PATCHES,
): SampleResult {
  const accentRequest = resolveAccentRequest(knobs, grammar.palette.accentOrder);
  const requestedAccentStrength = validateAccentStrength(knobs.accentStrength);
  const accentStrength = accentRequestUsesStrength(accentRequest) ? requestedAccentStrength : IDENTITY_ACCENT_STRENGTH;
  const diag: SampleDiagnostics = {
    adjacencyHits: 0,
    familyFloorMisses: 0,
    dominantFamily: '',
    accentZone: 'none',
    accentZonesPlaced: 0,
    accentsUsed: [],
    adjacencyFallbacks: 0,
    fillAdjacencyHits: 0,
    friezesPlaced: 0,
    patchesPlaced: 0,
    mirrored: false,
    longestRun: 0,
    runPaths: [],
  };
  const rng = mulberry32(seed);
  const dims = dimsForArrangement(knobs.arrangement);
  const relativeStats = relativeGridStats(grammar, dims);
  const template = chooseTemplate(grammar, rng, knobs.template, knobs.templateBias);
  const globalGround = drawGlobalGround(grammar, rng);
  const groundScheme = drawGroundScheme(grammar, template, rng);
  const cells = makeDraftCells(generateGrounds(grammar, rng, groundScheme, globalGround, dims), dims);

  const dominantFamily = drawDominantFamily(grammar, template, rng, knobs.familyBias);
  diag.dominantFamily = dominantFamily;
  // shapeEmphasis scales how hard the dominant family carries the working set
  // — resolved AFTER the dominant draw so the slider changes carry, not which
  // family wins. Undefined (or exactly 0.5) leaves every path byte-identical.
  const emphasis = resolveShapeEmphasis(knobs, dominantFamily);
  let targetDistinct = Math.min(dims.cellCount, drawFillVarietyTarget(template.spec.distinctTiles, rng));
  if (dims.cellCount > 0 && template.spec.distinctTiles[1] > 0 && targetDistinct === 0) {
    targetDistinct = 1;
  }
  let workingSet = selectWorkingSet(grammar, rng, template, dominantFamily, targetDistinct, emphasis.familyBias, emphasis.familyFloor, diag, emphasis.quotaShare);
  if (workingSet.length === 0) {
    workingSet = selectWorkingSet(grammar, rng, template, firstAvailableFamily(grammar), 1, emphasis.familyBias, emphasis.familyFloor, diag, emphasis.quotaShare);
  }
  targetDistinct = workingSet.length;

  const friezeCount = scaleFormCount(drawIntegerRange(template.spec.forms.frieze, rng), dims);
  placeFriezes(cells, grammar, rng, workingSet, friezeCount, relativeStats, diag);

  const rawRunCount = drawIntegerRange(template.spec.forms.run, rng);
  const bannerRunCount = template.spec.forms.run[1] > 0 ? Math.max(1, rawRunCount) : 0;
  const runCount = scaleFormCount(bannerRunCount, dims);
  for (let i = 0; i < runCount; i += 1) {
    placeRun(cells, grammar, rng, workingSet, template, diag);
  }

  const figureSize = plannedFigureSize(template, knobs, rng, dims);
  if (figureSize > 0) {
    const placedPatch = shouldPlacePatch(template.id, rng)
      ? placePatch(cells, grammar, rng, accentRequest.forcedAccent, patches, globalGround, diag)
      : false;
    if (!placedPatch) {
      placeFigure(cells, grammar, rng, figureSize, accentRequest.forcedAccent, figures, dims, template.id);
    }
  }

  const usedTiles = usedTileSet(cells);
  const emptyBeforePlain = cells.filter(cell => cell.kind === undefined).length;
  const requiredTileCells = Math.max(0, targetDistinct - usedTiles.size);
  const basePlainTarget = plainTargetCount(template, knobs.density ?? 0.5, dims);
  const requiredAccentCells = accentRequest.poolChoices
    ? Math.min(dims.cellCount, accentRequest.poolAccents.length)
    : 0;
  const maxPlainForAccentPool = dims.cellCount - requiredAccentCells;
  const plainTarget = Math.max(0, Math.min(basePlainTarget, emptyBeforePlain - requiredTileCells, maxPlainForAccentPool));
  placePlainCells(cells, relativeStats, rng, plainTarget);

  fillTileCells(cells, grammar, rng, workingSet, template, diag);
  const accentBudgetCap = accentBudgetCapForRequest(accentRequest, accentStrength);
  applyAccentZoning(cells, grammar, rng, template, accentRequest, diag, accentStrength);
  enforceAccentBudget(cells, grammar, accentRequest.forcedAccent, accentBudgetCap);
  if (accentRequest.forcedAccent) ensureAccentPresence(cells, grammar, rng, accentRequest.forcedAccent);
  // Run last: cap rhythm-template run length AFTER every ink mutation, so the
  // accent passes can't re-merge a split run.
  splitRhythmRuns(cells, grammar, template, dims);
  splitNoSpineRunForms(cells, grammar, dims);
  splitRhythmRuns(cells, grammar, template, dims);
  applyLogomarkGuard(cells);
  syncAccentDiagnostics(cells, grammar, accentRequest.forcedAccent, diag);
  // P6 mirror runs after the full current post-fill pipeline, including the
  // first form detection pass. If accepted, only the accent budget and forms
  // are recomputed; zoning is intentionally not re-run against mirrored ink.
  void detectForms(draftPlanForForms(cells, dims), grammar.tileCatalog, FAMILIES);
  applyMirror(cells, grammar, dims, rng, template, accentRequest.forcedAccent, diag, accentBudgetCap, accentSurvivors(accentRequest));
  if (diag.mirrored) {
    syncAccentDiagnostics(cells, grammar, accentRequest.forcedAccent, diag);
  }
  if (accentRequest.poolChoices) {
    enforceAccentBudget(cells, grammar, accentRequest.forcedAccent, accentBudgetCap);
    ensureAccentPoolMinimum(cells, rng, accentRequest.poolChoices, minimumDistinctAccentCount(cells, accentRequest.poolAccents), accentBudgetCap);
    syncAccentDiagnostics(cells, grammar, accentRequest.forcedAccent, diag);
  }
  enforceAccentGroundContrast(cells);
  // Ground-contrast enforcement is itself an ink mutation: dark accent zones
  // (lum < DARK_GROUND_ZONE_LUMINANCE — Frontier Crimson, Iris Violet) force
  // #F3F3F3 ink, which can re-merge a same-ink run across the zone seam.
  // Re-cap after it; chooseBestSplitMutation is zone-law-aware, so these
  // splits are stable against a further enforcement pass.
  splitRhythmRuns(cells, grammar, template, dims);
  splitNoSpineRunForms(cells, grammar, dims);
  splitRhythmRuns(cells, grammar, template, dims);
  // P10 Law 1 current-sampler baseline (seeds 80000..80199, 6x3 auto):
  // isolated accent-cell share 34/1315 = 2.59% and isolated corner singletons
  // 17/200 = 0.085/banner, both inside the canon bands (1-5%, <=0.25/banner).
  // Per brief, no accent migration/suppression law is built while in band.
  // P10 Law 3 current-sampler baseline on rhythm templates in the same sample:
  // one-interrupt lines 90/333 = 27.0% and perfect lines 20/333 = 6.0%,
  // both inside canon bands (20-32%, 5-15%). No interrupt mutation is built.

  const finalCells = finalizeCells(cells);
  const plan: BannerPlan = {
    id: `sample-${seed}`,
    width: dims.cols * CELL_PX,
    height: dims.rows * CELL_PX,
    cols: dims.cols,
    rows: dims.rows,
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

function chooseTemplate(
  grammar: EngineGrammar,
  rng: Rng,
  id: string | undefined,
  templateBias?: TemplateBias,
): Template {
  if (id) {
    const found = grammar.templates.find(template => template.id === id);
    if (!found) throw new Error(`Unknown template: ${id}`);
    return found;
  }

  return weightedChoice(
    rng,
    grammar.templates.map(template => ({
      value: template,
      weight: template.bannerIds.length * templateBiasWeight(template.id, templateBias),
      sortKey: template.id,
    })),
  );
}

function dimsForArrangement(arrangement: ArrangementId | undefined): GridDims {
  const id = arrangement ?? 'banner';
  const dims = ARRANGEMENTS[id];
  if (!dims) throw new Error(`Unknown arrangement: ${String(arrangement)}`);
  return { cols: dims.cols, rows: dims.rows, cellCount: dims.cols * dims.rows };
}

function scaleFormCount(count: number, dims: GridDims): number {
  return Math.max(0, Math.round(count * (dims.cellCount / BANNER_CELL_COUNT)));
}

function relativeGridStats(grammar: EngineGrammar, dims: GridDims): RelativeGridStats {
  return {
    plainPositionWeights: relativePlainPositionWeights(grammar, dims),
    friezeRowWeights: relativeFriezeRowWeights(grammar, dims),
  };
}

/**
 * Mined plain-position stats are keyed to the source 6×3 corpus grid. Convert
 * each source key once per sample to relative coordinates:
 *   colFrac = col / 5, rowBand = row / 2,
 * then map to the nearest target cell. When several source cells collapse onto
 * one target cell (narrow grids), their weights are summed.
 */
function relativePlainPositionWeights(grammar: EngineGrammar, dims: GridDims): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sourceKey of Object.keys(grammar.stats.plain.positions).sort()) {
    const parsed = parsePositionKey(sourceKey);
    if (!parsed) continue;
    const colFrac = SOURCE_STAT_MAX_COL > 0 ? parsed.col / SOURCE_STAT_MAX_COL : 0;
    const rowBand = SOURCE_STAT_MAX_ROW > 0 ? parsed.row / SOURCE_STAT_MAX_ROW : 0;
    const col = nearestTargetIndex(colFrac, dims.cols);
    const row = nearestTargetIndex(rowBand, dims.rows);
    const targetKey = `${col},${row}`;
    out[targetKey] = (out[targetKey] ?? 0) + (grammar.stats.plain.positions[sourceKey] ?? 0);
  }
  return out;
}

/**
 * Frieze row stats are also source-grid relative: source rows 0/1/2 are treated
 * as top/middle/bottom bands and mapped to the nearest target row.
 */
function relativeFriezeRowWeights(grammar: EngineGrammar, dims: GridDims): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sourceKey of Object.keys(grammar.stats.forms.friezeRows).sort()) {
    if (!/^[0-2]$/.test(sourceKey)) continue;
    const sourceRow = Number(sourceKey);
    const rowBand = SOURCE_STAT_MAX_ROW > 0 ? sourceRow / SOURCE_STAT_MAX_ROW : 0;
    const row = nearestTargetIndex(rowBand, dims.rows);
    const targetKey = String(row);
    out[targetKey] = (out[targetKey] ?? 0) + (grammar.stats.forms.friezeRows[sourceKey] ?? 0);
  }
  return out;
}

function nearestTargetIndex(fraction: number, count: number): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(fraction * (count - 1))));
}

function parsePositionKey(value: string): { col: number; row: number } | null {
  const match = value.match(/^(\d+),(\d+)$/);
  if (!match) return null;
  return { col: Number(match[1]), row: Number(match[2]) };
}

function drawGlobalGround(grammar: EngineGrammar, rng: Rng): string {
  return drawWeightedRecord(
    grammar.palette.globalGrounds,
    rng,
    key => CORPUS_GROUND_FILLS.has(key),
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
  dims: GridDims,
): string[] {
  const grounds = Array.from({ length: dims.cellCount }, () => globalGround);
  const pool = groundPool(grammar, globalGround);

  switch (scheme) {
    case 'uniform':
      return grounds;

    case 'checker': {
      const second = drawGroundFromPool(pool, rng, new Set([globalGround]));
      forEachPosition(dims, (col, row, idx) => {
        grounds[idx] = (col + row) % 2 === 0 ? globalGround : second;
      });
      return grounds;
    }

    case 'banded-rows': {
      if (dims.rows <= 1) return grounds;
      const distinct = drawDistinctGrounds(pool, rng, Math.min(3, Math.max(2, pool.length)));
      const offset = distinct.length > 1 ? rng.int(0, distinct.length - 1) : 0;
      forEachPosition(dims, (_col, row, idx) => {
        grounds[idx] = distinct[(row + offset) % distinct.length] ?? globalGround;
      });
      return grounds;
    }

    case 'banded-cols': {
      if (dims.cols <= 1) return grounds;
      const distinct = drawDistinctGrounds(pool, rng, Math.min(3, Math.max(2, pool.length)));
      const offset = distinct.length > 1 ? rng.int(0, distinct.length - 1) : 0;
      forEachPosition(dims, (col, _row, idx) => {
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
        const rect = drawRegionRect(rng, occupied, dims);
        for (let row = rect.row; row < rect.row + rect.h; row += 1) {
          for (let col = rect.col; col < rect.col + rect.w; col += 1) {
            grounds[indexFor(dims, col, row)] = ground;
            occupied.add(`${col},${row}`);
          }
        }
      }
      return grounds;
    }

    case 'scatter': {
      forEachPosition(dims, (_col, _row, idx) => {
        if (rng.chance(0.2)) {
          grounds[idx] = drawGroundFromPool(pool, rng, new Set([globalGround]));
        }
      });
      return grounds;
    }
  }
}

function groundPool(grammar: EngineGrammar, globalGround: string): string[] {
  const fromInkTables = Object.keys(grammar.palette.inkByGround).filter(key => CORPUS_GROUND_FILLS.has(key));
  if (!fromInkTables.includes(globalGround) && CORPUS_GROUND_FILLS.has(globalGround)) {
    fromInkTables.push(globalGround);
  }
  const sorted = [...new Set(fromInkTables)].sort();
  return sorted.length > 0 ? sorted : ['#121212', '#F3F3F3'];
}

function drawGroundFromPool(pool: string[], rng: Rng, exclude = new Set<string>()): string {
  const candidates = pool.filter(ground => !exclude.has(ground)).sort();
  const usable = candidates.length > 0 ? candidates : pool.filter(ground => CORPUS_GROUND_FILLS.has(ground)).sort();
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

function drawRegionRect(rng: Rng, occupied: Set<string>, dims: GridDims): { col: number; row: number; w: number; h: number } {
  const maxW = Math.max(1, Math.min(3, dims.cols));
  const maxH = Math.max(1, Math.min(3, dims.rows));
  const minArea = Math.min(2, dims.cellCount);
  let fallback = { col: 0, row: 0, w: Math.min(2, dims.cols), h: 1 };
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const w = rng.int(1, maxW);
    const h = rng.int(1, maxH);
    const area = w * h;
    if (area < minArea || area > 6) continue;
    const col = rng.int(0, dims.cols - w);
    const row = rng.int(0, dims.rows - h);
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

function drawDominantFamily(
  grammar: EngineGrammar,
  template: Template,
  rng: Rng,
  familyBias?: FamilyBias,
): string {
  const availableFamilies = new Set(Object.values(grammar.tileCatalog).map(entry => entry.family));
  const families = template.spec.dominantFamilies
    .filter(family => availableFamilies.has(family))
    .sort();
  const candidates = families.length > 0 ? families : [...availableFamilies].sort();
  return weightedChoice(
    rng,
    candidates.map(family => ({
      value: family,
      weight: familyBias === undefined ? 1 : familyBiasWeight(family, familyBias),
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
  familyBias?: FamilyBias,
  familyFloor?: FamilyFloor,
  diag?: SampleDiagnostics,
  dominantQuotaShare: number = DOMINANT_FAMILY_QUOTA,
): string[] {
  // programOnly tiles are excluded from auto-mode draws; they are only reachable
  // when a familyFloor is active that explicitly covers their family.
  const floorFamilies = familyFloor && familyFloor.families.length > 0
    ? new Set(familyFloor.families)
    : undefined;
  const allTiles = Object.keys(grammar.tileCatalog).sort().filter(tile => {
    if (!grammar.tileCatalog[tile]?.programOnly) return true;
    // Allow programOnly tiles through only when a matching floor family is active.
    return floorFamilies !== undefined && floorFamilies.has(grammar.tileCatalog[tile]?.family ?? '');
  });
  const preferredFamilies = new Set(template.spec.dominantFamilies);
  const preferred = allTiles.filter(tile => preferredFamilies.has(grammar.tileCatalog[tile]?.family ?? ''));
  const dominant = preferred.filter(tile => grammar.tileCatalog[tile]?.family === dominantFamily);
  const selected: string[] = [];

  const quota = Math.min(targetDistinct, Math.ceil(targetDistinct * dominantQuotaShare));
  selected.push(...drawTileIds(grammar, rng, dominant, quota, selected, familyBias));
  if (selected.length < targetDistinct) {
    selected.push(...drawTileIdsByFamily(grammar, rng, preferred, targetDistinct - selected.length, selected, familyBias));
  }
  if (selected.length < targetDistinct) {
    selected.push(...drawTileIdsByFamily(grammar, rng, allTiles, targetDistinct - selected.length, selected, familyBias));
  }

  return applyFamilyFloor(grammar, rng, [...new Set(selected)].sort(), targetDistinct, familyFloor, familyBias, diag);
}

function templateBiasWeight(id: string, templateBias: TemplateBias | undefined): number {
  if (templateBias === undefined) return 1;
  return templateBias.ids.includes(id) ? templateBias.multiplier : 1;
}

function applyFamilyFloor(
  grammar: EngineGrammar,
  rng: Rng,
  selected: string[],
  targetDistinct: number,
  familyFloor: FamilyFloor | undefined,
  familyBias: FamilyBias | undefined,
  diag: SampleDiagnostics | undefined,
): string[] {
  if (familyFloor === undefined || familyFloor.minShare <= 0 || familyFloor.families.length === 0 || targetDistinct <= 0) {
    return selected;
  }

  const allTiles = Object.keys(grammar.tileCatalog).sort();
  const mappedFamilies = new Set(familyFloor.families);
  // programOnly tiles in the floor's family are intentionally included —
  // the floor top-up is what makes them reachable.
  const mappedCandidates = allTiles
    .filter(tile => mappedFamilies.has(grammar.tileCatalog[tile]?.family ?? ''))
    .sort();
  if (mappedCandidates.length === 0) {
    if (diag) diag.familyFloorMisses += 1;
    return selected;
  }

  const targetSize = Math.min(Math.max(selected.length, targetDistinct), allTiles.length);
  const requiredMapped = Math.min(
    targetSize,
    mappedCandidates.length,
    Math.ceil(targetSize * familyFloor.minShare),
  );
  // Exclude programOnly tiles from non-floor candidates (they are not eligible
  // outside of their owning floor context).
  const nonMappedCandidates = allTiles.filter(tile =>
    !mappedFamilies.has(grammar.tileCatalog[tile]?.family ?? '') &&
    !grammar.tileCatalog[tile]?.programOnly
  );
  const preserveNonMapped = targetSize > requiredMapped && nonMappedCandidates.length > 0;
  let out = selected.slice(0, targetSize).sort();

  while (countMappedTiles(grammar, out, mappedFamilies) < requiredMapped) {
    const picked = drawTileIdsByFamily(grammar, rng, mappedCandidates, 1, out, familyBias);
    if (picked.length === 0) break;
    const nonMapped = out
      .filter(tile => !mappedFamilies.has(grammar.tileCatalog[tile]?.family ?? ''))
      .sort();
    if (out.length >= targetSize) {
      const removed = nonMapped[nonMapped.length - 1]!;
      out = out.filter(tile => tile !== removed);
    }
    out.push(picked[0]!);
    out = [...new Set(out)].sort();
  }

  if (preserveNonMapped && out.every(tile => mappedFamilies.has(grammar.tileCatalog[tile]?.family ?? ''))) {
    const picked = drawTileIdsByFamily(grammar, rng, nonMappedCandidates, 1, out, familyBias);
    const mapped = out
      .filter(tile => mappedFamilies.has(grammar.tileCatalog[tile]?.family ?? ''))
      .sort();
    if (picked.length > 0 && mapped.length > requiredMapped) {
      const removed = mapped[mapped.length - 1]!;
      out = out.filter(tile => tile !== removed);
      out.push(picked[0]!);
      out = [...new Set(out)].sort();
    }
  }

  // Honest diagnostics: report a miss whenever the final working set's mapped
  // share falls below minShare (capped requiredMapped silently under-counts).
  if (diag) {
    const actualMapped = countMappedTiles(grammar, out, mappedFamilies);
    const actualShare = out.length > 0 ? actualMapped / out.length : 0;
    if (actualShare < familyFloor.minShare) {
      diag.familyFloorMisses += 1;
    }
  }

  return out.sort();
}

function countMappedTiles(grammar: EngineGrammar, tiles: readonly string[], mappedFamilies: ReadonlySet<string>): number {
  return tiles.filter(tile => mappedFamilies.has(grammar.tileCatalog[tile]?.family ?? '')).length;
}

function drawTileIds(
  grammar: EngineGrammar,
  rng: Rng,
  candidates: string[],
  count: number,
  alreadySelected: string[],
  familyBias?: FamilyBias,
): string[] {
  let remaining = [...new Set(candidates)]
    .filter(tile => !alreadySelected.includes(tile))
    .sort();
  const picked: string[] = [];
  while (remaining.length > 0 && picked.length < count) {
    const tile = weightedChoice(
      rng,
      remaining.map(id => ({
        value: id,
        weight: familyBias === undefined
          ? tileWeight(grammar, id)
          : tileWeight(grammar, id) * tileFamilyBiasWeight(grammar, id, familyBias),
        sortKey: id,
      })),
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
  familyBias?: FamilyBias,
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
      families.map(value => ({
        value,
        weight: familyBias === undefined ? 1 : familyBiasWeight(value, familyBias),
        sortKey: value,
      })),
    );
    const familyTiles = remaining.filter(tile => grammar.tileCatalog[tile]?.family === family);
    const tile = weightedChoice(
      rng,
      familyTiles.map(id => ({
        value: id,
        weight: familyBias === undefined
          ? tileWeight(grammar, id)
          : tileWeight(grammar, id) * tileFamilyBiasWeight(grammar, id, familyBias),
        sortKey: id,
      })),
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
  relativeStats: RelativeGridStats,
  diag: SampleDiagnostics,
): void {
  const dims = dimsForCells(cells);
  if (dims.cols < 2) return;
  const capable = friezePlacements(grammar, workingSet);
  if (capable.length === 0) return;

  for (let i = 0; i < count; i += 1) {
    const row = drawFriezeRow(relativeStats, rng, dims);
    if (!rowIsFree(cells, row)) continue;
    const placement = weightedChoice(rng, capable);
    const rowCells = Array.from({ length: dims.cols }, (_v, col) => cellAt(cells, col, row));
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

function drawFriezeRow(relativeStats: RelativeGridStats, rng: Rng, dims: GridDims): number {
  const entries = Object.keys(relativeStats.friezeRowWeights)
    .filter(key => /^\d+$/.test(key))
    .map(key => Number(key))
    .filter(row => row >= 0 && row < dims.rows)
    .sort((a, b) => a - b)
    .map(row => ({
      value: row,
      weight: (relativeStats.friezeRowWeights[String(row)] ?? 1) *
        focalAnchorWeightForPositions(
          Array.from({ length: dims.cols }, (_value, col) => ({ col, row })),
          dims,
        ),
      sortKey: String(row),
    }));
  if (entries.length === 0) return 0;
  return weightedChoice(rng, entries);
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
  const rawTargetLength = MINED_LENGTH_TEMPLATES.has(template.id)
    ? drawRunTargetLength(grammar, rng)
    : rng.int(2, 3);
  const serpentine = SERPENTINE_TEMPLATES.has(template.id);
  const dims = dimsForCells(cells);
  const phraseOptions = PHRASE_TEMPLATES.has(template.id) ? phraseLineOptions(cells, dims) : [];
  let protectedPhraseCells = new Set<string>();
  if (phraseOptions.length > 0) {
    const phraseSelected = weightedChoice(rng, [
      { value: false, weight: 1, sortKey: 'normal' },
      { value: true, weight: PHRASE_COMPLETION_WEIGHT, sortKey: 'phrase' },
    ]);
    if (phraseSelected && placePhraseRun(cells, grammar, rng, workingSet, phraseOptions, template, diag)) {
      return true;
    }
    if (!phraseSelected) {
      protectedPhraseCells = phraseLineCellKeys(phraseOptions);
    }
  }

  const starts = cells
    .filter(cell => cell.kind === undefined &&
      !protectedPhraseCells.has(positionKey(cell)) &&
      (isFree(cells, cell.col + 1, cell.row) || isFree(cells, cell.col, cell.row + 1)))
    .sort(compareCells);
  if (starts.length === 0) return false;

  const start = weightedChoice(
    rng,
    starts.map(cell => ({
      value: cell,
      weight: focalAnchorWeightForPositions([cell], dims),
      sortKey: positionKey(cell),
    })),
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

    const heading: Step = dir === 'h' ? 'right' : 'down';
    const grown = serpentine
      ? growSerpentine(cells, grammar, rng, workingSet, next, pair[1], ink, heading, rawTargetLength, diag, runPath)
      : growStraight(cells, grammar, rng, workingSet, next, pair[1], ink, dir, rawTargetLength, diag, runPath);
    void grown;
    diag.runPaths.push(runPath);
    return true;
  }

  return false;
}

interface PhraseLineOption {
  dir: Direction;
  cells: DraftCell[];
  sortKey: string;
}

function phraseLineCellKeys(options: readonly PhraseLineOption[]): Set<string> {
  const keys = new Set<string>();
  for (const option of options) {
    for (const cell of option.cells) keys.add(positionKey(cell));
  }
  return keys;
}

function phraseLineOptions(cells: DraftCell[], dims: GridDims): PhraseLineOption[] {
  const options: PhraseLineOption[] = [];
  if (new Set(cells.map(cell => cell.ground)).size <= 1) return options;
  if (dims.cols >= 2) {
    for (let row = 0; row < dims.rows; row += 1) {
      if (freeCellsInRow(cells, row, dims) < dims.cols - 1) continue;
      const line = Array.from({ length: dims.cols }, (_value, col) => cellAt(cells, col, row));
      if (!line.every(cell => cell.kind === undefined)) continue;
      options.push({ dir: 'h', cells: line, sortKey: `h-${String(row).padStart(2, '0')}` });
    }
  }
  if (dims.rows >= 2) {
    for (let col = 0; col < dims.cols; col += 1) {
      if (freeCellsInColumn(cells, col, dims) < dims.rows - 1) continue;
      const line = Array.from({ length: dims.rows }, (_value, row) => cellAt(cells, col, row));
      if (!line.every(cell => cell.kind === undefined)) continue;
      options.push({ dir: 'v', cells: line, sortKey: `v-${String(col).padStart(2, '0')}` });
    }
  }
  return options.sort((a, b) => compareCodepoint(a.sortKey, b.sortKey));
}

function placePhraseRun(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  options: readonly PhraseLineOption[],
  template: Template,
  diag: SampleDiagnostics,
): boolean {
  let remaining = [...options];
  const dims = dimsForCells(cells);
  while (remaining.length > 0) {
    const line = weightedChoice(
      rng,
      remaining.map(option => ({
        value: option,
        weight: focalAnchorWeightForPositions(option.cells, dims),
        sortKey: option.sortKey,
      })),
    );
    if (tryPlacePhraseLine(cells, grammar, rng, workingSet, line, template, diag)) return true;
    remaining = remaining.filter(option => option !== line);
  }
  return false;
}

function tryPlacePhraseLine(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  workingSet: string[],
  line: PhraseLineOption,
  template: Template,
  diag: SampleDiagnostics,
): boolean {
  const [start, next] = line.cells;
  if (!start || !next) return false;

  const snapshots = line.cells.map(cell => [cell, readDraftState(cell)] as [DraftCell, DraftCellState]);
  // Aborted phrase attempts restore the grid but the draw helpers also bump
  // adjacency counters — snapshot those too, so ghost phrases don't pollute them.
  const savedAdjacencyHits = diag.adjacencyHits;
  const savedAdjacencyFallbacks = diag.adjacencyFallbacks;
  const rollBack = (): false => {
    restoreDraftCells(snapshots);
    diag.adjacencyHits = savedAdjacencyHits;
    diag.adjacencyFallbacks = savedAdjacencyFallbacks;
    return false;
  };
  const pair = drawRunPair(grammar, rng, workingSet, line.dir, diag);
  if (!pair) return rollBack();

  const ink = drawInkForCells(grammar, rng, line.cells);
  assignTile(start, pair[0], ink);
  assignTile(next, pair[1], ink);
  const runPath: [number, number][] = [[start.col, start.row], [next.col, next.row]];
  let currentPlacement = pair[1];

  for (let i = 2; i < line.cells.length; i += 1) {
    const candidate = line.cells[i]!;
    const placement = drawNextRunPlacement(grammar, rng, workingSet, currentPlacement, line.dir, diag);
    if (!placement) {
      return rollBack();
    }
    assignTile(candidate, placement, ink);
    runPath.push([candidate.col, candidate.row]);
    currentPlacement = placement;
  }

  if (!draftLineworkShareInRange(cells, grammar, template)) {
    return rollBack();
  }

  diag.runPaths.push(runPath);
  return true;
}

function draftLineworkShareInRange(cells: DraftCell[], grammar: EngineGrammar, template: Template): boolean {
  const tileCells = cells.filter(cell => cell.kind === 'tile' && cell.tile);
  if (tileCells.length === 0) return true;
  const linework = tileCells.filter(cell => isLineworkTile(grammar, cell.tile!)).length;
  const share = linework / tileCells.length;
  return inRange(share, template.spec.lineworkShare, 0.15);
}

function freeCellsInRow(cells: DraftCell[], row: number, dims: GridDims): number {
  let count = 0;
  for (let col = 0; col < dims.cols; col += 1) {
    if (isFree(cells, col, row)) count += 1;
  }
  return count;
}

function freeCellsInColumn(cells: DraftCell[], col: number, dims: GridDims): number {
  let count = 0;
  for (let row = 0; row < dims.rows; row += 1) {
    if (isFree(cells, col, row)) count += 1;
  }
  return count;
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

function shouldPlacePatch(templateId: string, rng: Rng): boolean {
  if (templateId === 'figure-field') return rng.chance(0.5);
  if (templateId === 'mixed-quilt' || templateId === 'arc-mosaic') return rng.chance(0.1);
  return false;
}

function placePatch(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  knobAccent: string | undefined,
  patches: readonly IconicPatch[],
  globalGround: string,
  diag: SampleDiagnostics,
): boolean {
  if (knobAccent && !isAllowedExplicitAccent(knobAccent, grammar.palette.accentOrder)) {
    throw new Error(`Unknown accent ink: ${knobAccent}`);
  }

  const placement = choosePatchPlacement(cells, patches, rng);
  if (!placement) return false;

  const { patch, col, row } = placement;
  const shifted = shiftedGround(cells, globalGround);
  const patchGrounds = patch.cells.map(cell => resolvePatchGround(cell.groundRole, globalGround, shifted, undefined));
  const patchAccent = chooseAccent(grammar, rng, new Set(patchGrounds), knobAccent);
  const anchorCell = firstStampedPatchCell(patch);

  for (const patchCell of patch.cells) {
    const target = cellAt(cells, col + patchCell.dx, row + patchCell.dy);
    const isAnchor = anchorCell === patchCell;
    const resolved = resolvePatchCell(patchCell, grammar, rng, globalGround, shifted, patchAccent);
    target.kind = resolved.kind;
    target.ground = resolved.ground;
    if (isAnchor) {
      target.patchId = patch.id;
      target.patchSpan = [patch.w, patch.h];
    }
    if (resolved.kind === 'tile') {
      target.tile = resolved.tile;
      target.rotation = resolved.rotation;
      target.flip = resolved.flip;
      target.ink = resolved.ink;
      target.inks = resolved.ink ? [resolved.ink] : [];
      target.score = 1;
      target.patchInkRole = patchCell.inkRole;
    }
  }

  diag.patchesPlaced += 1;
  return true;
}

function choosePatchPlacement(
  cells: DraftCell[],
  patches: readonly IconicPatch[],
  rng: Rng,
): { patch: IconicPatch; col: number; row: number } | null {
  const dims = dimsForCells(cells);
  const usablePatches = [...patches]
    .filter(patch => patch.w >= 2 && patch.h >= 2 && patch.w <= 4 && patch.h <= 3 && patch.w <= dims.cols && patch.h <= dims.rows)
    .sort((a, b) => compareCodepoint(a.id, b.id));
  if (usablePatches.length === 0) return null;

  const sizes = [...new Map(usablePatches.map(patch => [`${patch.w}x${patch.h}`, { w: patch.w, h: patch.h }])).values()]
    .sort((a, b) => (b.w * b.h) - (a.w * a.h) || b.w - a.w || b.h - a.h);

  for (const size of sizes) {
    const entries: Array<Weighted<{ patch: IconicPatch; col: number; row: number }>> = [];
    for (let row = 0; row < dims.rows; row += 1) {
      for (let col = 0; col < dims.cols; col += 1) {
        if (col + size.w > dims.cols || row + size.h > dims.rows) continue;
        if (!rectIsFree(cells, col, row, size.w, size.h)) continue;
        const candidates = usablePatches.filter(patch => patch.w === size.w && patch.h === size.h);
        for (const patch of candidates) {
          entries.push({
            value: { patch, col, row },
            weight: focalAnchorWeightForRect(col, row, patch.w, patch.h, dims),
            sortKey: `${String(row).padStart(2, '0')},${String(col).padStart(2, '0')},${patch.id}`,
          });
        }
      }
    }
    if (entries.length > 0) return weightedChoice(rng, entries);
  }

  return null;
}

function rectIsFree(cells: DraftCell[], col: number, row: number, w: number, h: number): boolean {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      if (cellAt(cells, col + dx, row + dy).kind !== undefined) return false;
    }
  }
  return true;
}

function firstStampedPatchCell(patch: IconicPatch): PatchCell | undefined {
  return [...patch.cells].sort((a, b) => a.dy - b.dy || a.dx - b.dx)[0];
}

function shiftedGround(cells: DraftCell[], globalGround: string): string {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.ground === globalGround) continue;
    counts.set(cell.ground, (counts.get(cell.ground) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodepoint(a[0], b[0]))[0]?.[0] ?? globalGround;
}

function resolvePatchCell(
  patchCell: PatchCell,
  grammar: EngineGrammar,
  rng: Rng,
  globalGround: string,
  shifted: string,
  patchAccent: string | null,
): {
  kind: PatchCell['kind'];
  ground: string;
  tile?: string;
  rotation?: Rotation;
  flip?: boolean;
  ink?: string;
} {
  let ground = resolvePatchGround(patchCell.groundRole, globalGround, shifted, undefined);
  if (patchCell.kind === 'plain') {
    return { kind: 'plain', ground };
  }

  const ink = resolvePatchInk(patchCell.inkRole, ground, grammar, rng, patchAccent);
  ground = resolvePatchGround(patchCell.groundRole, globalGround, shifted, ink);
  return {
    kind: 'tile',
    ground,
    tile: patchCell.tile,
    rotation: patchCell.rotation ?? 0,
    flip: patchCell.flip ?? false,
    ink,
  };
}

function resolvePatchGround(
  role: PatchGroundRole,
  globalGround: string,
  shifted: string,
  resolvedInk: string | undefined,
): string {
  if (role === 'g0') return globalGround;
  if (role === 'g1') return shifted;
  return resolvedInk === '#121212' ? '#F3F3F3' : '#121212';
}

function resolvePatchInk(
  role: PatchInkRole | undefined,
  ground: string,
  grammar: EngineGrammar,
  rng: Rng,
  patchAccent: string | null,
): string | undefined {
  if (!role) return undefined;
  if (role === 'accent') return patchAccent ?? neutralForGround(ground);
  if (role === 'ink2') return neutralForGround(ground);
  return drawInkForGround(grammar, rng, ground);
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

function plannedFigureSize(template: Template, knobs: SampleKnobs, rng: Rng, dims: GridDims): number {
  if (knobs.figures === false) return 0;
  if (template.spec.forms.figure[1] <= 0) return 0;
  // Figures span 2–6 cells for most templates, drawn from the template's
  // figureShare range × cellCount and clamped to [2, 6]. figure-field allows up to 9
  // cells (3×3 max region) to enable hero upscale placement.
  const heroCap = template.id === 'figure-field' ? 9 : 6;
  const maxCells = Math.min(heroCap, dims.cellCount, Math.floor(template.spec.figureShare[1] * dims.cellCount + EPS));
  const minCells = Math.max(2, Math.ceil(template.spec.figureShare[0] * dims.cellCount - EPS));
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
  dims: GridDims,
  templateId = '',
): boolean {
  if (knobAccent && !isAllowedExplicitAccent(knobAccent, grammar.palette.accentOrder)) {
    throw new Error(`Unknown accent ink: ${knobAccent}`);
  }

  for (let attempt = 0; attempt < 64; attempt += 1) {
    const empty = cells.filter(cell => cell.kind === undefined).sort(compareCells);
    if (empty.length < size) return false;
    const start = weightedChoice(
      rng,
      empty.map(cell => ({
        value: cell,
        weight: focalAnchorWeightForPositions([cell], dims),
        sortKey: positionKey(cell),
      })),
    );
    const region = growConnectedRegion(cells, rng, start, size, templateId);
    if (region.length < size) continue;
    const ink = chooseAccent(grammar, rng, new Set(region.map(cell => cell.ground)), knobAccent);
    if (!ink) continue;
    const bounds = figureRegionBounds(region);
    if (!regionCoversBounds(region, bounds)) continue;
    const chosen = chooseFigureAsset(figures, bounds.w, bounds.h, dims, rng);
    for (const cell of region) {
      cell.kind = 'freeform';
      cell.ink = ink;
      cell.inks = [ink];
    }
    if (chosen) {
      const { asset, k } = chosen;
      const spanW = k * asset.w;
      const spanH = k * asset.h;
      // Center the aspect-true span within the region on integer cell offsets;
      // uncovered member cells stay freeform (they render as ground — negative
      // space around the icon, the canonical read).
      const offCol = bounds.col + Math.floor((bounds.w - spanW) / 2);
      const offRow = bounds.row + Math.floor((bounds.h - spanH) / 2);
      const anchor = region.find(cell => cell.col === offCol && cell.row === offRow);
      if (anchor) {
        anchor.figureId = asset.id;
        anchor.figureAnchor = true;
        anchor.figureSpan = [spanW, spanH];
      }
    }
    return true;
  }

  return false;
}

function figureRegionBounds(region: DraftCell[]): { col: number; row: number; w: number; h: number } {
  let minCol = Number.POSITIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
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
  dims: GridDims,
  rng: Rng,
): { asset: FigureAsset; k: number } | undefined {
  // Candidate pool: exact(k=1) ∪ upscaled(k≥2) ∪ fits-within.
  // An asset (w, h) qualifies at integer scale k when regionW===k*w && regionH===k*h.
  // Upscaled candidates (k≥2) are weighted 2× their base weight (hero bias).
  // figureSpan is set to the REGION size, so the renderer scales automatically.
  interface Candidate { asset: FigureAsset; k: number }
  const candidateEntries: Array<Weighted<Candidate>> = [];
  const addedIds = new Set<string>();
  const oneDimensionalCanvas = dims.cols === 1 || dims.rows === 1;

  for (const asset of [...figures].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const baseWeight = 1 / (Math.abs(asset.inkShare - 0.4) + EPS);
    // Integer-scale candidates (k≥1)
    for (let k = 1; k * asset.w <= regionW && k * asset.h <= regionH; k += 1) {
      if (oneDimensionalCanvas && !(asset.w === 1 && asset.h === 1 && k === 1)) continue;
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
      if (oneDimensionalCanvas && !(asset.w === 1 && asset.h === 1)) continue;
      if (asset.w <= regionW && asset.h <= regionH) {
        // Aspect-true: the largest integer scale that fits BOTH axes. The span
        // becomes k*(w,h) — NEVER the region rect — so figures cannot stretch
        // out of proportion (Chris's report, 2026-07-02).
        const k = oneDimensionalCanvas ? 1 : Math.max(1, Math.min(Math.floor(regionW / asset.w), Math.floor(regionH / asset.h)));
        const baseWeight = 1 / (Math.abs(asset.inkShare - 0.4) + EPS);
        candidateEntries.push({
          value: { asset, k },
          weight: baseWeight,
          sortKey: `${asset.id}@${k}`,
        });
      }
    }
  }

  if (candidateEntries.length === 0) return undefined;
  return weightedChoice(rng, candidateEntries);
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

function focalAnchorWeightForRect(col: number, row: number, w: number, h: number, dims: GridDims): number {
  const positions: PositionLike[] = [];
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      positions.push({ col: col + dx, row: row + dy });
    }
  }
  return focalAnchorWeightForPositions(positions, dims);
}

interface PositionLike {
  col: number;
  row: number;
}

function focalAnchorWeightForPositions(positions: readonly PositionLike[], dims: GridDims): number {
  if (positions.length === 0 || dims.cols <= 0 || dims.rows <= 0) return 1;
  const x = positions.reduce((total, cell) => total + cell.col + 0.5, 0) / positions.length / dims.cols;
  const y = positions.reduce((total, cell) => total + cell.row + 0.5, 0) / positions.length / dims.rows;
  const centroidCell = {
    col: Math.max(0, Math.min(dims.cols - 1, Math.floor(x * dims.cols))),
    row: Math.max(0, Math.min(dims.rows - 1, Math.floor(y * dims.rows))),
  };
  if (centerIndices(dims.cols).includes(centroidCell.col) && centerIndices(dims.rows).includes(centroidCell.row)) {
    return FOCAL_CENTER_ANCHOR_WEIGHT;
  }
  return Math.hypot(x - 0.5, y - 0.5) <= 0.25 ? FOCAL_NEAR_CENTER_ANCHOR_WEIGHT : 1;
}

function centerIndices(count: number): number[] {
  return count % 2 === 1 ? [Math.floor(count / 2)] : [count / 2 - 1, count / 2];
}

function chooseAccent(
  grammar: EngineGrammar,
  rng: Rng,
  excludedGrounds: Set<string>,
  knobAccent: string | undefined,
): string | null {
  void grammar;
  if (knobAccent && !excludedGrounds.has(knobAccent)) return knobAccent;
  if (knobAccent) return null;

  const accents = ACCENT_POOL
    .filter(({ value }) => !excludedGrounds.has(value));
  if (accents.length === 0) return null;
  return weightedChoice(
    rng,
    accents,
  );
}

function plainTargetCount(template: Template, density: number, dims: GridDims): number {
  const d = Math.max(0, Math.min(1, density));
  const [lo, hi] = template.spec.plainShare;
  const targetShare = lo + (hi - lo) * ((1 - d) ** 2);
  const minCount = Math.ceil(lo * dims.cellCount - EPS);
  const maxCount = Math.floor(hi * dims.cellCount + EPS);
  return Math.max(minCount, Math.min(maxCount, Math.round(targetShare * dims.cellCount)));
}

function placePlainCells(cells: DraftCell[], relativeStats: RelativeGridStats, rng: Rng, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const empty = cells.filter(cell => cell.kind === undefined).sort(compareCells);
    if (empty.length === 0) return;
    const cell = weightedChoice(
      rng,
      empty.map(candidate => ({
        value: candidate,
        weight: relativeStats.plainPositionWeights[positionKey(candidate)] ?? 1,
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
  if (pool.length === 0) {
    // Defensive: unreachable with the current catalog (workingSet can't be
    // empty), but if it ever fires it must not leak program-only tiles.
    pool = Object.keys(grammar.tileCatalog)
      .filter(id => !grammar.tileCatalog[id]?.programOnly)
      .sort();
  }

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
    .filter(ink => CORPUS_GROUND_FILLS.has(ink) && !excluded.has(ink))
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


type AccentSide = 'left' | 'right';
type AccentMode = 'ink' | 'ground' | 'figure';

const CANON_ACCENT_COUNT_WEIGHTS: Weighted<number>[] = [
  { value: 0, weight: 0.18, sortKey: '0' },
  { value: 1, weight: 0.18, sortKey: '1' },
  { value: 2, weight: 0.16, sortKey: '2' },
  { value: 3, weight: 0.48, sortKey: '3' },
];
const AUTO_ACCENT_BUDGET_CAP = 0.35;
const FULL_ACCENT_BUDGET_CAP = 0.5;
const MIN_ACCENT_BUDGET_CAP = 0.15;
const MAX_ACCENT_BUDGET_CAP = 0.60;
const MIN_ACCENT_ZONE_CAP = 3;
const SHIPPED_ACCENT_ZONE_CAP = 6;
const MAX_ACCENT_ZONE_CAP = 9;
const MIN_GROUND_MODE_PROBABILITY = 0.25;
const SHIPPED_GROUND_MODE_PROBABILITY = 0.40;
const MAX_GROUND_MODE_PROBABILITY = 0.55;
const WARM_ACCENTS_SET = new Set(['#FF4F00', '#FFA300', '#C8102E']);
const COOL_ACCENTS_SET = new Set(['#4997D0', '#7150D6', '#268B41', '#0E8C88']);

export function validateShapeEmphasis(emphasis: number | undefined): void {
  if (emphasis === undefined) return;
  if (!Number.isFinite(emphasis) || emphasis < 0 || emphasis > 1) {
    throw new Error(`shapeEmphasis must be a finite number from 0 to 1: ${String(emphasis)}`);
  }
}

/**
 * Resolve the effective family carry for a plan from knobs.shapeEmphasis.
 *
 * Neutral (undefined or exactly 0.5) returns the caller's own familyBias /
 * familyFloor and the shipped DOMINANT_FAMILY_QUOTA — byte-identical to the
 * pre-knob sampler. Otherwise the curves are exponential around the neutral
 * point so 1.0 lands at program-grade carry (bias ×8, quota ×4, floor 0.6)
 * and 0.0 flattens the dominant family into the mix:
 *   bias multiplier  ×2^((e−0.5)·6)   → 0→0.125 · 0.5→1 · 1→8
 *   working-set quota ×2^((e−0.5)·4)  → 0→0.045 · 0.5→0.18 · 1→0.72
 * In program mode (familyBias already set) the same curves scale the
 * program's mapped families rather than the drawn dominant family, and the
 * floor scales as minShare ×2^((e−0.5)·2), capped at 0.95.
 */
function resolveShapeEmphasis(
  knobs: SampleKnobs,
  dominantFamily: string,
): { familyBias?: FamilyBias; familyFloor?: FamilyFloor; quotaShare: number } {
  validateShapeEmphasis(knobs.shapeEmphasis);
  const e = knobs.shapeEmphasis;
  if (e === undefined || e === 0.5) {
    return { familyBias: knobs.familyBias, familyFloor: knobs.familyFloor, quotaShare: DOMINANT_FAMILY_QUOTA };
  }
  const biasScale = Math.pow(2, (e - 0.5) * 6);
  const quotaShare = Math.min(1, DOMINANT_FAMILY_QUOTA * Math.pow(2, (e - 0.5) * 4));
  // A caller-supplied floor is never replaced — only scaled by the same curve.
  const scaledCallerFloor: FamilyFloor | undefined = knobs.familyFloor
    ? {
        families: knobs.familyFloor.families,
        minShare: Math.min(0.95, knobs.familyFloor.minShare * Math.pow(2, (e - 0.5) * 2)),
      }
    : undefined;
  if (knobs.familyBias) {
    // Program (or caller-biased) mode: scale the existing carry.
    const familyBias: FamilyBias = {
      families: knobs.familyBias.families,
      multiplier: Math.max(0.01, knobs.familyBias.multiplier * biasScale),
    };
    return { familyBias, familyFloor: scaledCallerFloor, quotaShare };
  }
  // Auto mode: carry (or flatten) the drawn dominant family itself. A floor is
  // synthesized only when the caller supplied none and emphasis leans high.
  const familyBias: FamilyBias = { families: [dominantFamily], multiplier: biasScale };
  const familyFloor: FamilyFloor | undefined = scaledCallerFloor ?? (e > 0.5
    ? { families: [dominantFamily], minShare: Math.min(0.6, (e - 0.5) * 1.2) }
    : undefined);
  return { familyBias, familyFloor, quotaShare };
}

function validateAccentStrength(strength: number | undefined): number {
  if (strength === undefined) return IDENTITY_ACCENT_STRENGTH;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new Error(`accentStrength must be a finite number from 0 to 1: ${String(strength)}`);
  }
  return strength;
}

function accentRequestUsesStrength(request: AccentRequest): boolean {
  return request.forcedAccent !== undefined || request.poolChoices !== undefined;
}

function resolveAccentRequest(knobs: SampleKnobs, explicitAccentOrder: readonly string[]): AccentRequest {
  const paletteMode = knobs.paletteMode ?? 'auto';
  if (paletteMode !== 'auto' && paletteMode !== 'full') {
    throw new Error(`Unknown paletteMode: ${String(knobs.paletteMode)}`);
  }
  if (paletteMode === 'full' && knobs.accent) {
    throw new Error('paletteMode full cannot be combined with accent');
  }

  const accentPool = validateAccentPool(knobs.accentPool);
  if (accentPool && knobs.accent) {
    throw new Error('accentPool cannot be combined with accent');
  }
  if (accentPool && paletteMode === 'full') {
    throw new Error('accentPool cannot be combined with paletteMode full');
  }
  if (knobs.accent && !isAllowedExplicitAccent(knobs.accent, explicitAccentOrder)) {
    throw new Error(`Unknown accent ink: ${knobs.accent}`);
  }
  if (accentPool && accentPool.length === 1) {
    return { forcedAccent: accentPool[0], poolAccents: [] };
  }
  if (accentPool) {
    return {
      poolChoices: accentChoicesForPool(accentPool),
      poolAccents: accentPool,
    };
  }
  if (knobs.accent) {
    return { forcedAccent: knobs.accent, poolAccents: [] };
  }
  if (paletteMode === 'full') {
    return {
      poolChoices: ACCENT_POOL,
      poolAccents: [...ACCENT_POOL_HEXES],
    };
  }
  return { poolAccents: [] };
}

function validateAccentPool(accentPool: string[] | undefined): string[] | undefined {
  if (accentPool === undefined) return undefined;
  if (!Array.isArray(accentPool) || accentPool.length === 0) {
    throw new Error('accentPool cannot be empty');
  }
  const seen = new Set<string>();
  for (const accent of accentPool) {
    if (!ACCENT_POOL_SET.has(accent)) {
      throw new Error(`Unknown accent in accentPool: ${accent}`);
    }
    if (seen.has(accent)) {
      throw new Error(`accentPool cannot contain duplicate accent: ${accent}`);
    }
    seen.add(accent);
  }
  return [...accentPool];
}

function accentChoicesForPool(accentPool: readonly string[]): readonly Weighted<string>[] {
  const selected = new Set(accentPool);
  return ACCENT_POOL.filter(entry => selected.has(entry.value));
}

function accentBudgetCapForRequest(request: AccentRequest, accentStrength: number): number {
  const shippedMidpoint = request.poolAccents.length >= 3 ? FULL_ACCENT_BUDGET_CAP : AUTO_ACCENT_BUDGET_CAP;
  return strengthCurve(accentStrength, MIN_ACCENT_BUDGET_CAP, shippedMidpoint, MAX_ACCENT_BUDGET_CAP);
}

function accentZoneCellCapForStrength(accentStrength: number): number {
  return Math.max(2, Math.round(
    strengthCurve(accentStrength, MIN_ACCENT_ZONE_CAP, SHIPPED_ACCENT_ZONE_CAP, MAX_ACCENT_ZONE_CAP),
  ));
}

function accentGroundModeProbabilityForStrength(accentStrength: number): number {
  return strengthCurve(
    accentStrength,
    MIN_GROUND_MODE_PROBABILITY,
    SHIPPED_GROUND_MODE_PROBABILITY,
    MAX_GROUND_MODE_PROBABILITY,
  );
}

function accentInkModeProbabilityForStrength(accentStrength: number): number {
  return 1 - accentGroundModeProbabilityForStrength(accentStrength);
}

function strengthCurve(strength: number, low: number, shippedMidpoint: number, high: number): number {
  // Task 5 names low/high endpoints, but a single lerp would move the shipped
  // cap at strength 0.5 (0.15→0.60 lands on 0.375, not today's 0.35). Keep
  // strength 0.5 byte-identical by using a piecewise curve through the shipped
  // midpoint, with each mode's current cap as its own anchor.
  if (strength === IDENTITY_ACCENT_STRENGTH) return shippedMidpoint;
  return strength < IDENTITY_ACCENT_STRENGTH
    ? low + (shippedMidpoint - low) * (strength / IDENTITY_ACCENT_STRENGTH)
    : shippedMidpoint + (high - shippedMidpoint) * ((strength - IDENTITY_ACCENT_STRENGTH) / IDENTITY_ACCENT_STRENGTH);
}

function accentSurvivors(request: AccentRequest): readonly string[] {
  return request.poolAccents.length > 0 ? request.poolAccents : request.forcedAccent ? [request.forcedAccent] : [];
}

function minimumDistinctAccentCount(cells: readonly DraftCell[], poolAccents: readonly string[]): number {
  const placeableCells = cells.filter(cell => cell.kind !== 'plain').length;
  return Math.min(poolAccents.length, placeableCells);
}

/**
 * Accent zoning (P6 Task 0): auto mode draws a single
 * canon-calibrated accent-count bucket, then allocates that many DISTINCT
 * locked accent-pool hues as coherent zones. User pools and full mode share the
 * pool path, with target count equal to pool size. Explicit accents and
 * single-member pools keep the previous one-zone forced behavior. De-scatter
 * strips accent inks AND grounds outside all zones, so the 0-accent bucket
 * produces a fully neutral banner.
 */
function applyAccentZoning(
  cells: DraftCell[],
  grammar: EngineGrammar,
  rng: Rng,
  template: Template,
  request: AccentRequest,
  diag: SampleDiagnostics,
  accentStrength: number,
): void {
  const accentChoices = request.poolChoices ?? ACCENT_POOL;
  if (accentChoices.length === 0) return;

  const forcedAccent = request.forcedAccent;
  const poolMode = request.poolChoices !== undefined;
  const targetAccentCount = forcedAccent
    ? 1
    : poolMode
      ? accentChoices.length
      : weightedChoice(rng, CANON_ACCENT_COUNT_WEIGHTS);
  const warmSide: AccentSide | undefined = forcedAccent
    ? undefined
    : (rng.next() < 0.5 ? 'left' : 'right');
  diag.accentWarmSide = warmSide;

  const allAccents = new Set<string>(ACCENT_POOL_HEXES);
  if (forcedAccent) allAccents.add(forcedAccent);
  if (targetAccentCount === 0) {
    descatterAccentsOutsideZones(cells, allAccents, []);
    return;
  }

  const selectedAccents = forcedAccent
    ? [forcedAccent]
    : drawDistinctAccentInks(rng, accentChoices, targetAccentCount);
  const zones: Set<DraftCell>[] = [];
  const zoneModes: AccentMode[] = [];
  const placedAccents: string[] = [];
  const occupied = new Set<DraftCell>();
  const patchAccentCells = cells
    .filter(c => c.kind === 'tile' && c.patchInkRole === 'accent')
    .sort(compareCells);

  for (const accent of selectedAccents) {
    const preferredSide = preferredSideForAccent(accent, warmSide);
    const patchZone = zones.length === 0
      ? takePatchAccentZone(patchAccentCells, occupied, accent, allAccents)
      : null;
    const figureZone = patchZone === null
      ? takeFigureAccentZone(cells, occupied, rng, accent, allAccents)
      : null;
    const placed = patchZone ?? figureZone ?? takeTileAccentZone(
      cells,
      grammar,
      occupied,
      rng,
      accent,
      allAccents,
      preferredSide,
      accentStrength,
    );
    if (placed === null) continue;

    zones.push(placed.zone);
    zoneModes.push(placed.mode);
    placedAccents.push(accent);
    for (const cell of placed.zone) {
      occupied.add(cell);
    }
  }

  const requiredDistinct = poolMode
    ? minimumDistinctAccentCount(cells, request.poolAccents)
    : 0;
  if (requiredDistinct > 0 && placedAccents.length < requiredDistinct) {
    for (const accent of selectedAccents) {
      if (placedAccents.includes(accent)) continue;
      const preferredSide = preferredSideForAccent(accent, warmSide);
      const placed = takeSingleCellAccentZone(cells, occupied, rng, accent, allAccents, preferredSide);
      if (placed === null) continue;
      zones.push(placed.zone);
      zoneModes.push(placed.mode);
      placedAccents.push(accent);
      for (const cell of placed.zone) {
        occupied.add(cell);
      }
      if (placedAccents.length >= requiredDistinct) break;
    }
  }

  diag.accentZone = zoneModes[0] ?? 'none';
  diag.accentZonesPlaced = zones.length;
  diag.accentsUsed = placedAccents;
  void template; // retained in the signature for rezone compatibility and future template-specific zoning.
  descatterAccentsOutsideZones(cells, allAccents, zones);
}

const NEUTRAL_INKS_SET = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);
const INK_MODE_CONTRAST_FLOOR = 1.9;
const DARK_GROUND_ZONE_LUMINANCE = 0.175;

function drawDistinctAccentInks(
  rng: Rng,
  choices: readonly Weighted<string>[],
  count: number,
): string[] {
  let remaining = [...choices];
  const selected: string[] = [];
  while (remaining.length > 0 && selected.length < count) {
    const picked = weightedChoice(rng, remaining);
    selected.push(picked);
    remaining = remaining.filter(choice => choice.value !== picked);
  }
  return selected;
}

function preferredSideForAccent(accent: string, warmSide: AccentSide | undefined): AccentSide | undefined {
  if (warmSide === undefined) return undefined;
  if (WARM_ACCENTS_SET.has(accent)) return warmSide;
  if (COOL_ACCENTS_SET.has(accent)) return warmSide === 'left' ? 'right' : 'left';
  return undefined;
}

function takePatchAccentZone(
  patchAccentCells: readonly DraftCell[],
  occupied: Set<DraftCell>,
  accent: string,
  allAccents: Set<string>,
): { zone: Set<DraftCell>; mode: AccentMode } | null {
  const cells = patchAccentCells.filter(cell => !occupied.has(cell));
  if (cells.length === 0) return null;
  const zone = new Set(cells);
  for (const cell of zone) applyInkZoneCell(cell, accent, allAccents);
  return { zone, mode: 'ink' };
}

function takeFigureAccentZone(
  cells: DraftCell[],
  occupied: Set<DraftCell>,
  rng: Rng,
  accent: string,
  allAccents: Set<string>,
): { zone: Set<DraftCell>; mode: AccentMode } | null {
  const figureCells = cells.filter(c => c.kind === 'freeform' && !occupied.has(c)).sort(compareCells);
  if (figureCells.length === 0 || rng.next() >= 0.5) return null;
  const zone = new Set(figureCells);
  for (const cell of zone) applyInkZoneCell(cell, accent, allAccents);
  return { zone, mode: 'figure' };
}

function takeTileAccentZone(
  cells: DraftCell[],
  grammar: EngineGrammar,
  occupied: Set<DraftCell>,
  rng: Rng,
  accent: string,
  allAccents: Set<string>,
  preferredSide: AccentSide | undefined,
  accentStrength: number,
): { zone: Set<DraftCell>; mode: AccentMode } | null {
  const dims = dimsForCells(cells);
  const anchors = cells
    .filter(c => c.kind === 'tile' && c.tile && !occupied.has(c))
    .sort(compareCells);
  if (anchors.length === 0) return null;

  const anchor = weightedChoice(
    rng,
    anchors.map(c => ({
      value: c,
      weight: anchorSideWeight(c, preferredSide, dims),
      sortKey: `${c.col},${c.row}`,
    })),
  );
  const zone = sameTileFlood(cells, anchor, occupied, accentZoneCellCapForStrength(accentStrength));
  let mode: AccentMode = rng.next() < accentInkModeProbabilityForStrength(accentStrength) ? 'ink' : 'ground';
  if (mode === 'ink' && zone.size >= 3 && !zoneHasSpineEdge(grammar, zone)) {
    mode = 'ground';
  }
  if (mode === 'ink') {
    for (const cell of zone) applyInkZoneCell(cell, accent, allAccents);
  } else {
    for (const cell of zone) applyGroundZoneCell(cell, accent);
  }
  return { zone, mode };
}

function takeSingleCellAccentZone(
  cells: DraftCell[],
  occupied: Set<DraftCell>,
  rng: Rng,
  accent: string,
  allAccents: Set<string>,
  preferredSide: AccentSide | undefined,
): { zone: Set<DraftCell>; mode: AccentMode } | null {
  const dims = dimsForCells(cells);
  const candidates = cells
    .filter(cell => cell.kind !== 'plain' && !occupied.has(cell))
    .sort(compareCells);
  if (candidates.length === 0) return null;
  const cell = weightedChoice(
    rng,
    candidates.map(candidate => ({
      value: candidate,
      weight: anchorSideWeight(candidate, preferredSide, dims),
      sortKey: positionKey(candidate),
    })),
  );
  applyInkZoneCell(cell, accent, allAccents);
  return { zone: new Set([cell]), mode: 'ink' };
}

function zoneHasSpineEdge(grammar: EngineGrammar, zone: Set<DraftCell>): boolean {
  const cells = [...zone];
  const keys = new Set(cells.map(positionKey));
  for (const here of cells) {
    if (here.kind !== 'tile' || !here.tile) continue;
    for (const [dc, dr, dir] of [[1, 0, 'h'], [0, 1, 'v']] as const) {
      const there = cells.find(cell => cell.col === here.col + dc && cell.row === here.row + dr);
      if (!there || !keys.has(positionKey(there)) || there.kind !== 'tile' || !there.tile) continue;
      if (placementsJoin(
        grammar,
        { tile: here.tile, rotation: here.rotation ?? 0, flip: here.flip ?? false },
        { tile: there.tile, rotation: there.rotation ?? 0, flip: there.flip ?? false },
        dir,
      )) {
        return true;
      }
    }
  }
  return false;
}

function anchorSideWeight(cell: DraftCell, side: AccentSide | undefined, dims: GridDims): number {
  if (side === undefined) return 1;
  const onPreferredSide = side === 'left' ? cell.col < dims.cols / 2 : cell.col >= dims.cols / 2;
  return onPreferredSide ? 3 : 1;
}

function sameTileFlood(cells: DraftCell[], anchor: DraftCell, occupied: Set<DraftCell>, maxCells: number): Set<DraftCell> {
  const zone = new Set<DraftCell>([anchor]);
  const queue = [anchor];
  while (queue.length > 0 && zone.size < maxCells) {
    const cur = queue.shift()!;
    for (const next of cells) {
      if (zone.size >= maxCells || zone.has(next) || occupied.has(next)) continue;
      if (next.kind !== 'tile' || next.tile !== cur.tile) continue;
      const adjacent = Math.abs(next.col - cur.col) + Math.abs(next.row - cur.row) === 1;
      if (!adjacent) continue;
      zone.add(next);
      queue.push(next);
    }
  }
  return zone;
}

function applyInkZoneCell(cell: DraftCell, accent: string, allAccents: Set<string>): void {
  if (allAccents.has(cell.ground) && cell.ground !== accent) {
    cell.ground = neutralGroundForInk(cell.ink);
  }
  if (accent === cell.ground || lumRatio(accent, cell.ground) < INK_MODE_CONTRAST_FLOOR) {
    cell.ground = contrastingNeutralGroundForAccent(accent);
  }
  cell.ink = accent;
  cell.inks = [accent];
}

function applyGroundZoneCell(cell: DraftCell, accent: string): void {
  cell.ground = accent;
  if (relativeLuminance(accent) < DARK_GROUND_ZONE_LUMINANCE) {
    cell.ink = '#F3F3F3';
    cell.inks = [cell.ink];
    return;
  }
  const ink = cell.ink === accent || cell.ink === undefined ? '#121212' : cell.ink;
  cell.ink = NEUTRAL_INKS_SET.has(ink) ? ink : '#121212';
  if (cell.ink === accent) cell.ink = '#121212';
  cell.inks = cell.ink ? [cell.ink] : [];
}

function enforceAccentGroundContrast(cells: DraftCell[]): void {
  for (const cell of cells) {
    if (!ACCENT_POOL_SET.has(cell.ground)) continue;
    if (relativeLuminance(cell.ground) >= DARK_GROUND_ZONE_LUMINANCE) continue;
    cell.ink = '#F3F3F3';
    cell.inks = [cell.ink];
  }
}

function ensureAccentPoolMinimum(
  cells: DraftCell[],
  rng: Rng,
  poolChoices: readonly Weighted<string>[],
  minDistinct: number,
  maxShare: number,
): void {
  if (minDistinct <= 0) return;
  const allAccents = new Set<string>(ACCENT_POOL_HEXES);
  const poolAccents = new Set(poolChoices.map(entry => entry.value));
  const visible = visibleDraftAccents(cells, poolAccents);
  if (visible.size >= minDistinct) return;

  const missing = poolChoices
    .filter(entry => !visible.has(entry.value));
  for (const entry of missing) {
    if (visible.size >= minDistinct) return;
    const candidates = accentPoolMinimumCandidates(cells, allAccents, poolAccents);
    if (candidates.length === 0) return;
    const cell = weightedChoice(
      rng,
      candidates.map(candidate => ({ value: candidate, weight: 1, sortKey: positionKey(candidate) })),
    );
    if (accentInkCellCount(cells, allAccents) >= maxAccentInkCells(cells, maxShare)) {
      applyGroundZoneCell(cell, entry.value);
    } else {
      applyInkZoneCell(cell, entry.value, allAccents);
    }
    visible.add(entry.value);
  }
}

function accentPoolMinimumCandidates(
  cells: readonly DraftCell[],
  allAccents: Set<string>,
  poolAccents: Set<string>,
): DraftCell[] {
  const neutralCandidates = cells
    .filter(cell => cell.kind !== 'plain' && !cellCarriesAnyAccent(cell, allAccents))
    .sort(compareCells);
  if (neutralCandidates.length > 0) return neutralCandidates;

  const carrierCounts = new Map<string, number>();
  for (const cell of cells) {
    if (cell.kind === 'plain') continue;
    for (const accent of cellVisibleAccents(cell, poolAccents)) {
      carrierCounts.set(accent, (carrierCounts.get(accent) ?? 0) + 1);
    }
  }

  return cells
    .filter(cell => {
      if (cell.kind === 'plain') return false;
      const carried = cellVisibleAccents(cell, poolAccents);
      if (carried.size === 0) return false;
      return [...carried].every(accent => (carrierCounts.get(accent) ?? 0) > 1);
    })
    .sort(compareCells);
}

function cellVisibleAccents(cell: DraftCell, accents: Set<string>): Set<string> {
  const visible = new Set<string>();
  if (accents.has(cell.ground)) visible.add(cell.ground);
  if (cell.ink && accents.has(cell.ink)) visible.add(cell.ink);
  for (const ink of cell.inks ?? []) {
    if (accents.has(ink)) visible.add(ink);
  }
  return visible;
}

function accentInkCellCount(cells: readonly DraftCell[], accents: Set<string>): number {
  return cells.filter(cell =>
    cell.kind !== 'plain' &&
    ((cell.ink !== undefined && accents.has(cell.ink)) || (cell.inks ?? []).some(ink => accents.has(ink))),
  ).length;
}

function maxAccentInkCells(cells: readonly DraftCell[], maxShare: number): number {
  const nonPlain = cells.filter(cell => cell.kind !== 'plain').length;
  return Math.floor(nonPlain * maxShare + EPS);
}

function visibleDraftAccents(cells: readonly DraftCell[], accents: Set<string>): Set<string> {
  const visible = new Set<string>();
  for (const cell of cells) {
    if (accents.has(cell.ground)) visible.add(cell.ground);
    if (cell.ink && accents.has(cell.ink)) visible.add(cell.ink);
    for (const ink of cell.inks ?? []) {
      if (accents.has(ink)) visible.add(ink);
    }
  }
  return visible;
}

function cellCarriesAnyAccent(cell: DraftCell, accents: Set<string>): boolean {
  return accents.has(cell.ground) ||
    (cell.ink !== undefined && accents.has(cell.ink)) ||
    (cell.inks ?? []).some(ink => accents.has(ink));
}

function descatterAccentsOutsideZones(
  cells: DraftCell[],
  allAccents: Set<string>,
  zones: readonly Set<DraftCell>[],
): void {
  const inZone = new Set<DraftCell>();
  for (const zone of zones) {
    for (const cell of zone) inZone.add(cell);
  }
  for (const cell of cells) {
    if (inZone.has(cell)) continue;
    stripCellAccents(cell, allAccents);
  }
}

function stripCellAccents(cell: DraftCell, allAccents: Set<string>): void {
  if (allAccents.has(cell.ground)) {
    cell.ground = neutralGroundForInk(cell.ink);
  }
  if (cell.ink && allAccents.has(cell.ink)) {
    cell.ink = neutralForGround(cell.ground);
  }
  if ((cell.inks ?? []).some(ink => allAccents.has(ink))) {
    cell.inks = cell.ink ? [cell.ink] : [];
  }
  if (cell.ink === cell.ground) {
    cell.ink = neutralForGround(cell.ground);
    cell.inks = [cell.ink];
  }
}

function neutralGroundForInk(ink: string | undefined): string {
  return ink === '#121212' || ink === undefined ? '#F3F3F3' : '#121212';
}

function contrastingNeutralGroundForAccent(accent: string): string {
  const neutrals = ['#121212', '#F3F3F3', '#FFFFFF', '#D9D9D6'];
  return neutrals
    .map(ground => ({ ground, ratio: lumRatio(accent, ground) }))
    .sort((a, b) => b.ratio - a.ratio || compareCodepoint(a.ground, b.ground))[0]?.ground ?? '#121212';
}

function syncAccentDiagnostics(
  cells: DraftCell[],
  grammar: EngineGrammar,
  extraAccent: string | undefined,
  diag: SampleDiagnostics,
): void {
  void grammar;
  const accentOrder: string[] = [...ACCENT_POOL_HEXES];
  if (extraAccent && !accentOrder.includes(extraAccent)) accentOrder.push(extraAccent);
  const accentSet = new Set(accentOrder);
  const used = new Set<string>();
  for (const cell of cells) {
    if (accentSet.has(cell.ground)) used.add(cell.ground);
    if (cell.ink && accentSet.has(cell.ink)) used.add(cell.ink);
    for (const ink of cell.inks ?? []) {
      if (accentSet.has(ink)) used.add(ink);
    }
  }
  diag.accentsUsed = accentOrder.filter(accent => used.has(accent));
  diag.accentZonesPlaced = diag.accentsUsed.length;
  if (diag.accentsUsed.length === 0) diag.accentZone = 'none';
}

interface DraftCellState {
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
  patchId?: string;
  patchInkRole?: PatchInkRole;
  patchSpan?: [number, number];
}

interface MirroredSpanAnchor {
  col: number;
  row: number;
  id: string;
  span: [number, number];
}

function applyMirror(
  cells: DraftCell[],
  grammar: EngineGrammar,
  dims: GridDims,
  rng: Rng,
  template: Template,
  extraAccent: string | undefined,
  diag: SampleDiagnostics,
  accentBudgetCap: number,
  requiredAccentSurvivors: readonly string[] = extraAccent ? [extraAccent] : [],
): void {
  if (dims.cols < 2) return;
  if (!MIRROR_TEMPLATE_IDS.has(template.id)) return;
  if (hasCenterlineCrossingSpan(cells, dims)) return;
  if (rng.next() >= MIRROR_RATE) return;

  const half = Math.floor(dims.cols / 2);
  const rightStart = dims.cols - half;
  const cellSnapshots = snapshotDraftCells(cells);
  const mirroredFigureAnchors = mirroredFigureAnchorStates(cells, dims, half);
  const mirroredPatchAnchors = mirroredPatchAnchorStates(cells, dims, half);
  const originalRunPaths = cloneRunPaths(diag.runPaths);

  for (let row = 0; row < dims.rows; row += 1) {
    for (let col = 0; col < half; col += 1) {
      const source = cellAt(cells, col, row);
      const target = cellAt(cells, dims.cols - 1 - col, row);
      writeDraftState(target, mirrorDraftState(source));
    }
  }

  for (const cell of cells) {
    if (cell.col < rightStart) continue;
    setDraftOptional(cell, 'figureId', undefined);
    setDraftOptional(cell, 'figureAnchor', undefined);
    setDraftOptional(cell, 'figureSpan', undefined);
    setDraftOptional(cell, 'patchId', undefined);
    setDraftOptional(cell, 'patchSpan', undefined);
  }
  for (const anchor of mirroredFigureAnchors) {
    const cell = cellAt(cells, anchor.col, anchor.row);
    cell.figureId = anchor.id;
    cell.figureAnchor = true;
    cell.figureSpan = [...anchor.span];
  }
  for (const anchor of mirroredPatchAnchors) {
    const cell = cellAt(cells, anchor.col, anchor.row);
    cell.patchId = anchor.id;
    cell.patchSpan = [...anchor.span];
  }

  if (!centerlineSeamsSafe(cells, grammar, dims)) {
    restoreDraftCells(cellSnapshots);
    return;
  }
  enforceAccentBudget(cells, grammar, extraAccent, accentBudgetCap);
  // Forced-accent survival: the mirror copies the left half over the right, so a
  // zone living entirely in the right half is erased wholesale — and the budget
  // pass can strip what remains. Presence of the forced accent is a contract of
  // forced mode (ensureAccentPresence already ran); a mirror that breaks it
  // rolls back instead.
  if (requiredAccentSurvivors.some(accent => !cellsCarryAccent(cells, accent))) {
    restoreDraftCells(cellSnapshots);
    diag.runPaths = originalRunPaths;
    return;
  }
  if (pairMatchRateForCells(cells, dims) < 0.70) {
    restoreDraftCells(cellSnapshots);
    diag.runPaths = originalRunPaths;
    return;
  }
  if (!mirroredFeaturesRespectTemplate(cells, dims, template)) {
    restoreDraftCells(cellSnapshots);
    diag.runPaths = originalRunPaths;
    return;
  }
  if (!mirroredFormsRespectTemplate(cells, grammar, dims, template)) {
    restoreDraftCells(cellSnapshots);
    diag.runPaths = originalRunPaths;
    return;
  }
  if (blackInkShare(cells) > MIRROR_MAX_BLACK_INK_SHARE) {
    restoreDraftCells(cellSnapshots);
    diag.runPaths = originalRunPaths;
    return;
  }
  const validRunPaths = validRunPathsForCells(cells, grammar, diag.runPaths);
  if (diag.runPaths.length > 0 && validRunPaths.length === 0) {
    restoreDraftCells(cellSnapshots);
    diag.runPaths = originalRunPaths;
    return;
  }

  diag.runPaths = validRunPaths;
  diag.mirrored = true;
}

function hasCenterlineCrossingSpan(cells: DraftCell[], dims: GridDims): boolean {
  for (const cell of cells) {
    if (cell.figureAnchor && cell.figureSpan && spanCrossesMirrorAxis(cell.col, cell.figureSpan[0], dims.cols)) {
      return true;
    }
    if (cell.patchId && cell.patchSpan && spanCrossesMirrorAxis(cell.col, cell.patchSpan[0], dims.cols)) {
      return true;
    }
  }
  return false;
}

function snapshotDraftCells(cells: DraftCell[]): Array<[DraftCell, DraftCellState]> {
  return cells.map(cell => [cell, readDraftState(cell)]);
}

function restoreDraftCells(snapshots: Array<[DraftCell, DraftCellState]>): void {
  for (const [cell, state] of snapshots) writeDraftState(cell, state);
}

function spanCrossesMirrorAxis(col: number, width: number, cols: number): boolean {
  if (width <= 1) return false;
  const end = col + width;
  if (cols % 2 === 0) {
    const half = cols / 2;
    return col < half && end > half;
  }
  const center = Math.floor(cols / 2);
  return col <= center && end > center;
}

function mirroredFigureAnchorStates(cells: DraftCell[], dims: GridDims, half: number): MirroredSpanAnchor[] {
  return cells
    .filter(cell => cell.col < half && cell.figureAnchor && cell.figureId && cell.figureSpan)
    .sort(compareCells)
    .map(cell => ({
      col: dims.cols - (cell.col + cell.figureSpan![0]),
      row: cell.row,
      id: cell.figureId!,
      span: [...cell.figureSpan!] as [number, number],
    }));
}

function mirroredPatchAnchorStates(cells: DraftCell[], dims: GridDims, half: number): MirroredSpanAnchor[] {
  return cells
    .filter(cell => cell.col < half && cell.patchId && cell.patchSpan)
    .sort(compareCells)
    .map(cell => ({
      col: dims.cols - (cell.col + cell.patchSpan![0]),
      row: cell.row,
      id: cell.patchId!,
      span: [...cell.patchSpan!] as [number, number],
    }));
}

function centerlineSeamsSafe(cells: DraftCell[], grammar: EngineGrammar, dims: GridDims): boolean {
  if (dims.cols % 2 !== 0) return true;
  const leftCol = dims.cols / 2 - 1;
  const rightCol = dims.cols / 2;
  for (let row = 0; row < dims.rows; row += 1) {
    const left = cellAt(cells, leftCol, row);
    const right = cellAt(cells, rightCol, row);
    if (!isPlacedTile(left) || !isPlacedTile(right)) continue;
    const leftEntry = grammar.tileCatalog[left.tile];
    const rightEntry = grammar.tileCatalog[right.tile];
    if (!leftEntry || !rightEntry) return false;
    const leftEdges = orientEdges(leftEntry.edges, left.rotation, left.flip);
    const rightEdges = orientEdges(rightEntry.edges, right.rotation, right.flip);
    const leftActive = leftEdges.right >= 0.25;
    const rightActive = rightEdges.left >= 0.25;
    if (!leftActive && !rightActive) continue;
    if (!leftActive || !rightActive) return false;
    if (!placementsJoin(
      grammar,
      { tile: left.tile, rotation: left.rotation, flip: left.flip },
      { tile: right.tile, rotation: right.rotation, flip: right.flip },
      'h',
    )) {
      return false;
    }
  }
  return true;
}

function mirroredFormsRespectTemplate(cells: DraftCell[], grammar: EngineGrammar, dims: GridDims, template: Template): boolean {
  if (!RHYTHM_TEMPLATES.has(template.id)) return true;
  const forms = detectForms(draftPlanForForms(cells, dims), grammar.tileCatalog, FAMILIES);
  return forms.every(form => form.kind !== 'run' || form.cells.length <= RHYTHM_RUN_CAP);
}

function mirroredFeaturesRespectTemplate(cells: DraftCell[], dims: GridDims, template: Template): boolean {
  const tileCells = cells.filter(cell => cell.kind === 'tile' && cell.tile);
  const distinctTiles = new Set(tileCells.map(cell => cell.tile!)).size;
  const plainShare = cells.filter(cell => cell.kind === 'plain').length / dims.cellCount;
  const figureShare = cells.filter(cell => cell.kind === 'freeform').length / dims.cellCount;
  const linework = tileCells.filter(cell => LINEWORK_FAMILIES.has(FAMILIES[cell.tile!] ?? '')).length;
  const lineworkShare = tileCells.length > 0 ? linework / tileCells.length : 0;
  return inRange(distinctTiles, template.spec.distinctTiles) &&
    inRange(plainShare, template.spec.plainShare) &&
    inRange(figureShare, template.spec.figureShare) &&
    inRange(lineworkShare, template.spec.lineworkShare, 0.15);
}

function inRange(value: number, range: [number, number], tolerance = 0): boolean {
  return value >= range[0] - tolerance && value <= range[1] + tolerance;
}

function pairMatchRateForCells(cells: DraftCell[], dims: GridDims): number {
  let matched = 0;
  let total = 0;
  for (let row = 0; row < dims.rows; row += 1) {
    for (let col = 0; col < Math.floor(dims.cols / 2); col += 1) {
      const left = cellAt(cells, col, row);
      const right = cellAt(cells, dims.cols - 1 - col, row);
      total += 1;
      if ((left.tile ?? '') === (right.tile ?? '') && (left.ink ?? '') === (right.ink ?? '')) {
        matched += 1;
      }
    }
  }
  return total === 0 ? 1 : matched / total;
}

function blackInkShare(cells: DraftCell[]): number {
  let total = 0;
  let black = 0;
  for (const cell of cells) {
    if (cell.kind === 'plain' || !cell.ink) continue;
    total += 1;
    if (cell.ink === '#121212') black += 1;
  }
  return total === 0 ? 0 : black / total;
}

function cloneRunPaths(runPaths: [number, number][][]): [number, number][][] {
  return runPaths.map(path => path.map(([col, row]) => [col, row]));
}

function validRunPathsForCells(cells: DraftCell[], grammar: EngineGrammar, runPaths: [number, number][][]): [number, number][][] {
  return runPaths.filter(runPath => runPathIsValidForCells(cells, grammar, runPath));
}

function runPathIsValidForCells(cells: DraftCell[], grammar: EngineGrammar, runPath: [number, number][]): boolean {
  for (let i = 0; i < runPath.length - 1; i += 1) {
    const [prevCol, prevRow] = runPath[i]!;
    const [nextCol, nextRow] = runPath[i + 1]!;
    const dist = Math.abs(nextCol - prevCol) + Math.abs(nextRow - prevRow);
    if (dist !== 1) return false;
    const prevCell = maybeCellAt(cells, prevCol, prevRow);
    const nextCell = maybeCellAt(cells, nextCol, nextRow);
    if (!isPlacedTile(prevCell) || !isPlacedTile(nextCell)) return false;
    const dir: Direction = prevRow === nextRow ? 'h' : 'v';
    const isForward = (dir === 'h' && nextCol > prevCol) || (dir === 'v' && nextRow > prevRow);
    const a = isForward ? prevCell : nextCell;
    const b = isForward ? nextCell : prevCell;
    if (!placementsJoin(
      grammar,
      { tile: a.tile, rotation: a.rotation, flip: a.flip },
      { tile: b.tile, rotation: b.rotation, flip: b.flip },
      dir,
    )) {
      return false;
    }
  }
  return true;
}

function mirrorDraftState(source: DraftCell): DraftCellState {
  const state = readDraftState(source);
  if (source.kind === 'tile' && source.tile) {
    state.rotation = mirrorRotation(source.rotation ?? 0);
    state.flip = !(source.flip ?? false);
  }
  return state;
}

function mirrorRotation(rotation: Rotation): Rotation {
  if (rotation === 90) return 270;
  if (rotation === 270) return 90;
  return rotation;
}

function readDraftState(cell: DraftCell): DraftCellState {
  return {
    ground: cell.ground,
    kind: cell.kind,
    tile: cell.tile,
    rotation: cell.rotation,
    flip: cell.flip,
    ink: cell.ink,
    inks: cell.inks ? [...cell.inks] : undefined,
    score: cell.score,
    figureId: cell.figureId,
    figureAnchor: cell.figureAnchor,
    figureSpan: cell.figureSpan ? [...cell.figureSpan] : undefined,
    patchId: cell.patchId,
    patchInkRole: cell.patchInkRole,
    patchSpan: cell.patchSpan ? [...cell.patchSpan] : undefined,
  };
}

function writeDraftState(cell: DraftCell, state: DraftCellState): void {
  cell.ground = state.ground;
  setDraftOptional(cell, 'kind', state.kind);
  setDraftOptional(cell, 'tile', state.tile);
  setDraftOptional(cell, 'rotation', state.rotation);
  setDraftOptional(cell, 'flip', state.flip);
  setDraftOptional(cell, 'ink', state.ink);
  setDraftOptional(cell, 'inks', state.inks ? [...state.inks] : undefined);
  setDraftOptional(cell, 'score', state.score);
  setDraftOptional(cell, 'figureId', state.figureId);
  setDraftOptional(cell, 'figureAnchor', state.figureAnchor);
  setDraftOptional(cell, 'figureSpan', state.figureSpan ? [...state.figureSpan] : undefined);
  setDraftOptional(cell, 'patchId', state.patchId);
  setDraftOptional(cell, 'patchInkRole', state.patchInkRole);
  setDraftOptional(cell, 'patchSpan', state.patchSpan ? [...state.patchSpan] : undefined);
}

function setDraftOptional<K extends keyof DraftCell>(cell: DraftCell, key: K, value: DraftCell[K] | undefined): void {
  const record = cell as unknown as Record<string, unknown>;
  if (value === undefined) {
    delete record[String(key)];
  } else {
    record[String(key)] = value;
  }
}

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
function splitRhythmRuns(cells: DraftCell[], grammar: EngineGrammar, template: Template, dims: GridDims): void {
  if (!RHYTHM_TEMPLATES.has(template.id)) return;

  // Measure runs exactly as detectForms will (union over rules a/c/d), find the
  // largest run form over the cap, and re-ink its highest-degree member to break
  // its joins. Each pass strictly removes one cell from the offending run, so the
  // loop terminates (bounded by cell count).
  for (let guard = 0; guard < dims.cellCount; guard += 1) {
    const runs = detectRunFormsForDraft(cells, grammar, dims);
    const worst = runs.filter(form => form.cells.length > RHYTHM_RUN_CAP).sort((a, b) => b.cells.length - a.cells.length)[0];
    if (!worst) return;
    const group = draftCellsForForm(cells, worst);
    const mutation = chooseBestSplitMutation(cells, grammar, dims, group, forms =>
      Math.max(0, ...forms.map(form => form.cells.length)),
    );
    if (!mutation) return;
    mutation.cell.ink = mutation.ink;
    mutation.cell.inks = [mutation.ink];
  }
}

function splitNoSpineRunForms(cells: DraftCell[], grammar: EngineGrammar, dims: GridDims): void {
  for (let guard = 0; guard < dims.cellCount; guard += 1) {
    const runs = detectRunFormsForDraft(cells, grammar, dims);
    const worst = runs
      .filter(form => form.cells.length >= 3 && !formHasSpineEdge(cells, grammar, form))
      .sort((a, b) => b.cells.length - a.cells.length)[0];
    if (!worst) return;
    const group = draftCellsForForm(cells, worst);
    const mutation = chooseBestSplitMutation(cells, grammar, dims, group, forms =>
      Math.max(0, ...forms
        .filter(form => form.cells.length >= 3 && !formHasSpineEdge(cells, grammar, form))
        .map(form => form.cells.length)),
    );
    if (!mutation) return;
    mutation.cell.ink = mutation.ink;
    mutation.cell.inks = [mutation.ink];
  }
}

function detectRunFormsForDraft(cells: DraftCell[], grammar: EngineGrammar, dims: GridDims): FormGroup[] {
  return detectForms(draftPlanForForms(cells, dims), grammar.tileCatalog, FAMILIES)
    .filter(form => form.kind === 'run');
}

function draftCellsForForm(cells: DraftCell[], form: FormGroup): DraftCell[] {
  return form.cells.map(([col, row]) => cellAt(cells, col, row));
}

function chooseBestSplitMutation(
  cells: DraftCell[],
  grammar: EngineGrammar,
  dims: GridDims,
  group: DraftCell[],
  score: (forms: FormGroup[]) => number,
): { cell: DraftCell; ink: string } | null {
  const baseline = score(detectRunFormsForDraft(cells, grammar, dims));
  let best: { cell: DraftCell; ink: string; score: number } | null = null;
  for (const cell of [...group].sort(compareCells)) {
    const originalInk = cell.ink;
    const originalInks = cell.inks ? [...cell.inks] : undefined;
    for (const ink of NEUTRAL_PREFS) {
      if (ink === cell.ground || ink === originalInk) continue;
      // Zone law: dark accent grounds (lum < DARK_GROUND_ZONE_LUMINANCE) take
      // #F3F3F3 ink only — a darker split ink here would be re-clobbered by
      // enforceAccentGroundContrast, re-merging the run this pass just broke.
      if (
        ink !== '#F3F3F3' &&
        ACCENT_POOL_SET.has(cell.ground) &&
        relativeLuminance(cell.ground) < DARK_GROUND_ZONE_LUMINANCE
      ) continue;
      cell.ink = ink;
      cell.inks = [ink];
      const candidateScore = score(detectRunFormsForDraft(cells, grammar, dims));
      if (
        candidateScore < baseline &&
        (best === null ||
          candidateScore < best.score ||
          (candidateScore === best.score && (compareCells(cell, best.cell) < 0 ||
            (compareCells(cell, best.cell) === 0 && compareCodepoint(ink, best.ink) < 0))))
      ) {
        best = { cell, ink, score: candidateScore };
      }
    }
    cell.ink = originalInk;
    cell.inks = originalInks;
  }
  return best;
}

function formHasSpineEdge(cells: DraftCell[], grammar: EngineGrammar, form: FormGroup): boolean {
  const positions = new Set(form.cells.map(([col, row]) => `${col},${row}`));
  for (const [col, row] of form.cells) {
    const here = cellAt(cells, col, row);
    if (here.kind !== 'tile' || !here.tile) continue;
    for (const [dc, dr, dir] of [[1, 0, 'h'], [0, 1, 'v']] as const) {
      const thereKey = `${col + dc},${row + dr}`;
      if (!positions.has(thereKey)) continue;
      const there = cellAt(cells, col + dc, row + dr);
      if (there.kind !== 'tile' || !there.tile) continue;
      const ruleC = dir === 'h' &&
        here.tile === there.tile &&
        (here.rotation ?? 0) === (there.rotation ?? 0) &&
        here.ink === there.ink;
      const ruleD = here.ink === there.ground && here.ground === there.ink;
      if (ruleC || ruleD) continue;
      if (placementsJoin(
        grammar,
        { tile: here.tile, rotation: here.rotation ?? 0, flip: here.flip ?? false },
        { tile: there.tile, rotation: there.rotation ?? 0, flip: there.flip ?? false },
        dir,
      )) {
        return true;
      }
    }
  }
  return false;
}

function draftPlanForForms(cells: DraftCell[], dims: GridDims): BannerPlan {
  return {
    id: 'draft-form-detect',
    width: dims.cols * CELL_PX,
    height: dims.rows * CELL_PX,
    cols: dims.cols,
    rows: dims.rows,
    ground: cells[0]?.ground ?? '#F3F3F3',
    cells: finalizeCells([...cells]),
    forms: [],
    matchRate: 1,
  };
}

export function enforceAccentBudget(
  cells: DraftCell[],
  grammar: EngineGrammar,
  extraAccent?: string,
  maxShare = AUTO_ACCENT_BUDGET_CAP,
): void {
  void grammar;
  const accents = new Set<string>(ACCENT_POOL_HEXES);
  if (extraAccent) accents.add(extraAccent); // explicit program-hue accents count toward the budget too
  const nonPlain = cells.filter(cell => cell.kind !== 'plain');
  const maxAccent = Math.floor(nonPlain.length * maxShare + EPS);
  // Patch-accent cells strip LAST, and all-or-nothing: an iconic patch's accent
  // group (e.g. the dome's arches) must never be half-recolored. Zoning already
  // makes over-budget patch plans structurally unreachable (3000-seed probe,
  // P4 final review); this is the independent second protection.
  const stripRank = (c: DraftCell): number =>
    c.patchInkRole === 'accent' ? 2 : c.kind === 'freeform' ? 1 : 0;
  const accentCells = nonPlain
    .filter(cell => cell.ink && accents.has(cell.ink))
    .sort((a, b) => stripRank(a) - stripRank(b) || compareCells(a, b));
  const excess = accentCells.length - maxAccent;
  const stripCells = chooseAccentBudgetStripCells(accentCells, Math.max(0, excess));
  const stripSet = new Set(stripCells);
  let patchTouched = false;
  for (const cell of stripCells) {
    if (cell.patchInkRole === 'accent') patchTouched = true;
    const ink = neutralForGround(cell.ground);
    cell.ink = ink;
    cell.inks = [ink];
  }
  if (patchTouched) {
    for (const cell of accentCells) {
      if (stripSet.has(cell)) continue;
      if (cell.patchInkRole !== 'accent' || !cell.ink || !accents.has(cell.ink)) continue;
      const ink = neutralForGround(cell.ground);
      cell.ink = ink;
      cell.inks = [ink];
    }
  }
}

function chooseAccentBudgetStripCells(accentCells: DraftCell[], excess: number): DraftCell[] {
  if (excess <= 0) return [];
  const counts = new Map<string, number>();
  for (const cell of accentCells) {
    if (!cell.ink) continue;
    counts.set(cell.ink, (counts.get(cell.ink) ?? 0) + 1);
  }

  const selected: DraftCell[] = [];
  const selectedSet = new Set<DraftCell>();
  for (const cell of accentCells) {
    if (selected.length >= excess) break;
    const ink = cell.ink;
    if (!ink || (counts.get(ink) ?? 0) <= 1) continue;
    selected.push(cell);
    selectedSet.add(cell);
    counts.set(ink, (counts.get(ink) ?? 0) - 1);
  }
  for (const cell of accentCells) {
    if (selected.length >= excess) break;
    if (selectedSet.has(cell)) continue;
    selected.push(cell);
    selectedSet.add(cell);
  }
  return selected;
}

/**
 * ensureAccentPresence — called ONLY when knobs.accent is set (forced/program mode).
 *
 * In forced mode the accent may be entirely in cell.ground (ground-mode zone path).
 * We must recognize that as "presence" — otherwise we inject a stray mined accent
 * on top of the forced one, producing a second accent the user never picked.
 *
 * Presence check: any non-plain cell carries the forced accent as ground, ink, or
 * in inks[]. Ground-as-accent (applyGroundZoneCell path) fully satisfies visibility.
 *
 * Injection: if truly absent, inject the FORCED accent as ink into one candidate
 * cell. Candidate cells whose ground === accent are excluded (ink==ground → invisible).
 * The candidate weighting uses the same accentInkEntriesForGround totals + positionKey
 * sortKey as before, but the ink is always the forced accent (not a mined draw).
 */
function cellsCarryAccent(cells: readonly DraftCell[], accent: string): boolean {
  return cells.some(cell =>
    cell.ground === accent ||
    cell.ink === accent ||
    (cell.inks ?? []).includes(accent),
  );
}

function ensureAccentPresence(cells: DraftCell[], grammar: EngineGrammar, rng: Rng, accent: string): void {
  const nonPlain = cells.filter(cell => cell.kind !== 'plain');
  // Presence check: forced accent visible as ground, ink, or in inks[].
  const accentPresent = nonPlain.some(cell =>
    cell.ground === accent ||
    cell.ink === accent ||
    (cell.inks ?? []).includes(accent),
  );
  if (accentPresent) return;
  if (Math.floor(nonPlain.length * 0.35 + EPS) <= 0) return;

  // Defensive: exclude cells whose ground === accent (ink==ground → invisible).
  // Unreachable by construction today — the presence check above counts grounds,
  // so reaching this loop implies no non-plain cell carries the accent as ground.
  const candidates: Weighted<DraftCell>[] = [];
  for (const cell of nonPlain.sort(compareCells)) {
    if (cell.ground === accent) continue;
    const entries = accentInkEntriesForGround(grammar, cell.ground);
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) continue;
    candidates.push({
      value: cell,
      weight: totalWeight,
      sortKey: positionKey(cell),
    });
  }
  if (candidates.length === 0) return;

  // One RNG draw (cell selection); ink is always the forced accent.
  const cell = weightedChoice(rng, candidates);
  cell.ink = accent;
  cell.inks = [accent];
}

function accentInkEntriesForGround(grammar: EngineGrammar, ground: string): Weighted<string>[] {
  const inkMap = grammar.palette.inkByGround[ground] ?? {};
  return Object.keys(inkMap)
    .filter(ink => ACCENT_POOL_SET.has(ink) && CORPUS_GROUND_FILLS.has(ink) && ink !== ground)
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
    const { patchInkRole: _patchInkRole, ...publicCell } = cell;
    return publicCell as CellPlan;
  });
}

function makeDraftCells(grounds: string[], dims: GridDims): DraftCell[] {
  const cells: DraftCell[] = [];
  forEachPosition(dims, (col, row, idx) => {
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
  const dims = dimsForCells(cells);
  for (let col = 0; col < dims.cols; col += 1) {
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
  const dims = dimsForCells(cells);
  if (col < 0 || col >= dims.cols || row < 0 || row >= dims.rows) return undefined;
  return cells[indexFor(dims, col, row)];
}

function cellAt(cells: DraftCell[], col: number, row: number): DraftCell {
  const cell = maybeCellAt(cells, col, row);
  if (!cell) throw new Error(`Cell out of bounds: ${col},${row}`);
  return cell;
}

function indexFor(dims: Pick<GridDims, 'cols'>, col: number, row: number): number {
  return row * dims.cols + col;
}

function positionKey(cell: Pick<DraftCell, 'col' | 'row'>): string {
  return `${cell.col},${cell.row}`;
}

function compareCells(a: Pick<DraftCell, 'col' | 'row'>, b: Pick<DraftCell, 'col' | 'row'>): number {
  return a.row - b.row || a.col - b.col;
}

function forEachPosition(dims: GridDims, fn: (col: number, row: number, idx: number) => void): void {
  for (let row = 0; row < dims.rows; row += 1) {
    for (let col = 0; col < dims.cols; col += 1) {
      fn(col, row, indexFor(dims, col, row));
    }
  }
}

function dimsForCells(cells: readonly Pick<DraftCell, 'col' | 'row'>[]): GridDims {
  let cols = 0;
  let rows = 0;
  for (const cell of cells) {
    cols = Math.max(cols, cell.col + 1);
    rows = Math.max(rows, cell.row + 1);
  }
  return { cols, rows, cellCount: cols * rows };
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

function familyBiasWeight(family: string, familyBias: FamilyBias): number {
  const multiplier = Number.isFinite(familyBias.multiplier) && familyBias.multiplier > 0
    ? familyBias.multiplier
    : 1;
  return familyBias.families.includes(family) ? multiplier : 1;
}

function tileFamilyBiasWeight(grammar: EngineGrammar, tile: string, familyBias: FamilyBias): number {
  const family = grammar.tileCatalog[tile]?.family;
  return family === undefined ? 1 : familyBiasWeight(family, familyBias);
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

function drawFillVarietyTarget(range: [number, number], rng: Rng): number {
  const lo = Math.ceil(range[0] - EPS);
  const hi = Math.floor(range[1] + EPS);
  if (hi <= lo) return lo;
  return weightedChoice(
    rng,
    Array.from({ length: hi - lo + 1 }, (_value, index) => {
      const value = lo + index;
      const position = (value - lo) / (hi - lo); // hi > lo guaranteed by the early return
      return {
        value,
        weight: 1 + position * FILL_VARIETY_STEERING_STRENGTH,
        sortKey: String(value).padStart(3, '0'),
      };
    }),
  );
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
 * @param accentStrength - Accent amount control; 0.5 preserves the shipped zoning.
 */
export function rezone(
  plan: BannerPlan,
  grammar: EngineGrammar,
  seed: number,
  accent: string,
  accentStrength = IDENTITY_ACCENT_STRENGTH,
): BannerPlan {
  const resolvedAccentStrength = validateAccentStrength(accentStrength);
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
    familyFloorMisses: 0,
    dominantFamily: plan.forms.find(form => form.family)?.family ?? '',
    accentZone: 'none',
    accentZonesPlaced: 0,
    accentsUsed: [],
    adjacencyFallbacks: 0,
    fillAdjacencyHits: 0,
    friezesPlaced: 0,
    patchesPlaced: 0,
    mirrored: false,
    longestRun: 0,
    runPaths: [],
  };

  const knobs: SampleKnobs = { accent, accentStrength: resolvedAccentStrength };
  const accentRequest = resolveAccentRequest(knobs, grammar.palette.accentOrder);
  const accentBudgetCap = accentBudgetCapForRequest(accentRequest, resolvedAccentStrength);
  applyAccentZoning(cells, grammar, rng, template, accentRequest, diag, resolvedAccentStrength);
  enforceAccentBudget(cells, grammar, accentRequest.forcedAccent, accentBudgetCap);
  enforceAccentGroundContrast(cells);

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
