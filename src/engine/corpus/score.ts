/**
 * score.ts — corpus-calibrated aesthetic rubric scorer (engine, zero-dep).
 *
 * Measures a BannerPlan against the aesthetic rubric derived from corpus
 * calibration (P1 Task 5). The scorer is a pure function of the plan and a
 * tile→family record; it reads plan.forms directly and does NOT re-run
 * detectForms.
 *
 * ## Calibration reference (binding)
 * - Exactly one corpus banner fails the quilt test: '014'
 *   (conn=0.00, maxRep=3, no frieze — accepted structural exception)
 * - Corpus mean connectedness ≈ 0.571 (≥ 0.55)
 * - Corpus mean density ≥ 0.85
 */

import type { BannerPlan } from './types.js';

/** Families whose cells read as line-work in the canonical sense. */
const LINEWORK_FAMILIES = new Set(['lines', 'circle', 'curve', 'wave']);

/** Neutral inks — everything else counts as an accent. */
const NEUTRAL_INKS = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);

export interface RubricScores {
  /** (non-plain cells belonging to forms of size ≥ 2) / (non-plain cells); 0 if no non-plain */
  connectedness: number;
  /** lines+circle+curve+wave family cells / tile cells; 0 if no tile cells */
  lineworkShare: number;
  /** count of orthogonally-adjacent SAME-FORM cell pairs whose grounds differ */
  groundShifts: number;
  /** 1 − plainShare */
  density: number;
  /** accent-ink cells / non-plain cells (accents = not in {#121212,#FFFFFF,#F3F3F3,#D9D9D6}) */
  accentShare: number;
  /** highest same-tile count */
  maxTileRepetition: number;
  /** maxTileRepetition ≥ 4 OR any frieze form */
  rhythmic: boolean;
  /** connectedness ≥ 0.35 */
  connected: boolean;
  /** !connected && !rhythmic — the calibrated quilt-failure rule */
  quiltFail: boolean;
}

/**
 * Score a BannerPlan against the corpus-calibrated rubric.
 *
 * @param plan     - The plan to score. plan.forms must already be populated
 *                   (e.g., by detectForms or by the sampler's call thereto).
 * @param families - A tile-id → shape-family record (for linework detection).
 */
export function scorePlan(
  plan: BannerPlan,
  families: Record<string, string>,
): RubricScores {
  const cells = plan.cells;
  const forms = plan.forms;

  // ----- Cell partitions -----
  const plainCells    = cells.filter(c => c.kind === 'plain');
  const nonPlainCells = cells.filter(c => c.kind !== 'plain');
  const tileCells     = cells.filter(c => c.kind === 'tile' && c.tile);

  // ----- density -----
  const density = cells.length > 0 ? 1 - plainCells.length / cells.length : 0;

  // ----- lineworkShare -----
  const lineworkCount = tileCells.filter(c => {
    const family = families[c.tile!];
    return family !== undefined && LINEWORK_FAMILIES.has(family);
  }).length;
  const lineworkShare = tileCells.length > 0 ? lineworkCount / tileCells.length : 0;

  // ----- accentShare -----
  const accentCount = nonPlainCells.filter(c => c.ink && !NEUTRAL_INKS.has(c.ink)).length;
  const accentShare = nonPlainCells.length > 0 ? accentCount / nonPlainCells.length : 0;

  // ----- maxTileRepetition -----
  const tileCounts = new Map<string, number>();
  for (const c of tileCells) {
    const id = c.tile!;
    tileCounts.set(id, (tileCounts.get(id) ?? 0) + 1);
  }
  let maxTileRepetition = 0;
  for (const count of tileCounts.values()) {
    if (count > maxTileRepetition) maxTileRepetition = count;
  }

  // ----- connectedness -----
  const connectedPositions = new Set<string>();
  for (const form of forms) {
    if (form.cells.length >= 2) {
      for (const [col, row] of form.cells) {
        connectedPositions.add(`${col},${row}`);
      }
    }
  }
  const connectedNonPlainCount = nonPlainCells.filter(
    c => connectedPositions.has(`${c.col},${c.row}`),
  ).length;
  const connectedness = nonPlainCells.length > 0
    ? connectedNonPlainCount / nonPlainCells.length
    : 0;

  // ----- groundShifts -----
  const cellGroundMap = new Map<string, string>();
  for (const c of cells) {
    if (c.ground) {
      cellGroundMap.set(`${c.col},${c.row}`, c.ground);
    }
  }

  let groundShifts = 0;
  for (const form of forms) {
    const formPositions = new Set<string>(form.cells.map(([col, row]) => `${col},${row}`));
    for (const [col, row] of form.cells) {
      const groundA = cellGroundMap.get(`${col},${row}`);
      if (groundA === undefined) continue;

      const rightKey = `${col + 1},${row}`;
      if (formPositions.has(rightKey)) {
        const groundB = cellGroundMap.get(rightKey);
        if (groundB !== undefined && groundA !== groundB) {
          groundShifts++;
        }
      }

      const bottomKey = `${col},${row + 1}`;
      if (formPositions.has(bottomKey)) {
        const groundB = cellGroundMap.get(bottomKey);
        if (groundB !== undefined && groundA !== groundB) {
          groundShifts++;
        }
      }
    }
  }

  // ----- derived booleans -----
  const hasFrieze = forms.some(f => f.kind === 'frieze');
  const rhythmic  = maxTileRepetition >= 4 || hasFrieze;
  const connected = connectedness >= 0.35;
  const quiltFail = !connected && !rhythmic;

  return {
    connectedness,
    lineworkShare,
    groundShifts,
    density,
    accentShare,
    maxTileRepetition,
    rhythmic,
    connected,
    quiltFail,
  };
}
