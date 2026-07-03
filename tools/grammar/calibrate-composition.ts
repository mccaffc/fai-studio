/**
 * calibrate-composition.ts — composition-metric calibration harness.
 *
 * Scores the four composition criteria (focalDominance, balance,
 * negativeSpaceCluster, rhythmQuality) across two populations:
 *   (a) the 50 mined CANON banners (corpus/corpus.json), and
 *   (b) 200 auto-sampled plans (seeds 20000..20199, no knobs).
 *
 * Prints per-criterion p10/p25/p50/p75/p90 for both populations side by side,
 * plus the 5 lowest-scoring CANON banners per criterion (id + value).
 *
 * This is a REPORT-ONLY tool: it sets NO thresholds. The controller (Claude)
 * reads the output and supplies COMPOSITION_FLOORS. See the P5 plan, Task 0.
 *
 * Usage:  npm run grammar:calibrate
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scoreComposition } from '../../src/engine/corpus/composition.js';
import type { CompositionScores } from '../../src/engine/corpus/composition.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import { GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';
import type { BannerPlan, EngineGrammar } from '../../src/engine/corpus/types.js';

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const SAMPLE_SEED_START = 20000;
const SAMPLE_COUNT = 200;

type CriterionKey = keyof CompositionScores;
const CRITERIA: CriterionKey[] = [
  'focalDominance',
  'balance',
  'negativeSpaceCluster',
  'rhythmQuality',
];

interface CorpusFile {
  banners: BannerPlan[];
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  // Linear interpolation between closest ranks.
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = rank - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : 'n/a';
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function main(): void {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as CorpusFile;
  const canon = corpus.banners;

  // Score CANON: keep id alongside each score for the low-scorer report.
  const canonScored = canon.map(plan => ({
    id: plan.id,
    scores: scoreComposition(plan, TILES),
  }));

  // Score SAMPLES.
  const G = GRAMMAR as EngineGrammar;
  const sampleScored: CompositionScores[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const seed = SAMPLE_SEED_START + i;
    const plan = samplePlan(G, seed);
    sampleScored.push(scoreComposition(plan, TILES));
  }

  console.log('# Composition calibration');
  console.log(`# canon banners: ${canon.length}   samples: ${sampleScored.length} (seeds ${SAMPLE_SEED_START}..${SAMPLE_SEED_START + SAMPLE_COUNT - 1})`);
  console.log('');
  console.log('## Per-criterion distributions (canon | samples)');
  console.log('');

  const header =
    pad('criterion', 22) +
    pad('pop', 8) +
    ['p10', 'p25', 'p50', 'p75', 'p90'].map(h => pad(h, 8)).join('');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const key of CRITERIA) {
    const canonVals = canonScored.map(c => c.scores[key]).sort((a, b) => a - b);
    const sampleVals = sampleScored.map(s => s[key]).sort((a, b) => a - b);

    const row = (label: string, vals: number[]): string =>
      pad('', 22) +
      pad(label, 8) +
      [10, 25, 50, 75, 90].map(p => pad(fmt(percentile(vals, p)), 8)).join('');

    console.log(pad(key, 22) + pad('canon', 8) +
      [10, 25, 50, 75, 90].map(p => pad(fmt(percentile(canonVals, p)), 8)).join(''));
    console.log(row('samples', sampleVals));
    console.log('');
  }

  console.log('## 5 lowest-scoring CANON banners per criterion');
  console.log('');
  for (const key of CRITERIA) {
    const ranked = [...canonScored].sort((a, b) => a.scores[key] - b.scores[key]).slice(0, 5);
    const line = ranked.map(r => `${r.id}=${fmt(r.scores[key])}`).join('  ');
    console.log(`${pad(key, 22)} ${line}`);
  }
  console.log('');
  console.log('# END — controller sets COMPOSITION_FLOORS from the above (calibration law: no criterion gates unless ≥90% of the 50 pass).');
}

main();
