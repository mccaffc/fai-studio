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

// The generated grammar module declares `templates: unknown[]` to avoid
// circularly importing the engine types; cast once at the boundary.
const GRAMMAR = GRAMMAR_RAW as unknown as EngineGrammar;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export type { BannerPlan } from './types.js';
export type { RubricScores } from './score.js';

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
    const plan = samplePlan(GRAMMAR, attemptSeed, knobs);
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
 */
export function recolorPlan(prev: CorpusResult, accent: string): CorpusResult {
  const newPlan = rezone(prev.plan, GRAMMAR, prev.seed, accent);
  const scores = scorePlan(newPlan, FAMILIES);
  const svg = renderPlanSvg(newPlan, TILES);
  return {
    svg,
    plan: newPlan,
    scores,
    seed: prev.seed,
    attempts: prev.attempts,
    config: { ...prev.config, accent },
  };
}

// ---------------------------------------------------------------------------
// describePlan
// ---------------------------------------------------------------------------

/**
 * Human-readable one-liner describing the plan's key properties.
 *
 * Format: `{templateId} · {cols}×{rows} · {uniqueTileCount} tiles · runs {runCount} (longest {longestRun}) · accent {accentColor} · conn {connectedness}`
 */
export function describePlan(plan: BannerPlan): string {
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

  return `${templateId} · ${plan.cols}×${plan.rows} · ${uniqueTiles} tiles · runs ${runCount} (longest ${longestRun}) · accent ${accentColor} · conn ${conn}`;
}
