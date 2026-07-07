/**
 * index.ts — public API for the corpus engine.
 *
 * Zero-dependency, browser-safe: no node:* imports, no fs, no wall-clock,
 * no nondeterministic randomness (mulberry32 only). Uses the baked GRAMMAR/TILES data modules.
 *
 * ## generateBanner curation loop
 *
 * Attempt i (0-based) uses seed + i * 1_000_000 so the retry sequence is
 * deterministic and independent of each attempt's geometry. If all attempts
 * fail the quilt test, the best attempt is returned (best = quiltFail=false
 * first, then highest connectedness).
 */

import type { BannerPlan, CorpusConfig, EngineGrammar, SampleKnobs } from './types.js';
import type { RubricScores } from './score.js';
import { DEFAULT_ACCENT_STRENGTH } from './types.js';
import { GRAMMAR as GRAMMAR_RAW } from './data/grammar.js';
import { TILES } from './data/tiles.js';
import { samplePlan, rezone } from './sample.js';
import { scorePlan } from './score.js';
import { renderPlanSvg } from './render.js';
import {
  PROGRAMS,
  PROGRAM_FAMILY_BIAS,
  PROGRAM_FAMILY_FLOOR,
  PROGRAM_FAMILY_MAP,
  PROGRAM_TEMPLATE_BIAS,
  PROGRAM_TEMPLATE_MAP,
  applyProgramPalette,
  programSampleKnobs,
} from './programs.js';
import type { ProgramId } from './programs.js';
import { scoreComposition, passesCompositionFloors, COMPOSITION_FLOORS } from './composition.js';
import type { CompositionScores } from './composition.js';

// GRAMMAR is typed as EngineGrammar (with Template[] templates) directly in
// the generated file; no cast needed.
const GRAMMAR: EngineGrammar = GRAMMAR_RAW;
const LOCKED_ACCENT_HEXES = ['#FF4F00', '#FFA300', '#8265DB', '#D63A8C', '#268B41', '#4997D0', '#3A4A6B'] as const;
const LOCKED_ACCENT_SET = new Set<string>(LOCKED_ACCENT_HEXES);

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type { BannerPlan } from './types.js';
export type { ArrangementId, CorpusConfig } from './types.js';
export { ARRANGEMENTS } from './types.js';
export type { RubricScores } from './score.js';
export type { CompositionScores } from './composition.js';
export { COMPOSITION_FLOORS } from './composition.js';
export type { ProgramId } from './programs.js';
export {
  PROGRAMS,
  PROGRAM_FAMILY_BIAS,
  PROGRAM_FAMILY_FLOOR,
  PROGRAM_FAMILY_MAP,
  PROGRAM_TEMPLATE_BIAS,
  PROGRAM_TEMPLATE_MAP,
} from './programs.js';

/** tile-id → shape family, derived once from the baked tile catalog. */
const FAMILIES: Record<string, string> = Object.fromEntries(
  Object.entries(TILES).map(([id, tile]) => [id, tile.family]),
);

export interface CorpusResult {
  svg: string;
  plan: BannerPlan;
  scores: RubricScores & CompositionScores & {
    /** true when the plan passes all COMPOSITION_FLOORS thresholds. */
    floorsPass: boolean;
  };
  /** The seed that produced this result. */
  seed: number;
  /** Number of attempts made (1 = first try passed). */
  attempts: number;
  /** The config that was used. */
  config: CorpusConfig;
}

// ---------------------------------------------------------------------------
// generateBanner
// ---------------------------------------------------------------------------

export function generateBanner(config: CorpusConfig = {}): CorpusResult {
  validateCorpusConfig(config);
  const seed = config.seed ?? 1;
  const maxAttempts = config.maxAttempts ?? 8;

  const programKnobs = config.program ? programSampleKnobs(config.program) : undefined;
  const paletteMode = config.paletteMode ?? 'auto';
  const hasAccentContext = Boolean(config.accent || config.accentPool || paletteMode === 'full' || config.program);
  const accentStrength = config.accentStrength ?? (hasAccentContext
    ? (programKnobs?.accentStrength ?? DEFAULT_ACCENT_STRENGTH)
    : undefined);
  const knobs: SampleKnobs = {
    template: config.template,
    accent: programKnobs ? programKnobs.accent : config.accent,
    accentPool: config.accentPool,
    accentStrength,
    density: config.density,
    figures: config.figures,
    arrangement: config.arrangement,
    paletteMode,
    ...(programKnobs && {
      familyBias: programKnobs.familyBias,
      templateBias: programKnobs.templateBias,
      familyFloor: programKnobs.familyFloor,
    }),
  };

  interface Attempt {
    plan: BannerPlan;
    rubric: RubricScores;
    comp: CompositionScores;
    floorsPass: boolean;
    svg: string;
    seed: number;
  }

  const attempts: Attempt[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    const attemptSeed = seed + i * 1_000_000;
    let plan = samplePlan(GRAMMAR, attemptSeed, knobs);
    // Apply program palette BEFORE scoring so accentShare counts the hue cells.
    if (config.program) {
      const hue = PROGRAMS[config.program].hue;
      plan = applyProgramPalette(plan, hue);
    }
    const rubric = scorePlan(plan, FAMILIES);
    const comp = scoreComposition(plan, TILES);
    const floorsPass = passesCompositionFloors(comp);
    const svg = renderPlanSvg(plan, TILES);
    attempts.push({ plan, rubric, comp, floorsPass, svg, seed: attemptSeed });
    // Prefer candidates passing quilt AND floors; continue if quilt fails.
    if (!rubric.quiltFail && floorsPass) {
      return {
        svg,
        plan,
        scores: { ...rubric, ...comp, floorsPass },
        seed: attemptSeed,
        attempts: i + 1,
        config,
      };
    }
  }

  // Fallback ordering: quilt+floors pass > quilt-pass only > best (floors desc,
  // quiltFail asc, connectedness desc).
  const best = attempts.reduce<Attempt>((prev, curr) => {
    const prevBoth = !prev.rubric.quiltFail && prev.floorsPass;
    const currBoth = !curr.rubric.quiltFail && curr.floorsPass;
    if (prevBoth && !currBoth) return prev;
    if (!prevBoth && currBoth) return curr;
    // Both or neither pass quilt+floors; prefer quilt-pass.
    if (!prev.rubric.quiltFail && curr.rubric.quiltFail) return prev;
    if (prev.rubric.quiltFail && !curr.rubric.quiltFail) return curr;
    // Among same quilt status: floors-pass first, then connectedness.
    if (prev.floorsPass && !curr.floorsPass) return prev;
    if (!prev.floorsPass && curr.floorsPass) return curr;
    return curr.rubric.connectedness > prev.rubric.connectedness ? curr : prev;
  }, attempts[0]!);

  return {
    svg: best.svg,
    plan: best.plan,
    scores: { ...best.rubric, ...best.comp, floorsPass: best.floorsPass },
    seed: best.seed,
    attempts: maxAttempts,
    config,
  };
}

function validateCorpusConfig(config: CorpusConfig): void {
  const paletteMode = config.paletteMode ?? 'auto';
  validateAccentStrength(config.accentStrength);
  if (paletteMode !== 'auto' && paletteMode !== 'full') {
    throw new Error(`Unknown paletteMode: ${String(config.paletteMode)}`);
  }
  if (paletteMode === 'full' && config.accent) {
    throw new Error('paletteMode full cannot be combined with accent');
  }
  if (paletteMode === 'full' && config.program) {
    throw new Error('paletteMode full cannot be combined with program');
  }
  if (config.accentPool !== undefined) {
    if (!Array.isArray(config.accentPool) || config.accentPool.length === 0) {
      throw new Error('accentPool cannot be empty');
    }
    if (config.accent) {
      throw new Error('accentPool cannot be combined with accent');
    }
    if (config.program) {
      throw new Error('accentPool cannot be combined with program');
    }
    if (paletteMode === 'full') {
      throw new Error('accentPool cannot be combined with paletteMode full');
    }
    const seen = new Set<string>();
    for (const accent of config.accentPool) {
      if (!LOCKED_ACCENT_SET.has(accent)) {
        throw new Error(`Unknown accent in accentPool: ${accent}`);
      }
      if (seen.has(accent)) {
        throw new Error(`accentPool cannot contain duplicate accent: ${accent}`);
      }
      seen.add(accent);
    }
  }
}

function validateAccentStrength(strength: number | undefined): void {
  if (strength === undefined) return;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new Error(`accentStrength must be a finite number from 0 to 1: ${String(strength)}`);
  }
}

// ---------------------------------------------------------------------------
// reroll
// ---------------------------------------------------------------------------

/** Same knobs as prev, seed + 1. */
export function reroll(prev: CorpusResult): CorpusResult {
  return generateBanner({ ...prev.config, seed: prev.seed + 1 });
}

// ---------------------------------------------------------------------------
// variations
// ---------------------------------------------------------------------------

/** n variations using prev.config with seeds prev.seed+1 .. prev.seed+n. */
export function variations(prev: CorpusResult, n: number): CorpusResult[] {
  const results: CorpusResult[] = [];
  for (let i = 1; i <= n; i++) {
    results.push(generateBanner({ ...prev.config, seed: prev.seed + i }));
  }
  return results;
}

function remapPlanFill(plan: BannerPlan, from: string, to: string): BannerPlan {
  const out: BannerPlan = JSON.parse(JSON.stringify(plan)) as BannerPlan;
  if (out.ground === from) out.ground = to;
  for (const cell of out.cells) {
    if (cell.ground === from) cell.ground = to;
    if (cell.ink === from) cell.ink = to;
    if (cell.inks) cell.inks = cell.inks.map(ink => ink === from ? to : ink);
  }
  for (const form of out.forms) {
    if (form.ink === from) form.ink = to;
  }
  return out;
}

// ---------------------------------------------------------------------------
// recolorPlan
// ---------------------------------------------------------------------------

/**
 * Freeze the geometry of `prev.plan` and re-zone accents with `accent`.
 * Per-cell tile/rotation/flip are identical to the original; only inks/grounds
 * may change.
 *
 * When `prev.config.program` is set, `accent` must be either a corpus accent
 * (in grammar.palette.accentOrder) or a program hue from PROGRAMS. Passing a
 * program hue swaps the hue while keeping program-mode palette law.
 */
export function recolorPlan(prev: CorpusResult, accent: string): CorpusResult {
  // Validate: accent must be a corpus accent OR a program hue.
  const programHues = new Set(Object.values(PROGRAMS).map(p => p.hue));
  const isCorpusAccent = (GRAMMAR.palette as { accentOrder: string[] }).accentOrder.includes(accent);
  const isProgramHue = programHues.has(accent);
  if (!isCorpusAccent && !isProgramHue) {
    throw new Error(`Unknown accent ink: ${accent}`);
  }

  // In program mode, if the new accent is a program hue, remap the program id.
  const newProgramEntry = isProgramHue
    ? (Object.entries(PROGRAMS) as [ProgramId, { name: string; hue: string }][]).find(([, v]) => v.hue === accent)
    : undefined;

  let newPlan: BannerPlan;
  let newConfig: CorpusConfig;
  const accentStrength = prev.config.accentStrength ?? DEFAULT_ACCENT_STRENGTH;

  if (prev.config.program && newProgramEntry) {
    // Program hue swap: re-apply applyProgramPalette on the already-transformed
    // plan. Pass prevHue so remapInk/remapGround reclaim h1 cells before
    // stamping h2 — without this, 4 of 6 program hues (not corpus accents)
    // would survive the transform unchanged, producing a two-hue output that
    // violates the palette law (C1 fix).
    const prevHue = PROGRAMS[prev.config.program].hue;
    newPlan = applyProgramPalette(prev.plan, newProgramEntry[1].hue, prevHue);
    newConfig = { ...prev.config, accent, program: newProgramEntry[0] };
  } else if (prev.config.program && !newProgramEntry) {
    // Switching to a corpus accent while still in program mode is not meaningful;
    // fall back to standard rezone and drop program mode.
    const prevHue = PROGRAMS[prev.config.program].hue;
    const reclaimedPlan = remapPlanFill(prev.plan, prevHue, accent);
    newPlan = rezone(reclaimedPlan, GRAMMAR, prev.seed, accent, accentStrength);
    newConfig = { ...prev.config, accent, paletteMode: 'auto', program: undefined };
  } else {
    // Standard rezone (classic mode or program mode with corpus accent).
    newPlan = rezone(prev.plan, GRAMMAR, prev.seed, accent, accentStrength);
    if (prev.config.program) {
      // Program mode with corpus accent — re-apply program palette after rezone.
      const hue = PROGRAMS[prev.config.program].hue;
      newPlan = applyProgramPalette(newPlan, hue);
    }
    newConfig = { ...prev.config, accent, paletteMode: 'auto' };
  }

  const rubric = scorePlan(newPlan, FAMILIES);
  const comp = scoreComposition(newPlan, TILES);
  const floorsPass = passesCompositionFloors(comp);
  const svg = renderPlanSvg(newPlan, TILES);
  return {
    svg,
    plan: newPlan,
    scores: { ...rubric, ...comp, floorsPass },
    seed: prev.seed,
    attempts: prev.attempts,
    config: newConfig,
  };
}

// ---------------------------------------------------------------------------
// describePlan
// ---------------------------------------------------------------------------

/**
 * Human-readable one-liner describing the plan's key properties.
 *
 * Format: `{templateId} · {cols}×{rows} · {uniqueTileCount} tiles · runs {runCount} (longest {longestRun}) · accent {accentColor} · conn {connectedness}`
 * In program mode: appends `· program {name}` when a program is identified from the plan's fills.
 */
export function describePlan(plan: BannerPlan, config?: Pick<CorpusConfig, 'program'>): string {
  const scores = scorePlan(plan, FAMILIES);
  const comp = scoreComposition(plan, TILES);

  const uniqueTiles = new Set(plan.cells.filter(c => c.kind === 'tile' && c.tile).map(c => c.tile!)).size;
  const runs = plan.forms.filter(f => f.kind === 'run');
  const runCount = runs.length;
  const longestRun = runs.reduce((max, f) => (f.cells.length > max ? f.cells.length : max), 0);

  // Find the dominant accent color (non-neutral ink used most).
  const NEUTRAL_INKS = new Set(['#121212', '#FFFFFF', '#F3F3F3', '#D9D9D6']);
  const accentCounts = new Map<string, number>();
  for (const cell of plan.cells) {
    if (cell.ink && !NEUTRAL_INKS.has(cell.ink)) {
      accentCounts.set(cell.ink, (accentCounts.get(cell.ink) ?? 0) + 1);
    }
  }
  let accentColor = 'none';
  let accentMax = 0;
  for (const [color, count] of accentCounts) {
    if (count > accentMax) { accentMax = count; accentColor = color; }
  }

  const templateId = plan.templateId ?? '(auto)';
  const conn = scores.connectedness.toFixed(2);

  let base = `${templateId} · ${plan.cols}×${plan.rows} · ${uniqueTiles} tiles · runs ${runCount} (longest ${longestRun}) · accent ${accentColor} · conn ${conn}`;

  // Append program name when config.program is provided.
  if (config?.program && PROGRAMS[config.program]) {
    base += ` · program ${PROGRAMS[config.program].name}`;
  }

  // Append composition floor failures when any gated criterion fails.
  const failNames: string[] = [];
  if (comp.focalDominance < COMPOSITION_FLOORS.focalDominance) failNames.push('focalDominance');
  if (comp.rhythmQuality < COMPOSITION_FLOORS.rhythmQuality) failNames.push('rhythmQuality');
  if (failNames.length > 0) {
    base += ` · comp:FAIL(${failNames.join(',')})`;
  }

  return base;
}
