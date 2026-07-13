/** Deterministic quality + diversity curation for variation trays. */
import type { BannerPlan, CellPlan } from './types.js';
import type { CorpusResult } from './index.js';
import { TILES } from './data/tiles.js';

export interface VariationCurationOptions {
  /** Candidate pool size as a multiple of the requested result count. */
  poolMultiplier?: number;
  /** Relative importance of quality vs diversity, clamped to 0..1. */
  qualityWeight?: number;
}

const NEUTRALS = new Set(['#121212', '#D9D9D6', '#F3F3F3', '#FFFFFF']);
const DEFAULT_QUALITY_WEIGHT = 0.6;
const EPS = 1e-12;

export function selectCuratedVariations(
  previous: CorpusResult,
  candidates: readonly CorpusResult[],
  count: number,
  options: VariationCurationOptions = {},
): CorpusResult[] {
  const target = Math.max(0, Math.floor(count));
  if (target === 0) return [];

  const unique: CorpusResult[] = [];
  const seenSvgs = new Set<string>();
  for (const candidate of candidates) {
    if (seenSvgs.has(candidate.svg)) continue;
    seenSvgs.add(candidate.svg);
    unique.push(candidate);
  }

  const qualityWeight = clamp01(options.qualityWeight ?? DEFAULT_QUALITY_WEIGHT);
  const diversityWeight = 1 - qualityWeight;
  const selected: CorpusResult[] = [];
  const remaining = unique.map((result, ordinal) => ({ result, ordinal }));

  while (selected.length < target && remaining.length > 0) {
    let bestIndex = 0;
    let bestUtility = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index]!;
      const diversity = [previous, ...selected].reduce(
        (minimum, reference) => Math.min(minimum, planDistance(entry.result.plan, reference.plan)),
        1,
      );
      const utility = qualityWeight * qualityScore(entry.result) + diversityWeight * diversity;
      if (
        utility > bestUtility + EPS ||
        (Math.abs(utility - bestUtility) <= EPS && entry.ordinal < remaining[bestIndex]!.ordinal)
      ) {
        bestIndex = index;
        bestUtility = utility;
      }
    }
    selected.push(remaining[bestIndex]!.result);
    remaining.splice(bestIndex, 1);
  }
  return selected;
}

function qualityScore(result: CorpusResult): number {
  const { scores, plan } = result;
  const validityTier = !scores.quiltFail && scores.floorsPass
    ? 1
    : !scores.quiltFail
      ? 0.65
      : scores.floorsPass
        ? 0.35
        : 0.2;
  const continuous =
    0.25 * rangeScore(scores.connectedness, 0.5, 0.95, 0.5) +
    0.2 * rangeScore(scores.focalDominance, 1.35, 3, 2) +
    0.2 * rangeScore(scores.rhythmQuality, 0.3, 0.8, 0.5) +
    0.15 * rangeScore(scores.density, 0.72, 0.97, 0.35) +
    0.2 * rangeScore(plan.forms.length, 2, 3, 3);
  return 0.55 * validityTier + 0.45 * continuous;
}

function rangeScore(value: number, low: number, high: number, taper: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= low && value <= high) return 1;
  const distance = value < low ? low - value : value - high;
  return clamp01(1 - distance / Math.max(EPS, taper));
}

function planDistance(left: BannerPlan, right: BannerPlan): number {
  const length = Math.max(left.cells.length, right.cells.length);
  if (length === 0) return left.templateId === right.templateId ? 0 : 1;
  const leftForms = formSignatures(left);
  const rightForms = formSignatures(right);
  let semantic = 0;
  let transform = 0;
  let ground = 0;
  let ink = 0;
  let forms = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left.cells[index];
    const b = right.cells[index];
    if (!a || !b) {
      semantic += 1;
      transform += 1;
      ground += 1;
      ink += 1;
      forms += 1;
      continue;
    }
    semantic += semanticCellDistance(a, b);
    transform += a.rotation === b.rotation && a.flip === b.flip ? 0 : 1;
    ground += fillDistance(a.ground, b.ground);
    ink += fillDistance(a.ink, b.ink);
    forms += leftForms[index] === rightForms[index] ? 0 : 1;
  }
  return clamp01(
    0.4 * semantic / length +
    0.1 * transform / length +
    0.15 * ground / length +
    0.1 * ink / length +
    0.1 * (left.templateId === right.templateId ? 0 : 1) +
    0.15 * forms / length,
  );
}

function semanticCellDistance(left: CellPlan, right: CellPlan): number {
  if (left.kind !== right.kind) return 1;
  if (left.kind === 'tile' && right.kind === 'tile') {
    if (left.tile === right.tile) return 0;
    const leftFamily = left.tile ? TILES[left.tile]?.family : undefined;
    const rightFamily = right.tile ? TILES[right.tile]?.family : undefined;
    return leftFamily && leftFamily === rightFamily ? 0.4 : 1;
  }
  if (left.kind === 'freeform' && right.kind === 'freeform') {
    if (left.figureId === right.figureId && left.patchId === right.patchId) return 0;
    return 0.75;
  }
  return 0;
}

function formSignatures(plan: BannerPlan): string[] {
  const signatures = Array.from({ length: plan.cells.length }, () => [] as string[]);
  const indexByPosition = new Map(plan.cells.map((cell, index) => [`${cell.col},${cell.row}`, index] as const));
  for (const form of plan.forms) {
    const size = form.cells.length === 1 ? '1' : form.cells.length <= 3 ? '2-3' : '4+';
    for (const [col, row] of form.cells) {
      const index = indexByPosition.get(`${col},${row}`);
      if (index !== undefined) signatures[index]!.push(`${form.kind}/${size}`);
    }
  }
  return signatures.map(parts => parts.sort().join('+'));
}

function fillDistance(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (!left || !right) return 1;
  const leftNeutral = NEUTRALS.has(left);
  const rightNeutral = NEUTRALS.has(right);
  if (leftNeutral && rightNeutral) return 0.35;
  if (!leftNeutral && !rightNeutral) return 0.6;
  return 1;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
