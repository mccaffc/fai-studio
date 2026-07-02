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

import type { BannerPlan, EngineGrammar } from './types.js';
import type { RubricScores } from './score.js';
import { GRAMMAR as GRAMMAR_RAW } from './data/grammar.js';
import { TILES } from './data/tiles.js';
import { samplePlan, rezone } from './sample.js';
import { scorePlan } from './score.js';
import { renderPlanSvg } from './render.js';
import { PROGRAMS, applyProgramPalette } from './programs.js';
import type { ProgramId } from './programs.js';

// GRAMMAR is typed as EngineGrammar (with Template[] templates) directly in
// the generated file; no cast needed.
const GRAMMAR: EngineGrammar = GRAMMAR_RAW;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type { BannerPlan } from './types.js';
export type { RubricScores } from './score.js';
export type { ProgramId } from './programs.js';
export { PROGRAMS } from './programs.js';

/** tile-id → shape family, derived once from the baked tile catalog. */
const FAMILIES: Record<string, string> = Object.fromEntries(
  Object.entries(TILES).map(([id, tile]) => [id, tile.family]),
);

export interface CorpusConfig {
  /** Initial seed. Defaults to 1. */
  seed?: number;
  /** Pin a template by id (e.g. 'pipe-field'). If absent, auto-selected. */
  template?: string;
  /** Accent color hex (must be in grammar.palette.accentOrder). */
  accent?: string;
  /** 0..1 plain-cell density knob. */
  density?: number;
  /** Force figures on/off. */
  figures?: boolean;
  /**
   * Maximum generation attempts before giving up and returning best-found.
   * Defaults to 8.
   */
  maxAttempts?: number;
  /**
   * Program id — when set, the palette is remapped to the 3 neutrals + that
   * program's hue (no #FFFFFF, no #FF4F00, no second accent). The accent
   * config option is ignored when program is set.
   */
  program?: import('./programs.js').ProgramId;
}

export interface CorpusResult {
  svg: string;
  plan: BannerPlan;
  scores: RubricScores;
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
  const seed = config.seed ?? 1;
  const maxAttempts = config.maxAttempts ?? 8;

  const knobs = {
    template: config.template,
    accent: config.accent,
    density: config.density,
    figures: config.figures,
  };

  interface Attempt {
    plan: BannerPlan;
    scores: RubricScores;
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
    const scores = scorePlan(plan, FAMILIES);
    const svg = renderPlanSvg(plan, TILES);
    attempts.push({ plan, scores, svg, seed: attemptSeed });
    if (!scores.quiltFail) {
      return {
        svg,
        plan,
        scores,
        seed: attemptSeed,
        attempts: i + 1,
        config,
      };
    }
  }

  // All failed quilt — return best: prefer lowest quiltFail score
  // (they all have quiltFail=true here), then highest connectedness.
  const best = attempts.reduce<Attempt>((prev, curr) => {
    if (!prev.scores.quiltFail && curr.scores.quiltFail) return prev;
    if (prev.scores.quiltFail && !curr.scores.quiltFail) return curr;
    return curr.scores.connectedness > prev.scores.connectedness ? curr : prev;
  }, attempts[0]!);

  return {
    svg: best.svg,
    plan: best.plan,
    scores: best.scores,
    seed: best.seed,
    attempts: maxAttempts,
    config,
  };
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
    newPlan = rezone(prev.plan, GRAMMAR, prev.seed, accent);
    newConfig = { ...prev.config, accent, program: undefined };
  } else {
    // Standard rezone (classic mode or program mode with corpus accent).
    newPlan = rezone(prev.plan, GRAMMAR, prev.seed, accent);
    if (prev.config.program) {
      // Program mode with corpus accent — re-apply program palette after rezone.
      const hue = PROGRAMS[prev.config.program].hue;
      newPlan = applyProgramPalette(newPlan, hue);
    }
    newConfig = { ...prev.config, accent };
  }

  const scores = scorePlan(newPlan, FAMILIES);
  const svg = renderPlanSvg(newPlan, TILES);
  return {
    svg,
    plan: newPlan,
    scores,
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

  return base;
}
