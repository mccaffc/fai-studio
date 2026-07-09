/**
 * audit.ts — distribution audit for the seeded grammar sampler.
 *
 * Usage:
 *   npm run grammar:audit
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleWithDiagnostics } from './sample.js';
import { mulberry32, type Rng } from './rng.js';
import type { Grammar } from './grammar-schema.js';
import type { GroundSchemeKind } from './stats.js';
import type { BannerRecon, CellRecon } from '../mine/schema.js';
import { scoreComposition, passesCompositionFloors, COMPOSITION_FLOORS } from '../../src/engine/corpus/composition.js';
import { samplePlan } from '../../src/engine/corpus/sample.js';
import { GRAMMAR as ENGINE_GRAMMAR } from '../../src/engine/corpus/data/grammar.js';
import { TILES } from '../../src/engine/corpus/data/tiles.js';

const ROOT = process.cwd();
const GRAMMAR_PATH = join(ROOT, 'corpus', 'grammar.json');
const SEEDS = Array.from({ length: 60 }, (_value, index) => 5000 + index);
const CELL_COUNT = 18;
const CANON_ACCENT_DISTRIBUTION = [0.22, 0.20, 0.16, 0.42] as const;
const LOCKED_ACCENT_POOL = ['#FF4F00', '#FFA300', '#8265DB', '#0E8C88', '#268B41', '#4997D0', '#3A4A6B'] as const;
const GROUND_SCHEME_KINDS: GroundSchemeKind[] = [
  'uniform',
  'checker',
  'banded-rows',
  'banded-cols',
  'zoned',
  'scatter',
];

interface Weighted<T> {
  value: T;
  weight: number;
  sortKey: string;
}

interface Acceptance {
  label: string;
  pass: boolean;
  detail: string;
}

function main(): void {
  const grammar = JSON.parse(readFileSync(GRAMMAR_PATH, 'utf8')) as Grammar;
  const templateCounts: Record<string, number> = {};
  const familyCounts: Record<string, number> = {};
  const inkCounts: Record<string, number> = {};
  const groundSchemeCounts = emptyGroundSchemeCounts();
  const kindCounts = { plain: 0, freeform: 0, tile: 0 };
  const distinctCounts: number[] = [];
  const accentCountBuckets = [0, 0, 0, 0];
  const diagTotals = {
    adjacencyHits: 0,
    adjacencyFallbacks: 0,
    fillAdjacencyHits: 0,
    friezesPlaced: 0,
    runPathsTotal: 0,
  };
  const longestRuns: number[] = [];
  const accentInks = new Set<string>(LOCKED_ACCENT_POOL);
  let zeroFormPlans = 0;
  let zeroAccentPlans = 0;
  // Composition tracking across the 60-plan run.
  const compSums = { focalDominance: 0, balance: 0, negativeSpaceCluster: 0, rhythmQuality: 0 };
  let compFloorsPassCount = 0;

  for (const seed of SEEDS) {
    const template = chooseTemplateForSeed(grammar, seed);
    increment(templateCounts, template.id);

    const { plan, diag } = sampleWithDiagnostics(grammar, seed);
    // Composition scoring: sample via the engine (uses the baked grammar/tiles).
    const enginePlan = samplePlan(ENGINE_GRAMMAR, seed, {});
    const comp = scoreComposition(enginePlan, TILES);
    compSums.focalDominance += comp.focalDominance;
    compSums.balance += comp.balance;
    compSums.negativeSpaceCluster += comp.negativeSpaceCluster;
    compSums.rhythmQuality += comp.rhythmQuality;
    if (passesCompositionFloors(comp)) compFloorsPassCount += 1;
    diagTotals.adjacencyHits += diag.adjacencyHits;
    diagTotals.adjacencyFallbacks += diag.adjacencyFallbacks;
    diagTotals.fillAdjacencyHits += diag.fillAdjacencyHits;
    diagTotals.friezesPlaced += diag.friezesPlaced;
    diagTotals.runPathsTotal += diag.runPaths.length;
    longestRuns.push(diag.longestRun);

    if (plan.forms.length === 0) zeroFormPlans += 1;

    const distinct = new Set<string>();
    const visibleAccents = new Set<string>();
    for (const cell of plan.cells) {
      if (accentInks.has(cell.ground)) visibleAccents.add(cell.ground);
      if (cell.ink && accentInks.has(cell.ink)) visibleAccents.add(cell.ink);
      for (const ink of cell.inks ?? []) {
        if (accentInks.has(ink)) visibleAccents.add(ink);
      }
      if (cell.kind === 'plain') {
        kindCounts.plain += 1;
        continue;
      }
      if (cell.kind === 'freeform') kindCounts.freeform += 1;
      if (cell.kind === 'tile') kindCounts.tile += 1;
      if (cell.ink) {
        increment(inkCounts, cell.ink);
      }
      if (cell.kind === 'tile' && cell.tile) {
        distinct.add(cell.tile);
        increment(familyCounts, grammar.tileCatalog[cell.tile]?.family ?? 'unknown');
      }
    }
    if (visibleAccents.size === 0) zeroAccentPlans += 1;
    accentCountBuckets[Math.min(3, visibleAccents.size)] += 1;
    distinctCounts.push(distinct.size);
    groundSchemeCounts[classifyGroundScheme(plan)] += 1;
  }

  const corpusFamilyCounts = grammar.stats.families;
  const corpusInkCounts = flattenInkByGround(grammar.stats.inkByGround);
  const corpusGroundSchemes = grammar.stats.groundSchemes.counts;
  const sampleInkTotal = sumValues(inkCounts);
  const corpusInkTotal = sumValues(corpusInkCounts);
  const sampleBlackShare = share(inkCounts['#121212'] ?? 0, sampleInkTotal);
  const corpusBlackShare = share(corpusInkCounts['#121212'] ?? 0, corpusInkTotal);
  const sampleUniformShare = share(groundSchemeCounts.uniform, SEEDS.length);
  const corpusUniformShare = share(corpusGroundSchemes.uniform, sumValues(corpusGroundSchemes));
  const samplePlainShare = share(kindCounts.plain, SEEDS.length * CELL_COUNT);
  const corpusPlainShare = corpusPlainCellShare(grammar);
  const sampleMultiAccentShare = share(accentCountBuckets[2] + accentCountBuckets[3], SEEDS.length);

  const acceptances: Acceptance[] = [
    {
      label: 'black-ink share within 10pts of corpus',
      pass: Math.abs(sampleBlackShare - corpusBlackShare) <= 0.10,
      detail: `${formatPercent(sampleBlackShare)} sample vs ${formatPercent(corpusBlackShare)} corpus (${formatPointDiff(sampleBlackShare - corpusBlackShare)})`,
    },
    {
      label: 'uniform-ground share within 8pts',
      pass: Math.abs(sampleUniformShare - corpusUniformShare) <= 0.08,
      detail: `${formatPercent(sampleUniformShare)} sample vs ${formatPercent(corpusUniformShare)} corpus (${formatPointDiff(sampleUniformShare - corpusUniformShare)})`,
    },
    {
      label: 'plain share within 5pts',
      pass: Math.abs(samplePlainShare - corpusPlainShare) <= 0.05,
      detail: `${formatPercent(samplePlainShare)} sample vs ${formatPercent(corpusPlainShare)} corpus (${formatPointDiff(samplePlainShare - corpusPlainShare)})`,
    },
    {
      label: 'sampled {2,3}-accent plans >= 40%',
      pass: sampleMultiAccentShare >= 0.40,
      detail: `${formatPercent(sampleMultiAccentShare)} sample (${accentCountBuckets[2] + accentCountBuckets[3]}/60) vs 58.0% canon`,
    },
    {
      label: 'friezesPlaced > 0 across the 60',
      pass: diagTotals.friezesPlaced > 0,
      detail: String(diagTotals.friezesPlaced),
    },
  ];

  printReport({
    grammar,
    templateCounts,
    familyCounts,
    corpusFamilyCounts,
    inkCounts,
    corpusInkCounts,
    groundSchemeCounts,
    corpusGroundSchemes,
    kindCounts,
    accentCountBuckets,
    distinctMean: mean(distinctCounts),
    zeroFormPlans,
    zeroAccentPlans,
    diagTotals,
    longestRunMean: mean(longestRuns),
    longestRunMax: longestRuns.length > 0 ? Math.max(...longestRuns) : 0,
    acceptances,
    compMeans: {
      focalDominance: compSums.focalDominance / SEEDS.length,
      balance: compSums.balance / SEEDS.length,
      negativeSpaceCluster: compSums.negativeSpaceCluster / SEEDS.length,
      rhythmQuality: compSums.rhythmQuality / SEEDS.length,
    },
    compFloorsPassRate: compFloorsPassCount / SEEDS.length,
  });

  if (acceptances.some(result => !result.pass)) {
    process.exitCode = 1;
  }
}

function chooseTemplateForSeed(grammar: Grammar, seed: number): { id: string; bannerIds: string[] } {
  const rng = mulberry32(seed);
  return weightedChoice(
    rng,
    grammar.templates.map(template => ({
      value: template,
      weight: template.bannerIds.length,
      sortKey: template.id,
    })),
  );
}

function classifyGroundScheme(banner: BannerRecon): GroundSchemeKind {
  const offGlobal = banner.cells.filter(cell => cell.ground !== banner.ground);
  if (offGlobal.length <= 1) return 'uniform';
  if (isChecker(banner, offGlobal.length)) return 'checker';
  if (isBandedRows(banner)) return 'banded-rows';
  if (isBandedCols(banner)) return 'banded-cols';
  if (isZoned(banner)) return 'zoned';
  return 'scatter';
}

function isChecker(banner: BannerRecon, offGlobalCount: number): boolean {
  if (offGlobalCount < 8) return false;

  let noSameOffGlobalAdjacent = true;
  let alternatingPairs = 0;
  let totalPairs = 0;
  const byPosition = cellsByPosition(banner);

  for (let row = 0; row < banner.rows; row += 1) {
    for (let col = 0; col < banner.cols; col += 1) {
      const cell = byPosition.get(`${col},${row}`);
      if (!cell) continue;

      for (const [nextCol, nextRow] of [[col + 1, row], [col, row + 1]] as const) {
        if (nextCol >= banner.cols || nextRow >= banner.rows) continue;
        const neighbor = byPosition.get(`${nextCol},${nextRow}`);
        if (!neighbor) continue;

        totalPairs += 1;
        if (cell.ground !== neighbor.ground) alternatingPairs += 1;
        if (
          cell.ground !== banner.ground &&
          neighbor.ground !== banner.ground &&
          cell.ground === neighbor.ground
        ) {
          noSameOffGlobalAdjacent = false;
        }
      }
    }
  }

  const alternationShare = totalPairs === 0 ? 0 : alternatingPairs / totalPairs;
  return noSameOffGlobalAdjacent || alternationShare >= 0.8;
}

function isBandedRows(banner: BannerRecon): boolean {
  const byPosition = cellsByPosition(banner);
  const rowGrounds: string[] = [];
  for (let row = 0; row < banner.rows; row += 1) {
    const first = byPosition.get(`0,${row}`)?.ground;
    if (!first) return false;
    for (let col = 1; col < banner.cols; col += 1) {
      if (byPosition.get(`${col},${row}`)?.ground !== first) return false;
    }
    rowGrounds.push(first);
  }
  return new Set(rowGrounds).size >= 2;
}

function isBandedCols(banner: BannerRecon): boolean {
  const byPosition = cellsByPosition(banner);
  const colGrounds: string[] = [];
  for (let col = 0; col < banner.cols; col += 1) {
    const first = byPosition.get(`${col},0`)?.ground;
    if (!first) return false;
    for (let row = 1; row < banner.rows; row += 1) {
      if (byPosition.get(`${col},${row}`)?.ground !== first) return false;
    }
    colGrounds.push(first);
  }
  return new Set(colGrounds).size >= 2;
}

function isZoned(banner: BannerRecon): boolean {
  const offGlobal = new Set(
    banner.cells
      .filter(cell => cell.ground !== banner.ground)
      .map(cell => positionKey(cell)),
  );
  if (offGlobal.size === 0) return false;

  const visited = new Set<string>();
  const regionSizes: number[] = [];
  for (const start of offGlobal) {
    if (visited.has(start)) continue;
    let size = 0;
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const key = stack.pop()!;
      size += 1;
      const [col, row] = parsePositionKey(key);
      for (const [nextCol, nextRow] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]] as const) {
        if (nextCol < 0 || nextCol >= banner.cols || nextRow < 0 || nextRow >= banner.rows) continue;
        const nextKey = `${nextCol},${nextRow}`;
        if (!offGlobal.has(nextKey) || visited.has(nextKey)) continue;
        visited.add(nextKey);
        stack.push(nextKey);
      }
    }
    regionSizes.push(size);
  }
  return regionSizes.length <= 3 && regionSizes.every(size => size >= 2);
}

function printReport(input: {
  grammar: Grammar;
  templateCounts: Record<string, number>;
  familyCounts: Record<string, number>;
  corpusFamilyCounts: Record<string, number>;
  inkCounts: Record<string, number>;
  corpusInkCounts: Record<string, number>;
  groundSchemeCounts: Record<GroundSchemeKind, number>;
  corpusGroundSchemes: Record<GroundSchemeKind, number>;
  kindCounts: { plain: number; freeform: number; tile: number };
  accentCountBuckets: number[];
  distinctMean: number;
  zeroFormPlans: number;
  zeroAccentPlans: number;
  diagTotals: SampleDiagTotals;
  longestRunMean: number;
  longestRunMax: number;
  acceptances: Acceptance[];
  compMeans: { focalDominance: number; balance: number; negativeSpaceCluster: number; rhythmQuality: number };
  compFloorsPassRate: number;
}): void {
  console.log('Grammar sampler audit');
  console.log(`Seeds: ${SEEDS[0]}-${SEEDS[SEEDS.length - 1]} (${SEEDS.length} plans)`);
  console.log('');

  console.log('Template usage');
  const corpusTemplateTotal = input.grammar.templates.reduce((sum, template) => sum + template.bannerIds.length, 0);
  for (const template of input.grammar.templates) {
    const sampled = input.templateCounts[template.id] ?? 0;
    console.log(`  ${pad(template.id, 15)} ${padCount(sampled)} ${formatPercent(share(sampled, SEEDS.length))} sample | ${formatPercent(share(template.bannerIds.length, corpusTemplateTotal))} corpus`);
  }
  console.log('');

  console.log(`Distinct tiles mean: ${input.distinctMean.toFixed(2)}`);
  console.log('');

  console.log('Family shares (sample vs corpus)');
  printShareTable(input.familyCounts, input.corpusFamilyCounts);
  console.log('');

  console.log('Ink shares (sample vs corpus)');
  printShareTable(input.inkCounts, input.corpusInkCounts);
  console.log('');

  console.log('Ground schemes (sample vs corpus)');
  printShareTable(input.groundSchemeCounts, input.corpusGroundSchemes, GROUND_SCHEME_KINDS);
  console.log('');

  console.log('Accent-count distribution (sample vs canon)');
  for (let bucket = 0; bucket < CANON_ACCENT_DISTRIBUTION.length; bucket += 1) {
    const sampled = input.accentCountBuckets[bucket] ?? 0;
    const canon = CANON_ACCENT_DISTRIBUTION[bucket]!;
    console.log(`  ${pad(`${bucket} accents`, 15)} ${padCount(sampled)} ${formatPercent(share(sampled, SEEDS.length))} sample | ${formatPercent(canon)} canon`);
  }
  console.log('');

  const totalCells = SEEDS.length * CELL_COUNT;
  console.log('Cell-kind shares');
  console.log(`  ${pad('tile', 15)} ${formatPercent(share(input.kindCounts.tile, totalCells))}`);
  console.log(`  ${pad('plain', 15)} ${formatPercent(share(input.kindCounts.plain, totalCells))}`);
  console.log(`  ${pad('freeform', 15)} ${formatPercent(share(input.kindCounts.freeform, totalCells))}`);
  console.log('');

  const adjacencyAttempts = input.diagTotals.adjacencyHits + input.diagTotals.adjacencyFallbacks;
  console.log('Diagnostics');
  console.log(`  zero-form plans: ${input.zeroFormPlans}/60`);
  console.log(`  zero-accent plans: ${input.zeroAccentPlans}/60`);
  console.log(`  adjacency hits: ${input.diagTotals.adjacencyHits}`);
  console.log(`  adjacency fallbacks: ${input.diagTotals.adjacencyFallbacks}`);
  console.log(`  adjacency hit rate: ${formatPercent(share(input.diagTotals.adjacencyHits, adjacencyAttempts))}`);
  console.log(`  fill adjacency hits: ${input.diagTotals.fillAdjacencyHits}`);
  console.log(`  friezes placed: ${input.diagTotals.friezesPlaced}`);
  console.log(`  run paths: mean ${(input.diagTotals.runPathsTotal / SEEDS.length).toFixed(2)} per plan`);
  console.log(`  longest run: mean ${input.longestRunMean.toFixed(2)} / max ${input.longestRunMax}`);
  console.log('');

  console.log('Composition means (60-plan run, engine sampler)');
  console.log(`  focalDominance  mean: ${input.compMeans.focalDominance.toFixed(3)}  (floor ≥ ${COMPOSITION_FLOORS.focalDominance})`);
  console.log(`  balance         mean: ${input.compMeans.balance.toFixed(3)}  (display-only)`);
  console.log(`  negSpaceCluster mean: ${input.compMeans.negativeSpaceCluster.toFixed(3)}  (display-only)`);
  console.log(`  rhythmQuality   mean: ${input.compMeans.rhythmQuality.toFixed(3)}  (floor ≥ ${COMPOSITION_FLOORS.rhythmQuality})`);
  console.log(`  floors pass-rate: ${formatPercent(input.compFloorsPassRate)} (${Math.round(input.compFloorsPassRate * 60)}/60)`);
  console.log('');

  console.log('Acceptance');
  for (const result of input.acceptances) {
    console.log(`  ${result.pass ? 'PASS' : 'FAIL'} ${result.label}: ${result.detail}`);
  }
}

interface SampleDiagTotals {
  adjacencyHits: number;
  adjacencyFallbacks: number;
  fillAdjacencyHits: number;
  friezesPlaced: number;
  runPathsTotal: number;
}

function printShareTable(sample: Record<string, number>, corpus: Record<string, number>, orderedKeys?: string[]): void {
  const keys = orderedKeys ?? [...new Set([...Object.keys(sample), ...Object.keys(corpus)])].sort(compareCodepoint);
  const sampleTotal = sumValues(sample);
  const corpusTotal = sumValues(corpus);
  for (const key of keys) {
    const sampleCount = sample[key] ?? 0;
    const corpusCount = corpus[key] ?? 0;
    if (sampleCount === 0 && corpusCount === 0) continue;
    console.log(`  ${pad(key, 15)} ${formatPercent(share(sampleCount, sampleTotal))} sample | ${formatPercent(share(corpusCount, corpusTotal))} corpus`);
  }
}

function flattenInkByGround(inkByGround: Record<string, Record<string, number>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const inkMap of Object.values(inkByGround)) {
    for (const [ink, count] of Object.entries(inkMap)) {
      increment(counts, ink, count);
    }
  }
  return counts;
}

function corpusPlainCellShare(grammar: Grammar): number {
  let plainCells = 0;
  let banners = 0;
  for (const [plainCount, count] of Object.entries(grammar.stats.plain.perBannerHistogram)) {
    plainCells += Number(plainCount) * count;
    banners += count;
  }
  return share(plainCells, banners * CELL_COUNT);
}

function emptyGroundSchemeCounts(): Record<GroundSchemeKind, number> {
  return {
    uniform: 0,
    checker: 0,
    'banded-rows': 0,
    'banded-cols': 0,
    zoned: 0,
    scatter: 0,
  };
}

function cellsByPosition(banner: BannerRecon): Map<string, CellRecon> {
  const cells = new Map<string, CellRecon>();
  for (const cell of banner.cells) {
    cells.set(positionKey(cell), cell);
  }
  return cells;
}

function weightedChoice<T>(rng: Rng, entries: Weighted<T>[]): T {
  const sorted = [...entries].sort((a, b) => compareCodepoint(a.sortKey, b.sortKey));
  const positive = sorted.filter(entry => entry.weight > 0);
  const usable = positive.length > 0 ? positive : sorted.map(entry => ({ ...entry, weight: 1 }));
  const total = usable.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.next() * total;
  for (const entry of usable) {
    roll -= entry.weight;
    if (roll < 0) return entry.value;
  }
  return usable[usable.length - 1]!.value;
}

function increment(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumValues(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPointDiff(value: number): string {
  const points = value * 100;
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)}pts`;
}

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

function padCount(value: number): string {
  return String(value).padStart(2, ' ');
}

function positionKey(cell: Pick<CellRecon, 'col' | 'row'>): string {
  return `${cell.col},${cell.row}`;
}

function parsePositionKey(key: string): [number, number] {
  const [col, row] = key.split(',').map(Number);
  if (col === undefined || row === undefined || !Number.isFinite(col) || !Number.isFinite(row)) {
    throw new Error(`Invalid cell position key: ${key}`);
  }
  return [col, row];
}

function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

main();
