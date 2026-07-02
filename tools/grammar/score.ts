/**
 * score.ts — tools re-export shim + Node manifest convenience.
 *
 * The rubric scorer now lives in the engine (src/engine/corpus/score.ts) as a
 * zero-dependency module (single source of truth). The engine scorer takes a
 * tile-id → shape-family record. The tools' CLIs and tests score plans against
 * a merged tile manifest (a Map), so this shim keeps the manifest-based
 * `scorePlan(plan, manifest)` signature they rely on and adapts it to the
 * engine scorer.
 */

import type { BannerRecon, ManifestTile } from '../mine/schema.js';
import { scorePlan as scorePlanEngine } from '../../src/engine/corpus/score.js';

export type { RubricScores } from '../../src/engine/corpus/score.js';

/**
 * Score a BannerRecon plan against the corpus-calibrated rubric.
 *
 * @param plan     - The plan to score. plan.forms must already be populated.
 * @param manifest - The merged tile manifest map (from loadMergedManifest).
 */
export function scorePlan(
  plan: BannerRecon,
  manifest: Map<string, ManifestTile & { baseDir: string }>,
): ReturnType<typeof scorePlanEngine> {
  const families: Record<string, string> = {};
  for (const [id, entry] of manifest) {
    families[id] = entry.shape_family;
  }
  return scorePlanEngine(plan, families);
}
