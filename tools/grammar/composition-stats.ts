/**
 * composition-stats.ts — canon measurement for P10 composition steering laws.
 *
 * This is a measurement-only tool. It reads the 50 canonical banners, derives
 * raw per-banner measurements for the three proposed laws, writes
 * corpus/composition-laws.json, and prints deterministic tables for the task
 * report. It does not set thresholds or touch the engine.
 *
 * Usage: npm run grammar:composition-stats
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMergedManifest } from '../mine/render-recon.js';
import type { BannerRecon, CellRecon, Corpus, FormGroup, ManifestTile } from '../mine/schema.js';
import { NEUTRAL_INKS } from './features.js';
import { TEMPLATE_MEMBERS } from './templates.js';

const ROOT = process.cwd();
const CORPUS_PATH = join(ROOT, 'corpus', 'corpus.json');
const OUT_PATH = join(ROOT, 'corpus', 'composition-laws.json');
const RHYTHM_TEMPLATE_IDS = ['checker-motif', 'repeat-rhythm'] as const;
const THIRD_POINTS = [
  { label: '1/3,1/3', x: 1 / 3, y: 1 / 3 },
  { label: '2/3,1/3', x: 2 / 3, y: 1 / 3 },
  { label: '1/3,2/3', x: 1 / 3, y: 2 / 3 },
  { label: '2/3,2/3', x: 2 / 3, y: 2 / 3 },
] as const;

type Manifest = Map<string, ManifestTile & { baseDir: string }>;
type Position = { col: number; row: number };
type Axis = 'row' | 'column';
type LineClassification = 'perfect' | 'one-interrupt' | 'other';
type InterruptionPosition = 'edge' | 'interior';
type FocalSource = 'figure-form' | 'form-region' | 'signature-region';

export interface CompositionLawMeasurements {
  schemaVersion: 1;
  source: {
    corpusPath: 'corpus/corpus.json';
    corpusMinedAt: string;
    bannerCount: number;
    neutralFills: string[];
    rhythmTemplates: typeof RHYTHM_TEMPLATE_IDS[number][];
  };
  definitions: {
    accentCell: string;
    accentComponent: string;
    isolatedAccentCell: string;
    singletonDistance: string;
    focalCandidate: string;
    focalCentroid: string;
    centerCell: string;
    rhythmUnit: string;
    rhythmInterruption: string;
  };
  banners: BannerCompositionMeasurements[];
  aggregates: CompositionLawAggregates;
}

export interface BannerCompositionMeasurements {
  id: string;
  templateId: string | null;
  accentProximity: AccentProximityMeasurement;
  focalPosition: FocalPositionMeasurement | null;
  rhythmBreak: RhythmBreakMeasurement | null;
}

export interface AccentProximityMeasurement {
  accentCells: number;
  accentFills: string[];
  componentCount: number;
  componentSizes: number[];
  components: AccentComponent[];
  isolatedAccentCells: IsolatedAccentCell[];
  isolatedAccentCellShare: number;
  isolatedCornerSingletons: number;
}

export interface AccentComponent {
  size: number;
  fills: string[];
  cells: Position[];
}

export interface IsolatedAccentCell extends Position {
  fills: string[];
  nearestDistance: number | null;
  nearestCell: Position | null;
  corner: boolean;
}

export interface FocalPositionMeasurement {
  source: FocalSource;
  label: string;
  size: number;
  fill: string | null;
  family: string | null;
  formKind: FormGroup['kind'] | null;
  signature: string | null;
  cells: Position[];
  centroid: { x: number; y: number };
  centroidCell: Position;
  inCenterCell: boolean;
  distanceToCenter: number;
  nearestThird: { label: string; x: number; y: number; distance: number };
}

export interface RhythmBreakMeasurement {
  templateId: typeof RHYTHM_TEMPLATE_IDS[number];
  rows: RhythmLineMeasurement[];
  columns: RhythmLineMeasurement[];
  perfectLines: number;
  oneInterruptLines: number;
  edgeInterruptions: number;
  interiorInterruptions: number;
}

export interface RhythmLineMeasurement {
  axis: Axis;
  index: number;
  length: number;
  classification: LineClassification;
  repeatedSignature: string | null;
  interrupt: {
    cell: Position;
    signature: string;
    position: InterruptionPosition;
  } | null;
  signatures: string[];
}

export interface CompositionLawAggregates {
  accentProximity: {
    accentedBannerCount: number;
    totalAccentCells: number;
    componentCount: NumberSummary;
    componentSize: NumberSummary;
    componentCountDistribution: Record<string, number>;
    bannersWithAtMost2Components: number;
    bannersWithAtMost2ComponentsShare: number;
    isolatedAccentCells: number;
    isolatedAccentCellShare: number;
    isolatedCornerSingletons: number;
    isolatedSingletonNearestDistance: NumberSummary;
  };
  focalPosition: {
    detectableBannerCount: number;
    sourceCounts: Record<string, number>;
    centerCellCount: number;
    offCenterCount: number;
    centerCellShare: number;
    centroidX: NumberSummary;
    centroidY: NumberSummary;
    distanceToCenter: NumberSummary;
    distanceToNearestThird: NumberSummary;
    nearestThirdCounts: Record<string, number>;
  };
  rhythmBreak: {
    measuredBannerCount: number;
    lineCount: number;
    rowCount: number;
    columnCount: number;
    perfectLineCount: number;
    oneInterruptLineCount: number;
    otherLineCount: number;
    interruptionFrequency: number;
    edgeInterruptions: number;
    interiorInterruptions: number;
    edgeInterruptionShare: number;
    rowPerfectCount: number;
    rowOneInterruptCount: number;
    columnPerfectCount: number;
    columnOneInterruptCount: number;
    rowInterruptionPositions: Record<string, number>;
    columnInterruptionPositions: Record<string, number>;
    byTemplate: Record<string, {
      banners: number;
      lines: number;
      perfectLines: number;
      oneInterruptLines: number;
      edgeInterruptions: number;
      interiorInterruptions: number;
    }>;
  };
}

export interface NumberSummary {
  count: number;
  min: number | null;
  p10: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
  mean: number | null;
}

interface FocalCandidate {
  source: FocalSource;
  label: string;
  fill: string | null;
  family: string | null;
  formKind: FormGroup['kind'] | null;
  signature: string | null;
  cells: Position[];
}

interface AccentNode {
  cell: CellRecon;
  fills: string[];
}

export function measureCompositionLaws(
  corpus: Corpus,
  manifest: Manifest,
): CompositionLawMeasurements {
  const templateByBanner = buildTemplateLookup();
  const banners = corpus.banners.map((banner): BannerCompositionMeasurements => {
    const templateId = templateByBanner.get(banner.id) ?? null;
    return {
      id: banner.id,
      templateId,
      accentProximity: measureAccentProximity(banner),
      focalPosition: measureFocalPosition(banner, manifest),
      rhythmBreak: isRhythmTemplate(templateId) ? measureRhythmBreak(banner, templateId) : null,
    };
  });

  return {
    schemaVersion: 1,
    source: {
      corpusPath: 'corpus/corpus.json',
      corpusMinedAt: corpus.minedAt,
      bannerCount: corpus.banners.length,
      neutralFills: [...NEUTRAL_INKS].sort(compareCodepoint),
      rhythmTemplates: [...RHYTHM_TEMPLATE_IDS],
    },
    definitions: {
      accentCell: 'A cell is accented when ground, ink, or any inks[] entry contains at least one exact non-neutral hex fill.',
      accentComponent: 'Accent components are 8-neighbor connected accent cells; an edge exists only when adjacent cells share at least one exact non-neutral fill.',
      isolatedAccentCell: 'An isolated accent cell has no 8-neighbor accent cell of any fill.',
      singletonDistance: 'Singleton distance is Euclidean center-to-center grid-cell distance to the nearest other accent cell; null when no other accent cell exists.',
      focalCandidate: 'Focal candidates are explicit figure forms of any size, explicit non-figure forms with at least 3 cells, and fallback 8-neighbor regions of non-plain cells sharing exact dominant ink plus family/kind with at least 3 cells. The largest candidate wins; ties prefer explicit figure forms, then other explicit forms, then fallback regions.',
      focalCentroid: 'Centroids average the centers of the focal cells and normalize x/y to [0,1].',
      centerCell: 'For the 6x3 canon grid, center cell means centroid landing in col 2 or 3 and row 1.',
      rhythmUnit: 'Rhythm units use kind/tile/dominant-ink/ground. Rotation, flip, and secondary inks are ignored because the brief names tile/ink/ground as the interruption dimensions.',
      rhythmInterruption: 'A row or column is perfect when every rhythm unit matches; it has exactly one interruption when one cell differs from a repeated majority unit.',
    },
    banners,
    aggregates: aggregateMeasurements(banners),
  };
}

export function renderMeasurementTables(measurements: CompositionLawMeasurements): string {
  const sections = [
    '# Composition law canon measurement',
    '',
    `Corpus: ${measurements.source.corpusPath} (${measurements.source.bannerCount} banners, mined ${measurements.source.corpusMinedAt})`,
    `Neutral fills: ${measurements.source.neutralFills.join(', ')}`,
    `Rhythm templates: ${measurements.source.rhythmTemplates.join(', ')}`,
    '',
    '## Definitions',
    metricTable(Object.entries(measurements.definitions).map(([key, value]) => [key, value])),
    '',
    '## Accent proximity aggregate',
    metricTable([
      ['accented banners', String(measurements.aggregates.accentProximity.accentedBannerCount)],
      ['total accent cells', String(measurements.aggregates.accentProximity.totalAccentCells)],
      ['component count mean', formatNullable(measurements.aggregates.accentProximity.componentCount.mean)],
      ['component count median', formatNullable(measurements.aggregates.accentProximity.componentCount.median)],
      ['component count max', formatNullable(measurements.aggregates.accentProximity.componentCount.max)],
      ['banners with <=2 components', `${measurements.aggregates.accentProximity.bannersWithAtMost2Components} (${formatPercent(measurements.aggregates.accentProximity.bannersWithAtMost2ComponentsShare)})`],
      ['isolated accent cells', `${measurements.aggregates.accentProximity.isolatedAccentCells} (${formatPercent(measurements.aggregates.accentProximity.isolatedAccentCellShare)} of accent cells)`],
      ['isolated corner singletons', String(measurements.aggregates.accentProximity.isolatedCornerSingletons)],
      ['singleton nearest-distance mean', formatNullable(measurements.aggregates.accentProximity.isolatedSingletonNearestDistance.mean)],
      ['singleton nearest-distance max', formatNullable(measurements.aggregates.accentProximity.isolatedSingletonNearestDistance.max)],
    ]),
    '',
    '## Accent proximity by accented banner',
    markdownTable(
      ['id', 'accent cells', 'fills', 'components', 'sizes', 'isolated', 'isolated share', 'singleton distances', 'corner singletons'],
      measurements.banners
        .filter(banner => banner.accentProximity.accentCells > 0)
        .map(banner => [
          banner.id,
          String(banner.accentProximity.accentCells),
          banner.accentProximity.accentFills.join(' '),
          String(banner.accentProximity.componentCount),
          banner.accentProximity.componentSizes.join(','),
          String(banner.accentProximity.isolatedAccentCells.length),
          formatPercent(banner.accentProximity.isolatedAccentCellShare),
          banner.accentProximity.isolatedAccentCells.map(cell => formatNullable(cell.nearestDistance)).join(',') || '-',
          String(banner.accentProximity.isolatedCornerSingletons),
        ]),
    ),
    '',
    '## Focal position aggregate',
    metricTable([
      ['detectable banners', String(measurements.aggregates.focalPosition.detectableBannerCount)],
      ['source counts', formatRecord(measurements.aggregates.focalPosition.sourceCounts)],
      ['center-cell focals', `${measurements.aggregates.focalPosition.centerCellCount} (${formatPercent(measurements.aggregates.focalPosition.centerCellShare)})`],
      ['off-center focals', String(measurements.aggregates.focalPosition.offCenterCount)],
      ['centroid x mean', formatNullable(measurements.aggregates.focalPosition.centroidX.mean)],
      ['centroid y mean', formatNullable(measurements.aggregates.focalPosition.centroidY.mean)],
      ['distance to center mean', formatNullable(measurements.aggregates.focalPosition.distanceToCenter.mean)],
      ['distance to center median', formatNullable(measurements.aggregates.focalPosition.distanceToCenter.median)],
      ['distance to nearest third mean', formatNullable(measurements.aggregates.focalPosition.distanceToNearestThird.mean)],
      ['distance to nearest third median', formatNullable(measurements.aggregates.focalPosition.distanceToNearestThird.median)],
      ['nearest third counts', formatRecord(measurements.aggregates.focalPosition.nearestThirdCounts)],
    ]),
    '',
    '## Focal position by detectable banner',
    markdownTable(
      ['id', 'source', 'label', 'size', 'fill', 'family', 'centroid x', 'centroid y', 'centroid cell', 'center cell?', 'dist center', 'nearest third', 'dist third'],
      measurements.banners
        .filter((banner): banner is BannerCompositionMeasurements & { focalPosition: FocalPositionMeasurement } => banner.focalPosition !== null)
        .map(banner => [
          banner.id,
          banner.focalPosition.source,
          banner.focalPosition.label,
          String(banner.focalPosition.size),
          banner.focalPosition.fill ?? '-',
          banner.focalPosition.family ?? '-',
          formatNumber(banner.focalPosition.centroid.x),
          formatNumber(banner.focalPosition.centroid.y),
          `${banner.focalPosition.centroidCell.col},${banner.focalPosition.centroidCell.row}`,
          banner.focalPosition.inCenterCell ? 'yes' : 'no',
          formatNumber(banner.focalPosition.distanceToCenter),
          banner.focalPosition.nearestThird.label,
          formatNumber(banner.focalPosition.nearestThird.distance),
        ]),
    ),
    '',
    '## Rhythm break aggregate',
    metricTable([
      ['measured banners', String(measurements.aggregates.rhythmBreak.measuredBannerCount)],
      ['lines measured', String(measurements.aggregates.rhythmBreak.lineCount)],
      ['perfect lines', String(measurements.aggregates.rhythmBreak.perfectLineCount)],
      ['one-interrupt lines', `${measurements.aggregates.rhythmBreak.oneInterruptLineCount} (${formatPercent(measurements.aggregates.rhythmBreak.interruptionFrequency)} of lines)`],
      ['other lines', String(measurements.aggregates.rhythmBreak.otherLineCount)],
      ['edge interruptions', `${measurements.aggregates.rhythmBreak.edgeInterruptions} (${formatPercent(measurements.aggregates.rhythmBreak.edgeInterruptionShare)} of one-interrupt lines)`],
      ['interior interruptions', String(measurements.aggregates.rhythmBreak.interiorInterruptions)],
      ['row perfect / one-interrupt', `${measurements.aggregates.rhythmBreak.rowPerfectCount} / ${measurements.aggregates.rhythmBreak.rowOneInterruptCount}`],
      ['column perfect / one-interrupt', `${measurements.aggregates.rhythmBreak.columnPerfectCount} / ${measurements.aggregates.rhythmBreak.columnOneInterruptCount}`],
      ['row interruption positions', formatRecord(measurements.aggregates.rhythmBreak.rowInterruptionPositions)],
      ['column interruption positions', formatRecord(measurements.aggregates.rhythmBreak.columnInterruptionPositions)],
    ]),
    '',
    '## Rhythm break by selected banner',
    markdownTable(
      ['id', 'template', 'perfect lines', 'one-interrupt lines', 'edge interrupts', 'interior interrupts'],
      measurements.banners
        .filter((banner): banner is BannerCompositionMeasurements & { rhythmBreak: RhythmBreakMeasurement } => banner.rhythmBreak !== null)
        .map(banner => [
          banner.id,
          banner.rhythmBreak.templateId,
          String(banner.rhythmBreak.perfectLines),
          String(banner.rhythmBreak.oneInterruptLines),
          String(banner.rhythmBreak.edgeInterruptions),
          String(banner.rhythmBreak.interiorInterruptions),
        ]),
    ),
    '',
    '## Rhythm break line table',
    markdownTable(
      ['id', 'template', 'axis', 'index', 'classification', 'repeated unit', 'interrupt cell', 'interrupt position', 'interrupt unit'],
      measurements.banners
        .filter((banner): banner is BannerCompositionMeasurements & { rhythmBreak: RhythmBreakMeasurement } => banner.rhythmBreak !== null)
        .flatMap(banner => [...banner.rhythmBreak.rows, ...banner.rhythmBreak.columns].map(line => [
          banner.id,
          banner.rhythmBreak.templateId,
          line.axis,
          String(line.index),
          line.classification,
          line.repeatedSignature ?? '-',
          line.interrupt ? `${line.interrupt.cell.col},${line.interrupt.cell.row}` : '-',
          line.interrupt?.position ?? '-',
          line.interrupt?.signature ?? '-',
        ])),
    ),
  ];

  return sections.join('\n');
}

function measureAccentProximity(banner: BannerRecon): AccentProximityMeasurement {
  const byPosition = cellsByPosition(banner);
  const nodes = new Map<string, AccentNode>();
  for (const cell of banner.cells) {
    const fills = accentFillsForCell(cell);
    if (fills.length > 0) {
      nodes.set(positionKey(cell), { cell, fills });
    }
  }

  const visited = new Set<string>();
  const components: AccentComponent[] = [];
  for (const [startKey, start] of [...nodes.entries()].sort(([a], [b]) => comparePositionKey(a, b))) {
    if (visited.has(startKey)) continue;
    const stack = [startKey];
    visited.add(startKey);
    const cells: Position[] = [];
    const fills = new Set<string>();

    while (stack.length > 0) {
      const key = stack.pop()!;
      const node = nodes.get(key)!;
      cells.push({ col: node.cell.col, row: node.cell.row });
      for (const fill of node.fills) fills.add(fill);

      for (const neighbor of accentNeighbors(node.cell, banner, nodes, byPosition)) {
        if (visited.has(neighbor.key)) continue;
        if (!sharesAny(node.fills, neighbor.node.fills)) continue;
        visited.add(neighbor.key);
        stack.push(neighbor.key);
      }
    }

    const sortedCells = cells.sort(comparePositions);
    components.push({
      size: sortedCells.length,
      fills: [...fills].sort(compareCodepoint),
      cells: sortedCells,
    });
  }

  components.sort((a, b) => b.size - a.size || comparePositions(a.cells[0]!, b.cells[0]!));

  const isolatedAccentCells = [...nodes.values()]
    .filter(node => accentNeighbors(node.cell, banner, nodes, byPosition).length === 0)
    .map(node => nearestAccentSingleton(node, [...nodes.values()], banner))
    .sort(comparePositions);

  return {
    accentCells: nodes.size,
    accentFills: [...new Set([...nodes.values()].flatMap(node => node.fills))].sort(compareCodepoint),
    componentCount: components.length,
    componentSizes: components.map(component => component.size),
    components,
    isolatedAccentCells,
    isolatedAccentCellShare: share(isolatedAccentCells.length, nodes.size),
    isolatedCornerSingletons: isolatedAccentCells.filter(cell => cell.corner).length,
  };
}

function measureFocalPosition(banner: BannerRecon, manifest: Manifest): FocalPositionMeasurement | null {
  const candidates = [
    ...formFocalCandidates(banner),
    ...signatureRegionFocalCandidates(banner, manifest),
  ];

  if (candidates.length === 0) {
    return null;
  }

  const winner = candidates
    .sort((a, b) =>
      b.cells.length - a.cells.length ||
      focalSourceRank(a.source) - focalSourceRank(b.source) ||
      compareCodepoint(a.label, b.label))[0]!;
  const cells = winner.cells.sort(comparePositions);
  const centroid = focalCentroid(cells, banner);
  const centroidCell = centroidContainingCell(centroid, banner);
  const nearestThird = nearestThirdPoint(centroid);

  return {
    source: winner.source,
    label: winner.label,
    size: cells.length,
    fill: winner.fill,
    family: winner.family,
    formKind: winner.formKind,
    signature: winner.signature,
    cells,
    centroid,
    centroidCell,
    inCenterCell: isCenterCell(centroidCell, banner),
    distanceToCenter: round(distance(centroid.x, centroid.y, 0.5, 0.5)),
    nearestThird,
  };
}

function measureRhythmBreak(
  banner: BannerRecon,
  templateId: typeof RHYTHM_TEMPLATE_IDS[number],
): RhythmBreakMeasurement {
  const rows: RhythmLineMeasurement[] = [];
  const columns: RhythmLineMeasurement[] = [];
  const byPosition = cellsByPosition(banner);

  for (let row = 0; row < banner.rows; row += 1) {
    const cells: CellRecon[] = [];
    for (let col = 0; col < banner.cols; col += 1) {
      const cell = byPosition.get(`${col},${row}`);
      if (!cell) throw new Error(`banner ${banner.id}: missing cell ${col},${row}`);
      cells.push(cell);
    }
    rows.push(classifyRhythmLine(cells, 'row', row));
  }

  for (let col = 0; col < banner.cols; col += 1) {
    const cells: CellRecon[] = [];
    for (let row = 0; row < banner.rows; row += 1) {
      const cell = byPosition.get(`${col},${row}`);
      if (!cell) throw new Error(`banner ${banner.id}: missing cell ${col},${row}`);
      cells.push(cell);
    }
    columns.push(classifyRhythmLine(cells, 'column', col));
  }

  const lines = [...rows, ...columns];
  return {
    templateId,
    rows,
    columns,
    perfectLines: lines.filter(line => line.classification === 'perfect').length,
    oneInterruptLines: lines.filter(line => line.classification === 'one-interrupt').length,
    edgeInterruptions: lines.filter(line => line.interrupt?.position === 'edge').length,
    interiorInterruptions: lines.filter(line => line.interrupt?.position === 'interior').length,
  };
}

function aggregateMeasurements(banners: BannerCompositionMeasurements[]): CompositionLawAggregates {
  const accented = banners.map(banner => banner.accentProximity).filter(measurement => measurement.accentCells > 0);
  const totalAccentCells = sum(accented.map(measurement => measurement.accentCells));
  const isolatedAccentCells = sum(accented.map(measurement => measurement.isolatedAccentCells.length));
  const componentCounts = accented.map(measurement => measurement.componentCount);
  const componentSizes = accented.flatMap(measurement => measurement.componentSizes);
  const singletonDistances = accented.flatMap(measurement =>
    measurement.isolatedAccentCells
      .map(cell => cell.nearestDistance)
      .filter((value): value is number => value !== null));
  const atMost2 = accented.filter(measurement => measurement.componentCount <= 2).length;

  const focals = banners
    .map(banner => banner.focalPosition)
    .filter((measurement): measurement is FocalPositionMeasurement => measurement !== null);
  const sourceCounts: Record<string, number> = {};
  const nearestThirdCounts: Record<string, number> = {};
  for (const focal of focals) {
    increment(sourceCounts, focal.source);
    increment(nearestThirdCounts, focal.nearestThird.label);
  }
  const centerCellCount = focals.filter(focal => focal.inCenterCell).length;

  const rhythmBreaks = banners
    .map(banner => banner.rhythmBreak)
    .filter((measurement): measurement is RhythmBreakMeasurement => measurement !== null);
  const rhythmLines = rhythmBreaks.flatMap(measurement => [...measurement.rows, ...measurement.columns]);
  const oneInterruptLines = rhythmLines.filter(line => line.classification === 'one-interrupt');
  const rowLines = rhythmLines.filter(line => line.axis === 'row');
  const columnLines = rhythmLines.filter(line => line.axis === 'column');
  const rowInterruptionPositions: Record<string, number> = {};
  const columnInterruptionPositions: Record<string, number> = {};
  const byTemplate: CompositionLawAggregates['rhythmBreak']['byTemplate'] = {};

  for (const line of oneInterruptLines) {
    if (!line.interrupt) continue;
    if (line.axis === 'row') {
      increment(rowInterruptionPositions, String(line.interrupt.cell.col));
    } else {
      increment(columnInterruptionPositions, String(line.interrupt.cell.row));
    }
  }

  for (const measurement of rhythmBreaks) {
    const lines = [...measurement.rows, ...measurement.columns];
    const table = byTemplate[measurement.templateId] ?? {
      banners: 0,
      lines: 0,
      perfectLines: 0,
      oneInterruptLines: 0,
      edgeInterruptions: 0,
      interiorInterruptions: 0,
    };
    table.banners += 1;
    table.lines += lines.length;
    table.perfectLines += lines.filter(line => line.classification === 'perfect').length;
    table.oneInterruptLines += lines.filter(line => line.classification === 'one-interrupt').length;
    table.edgeInterruptions += lines.filter(line => line.interrupt?.position === 'edge').length;
    table.interiorInterruptions += lines.filter(line => line.interrupt?.position === 'interior').length;
    byTemplate[measurement.templateId] = table;
  }

  return {
    accentProximity: {
      accentedBannerCount: accented.length,
      totalAccentCells,
      componentCount: summarize(componentCounts),
      componentSize: summarize(componentSizes),
      componentCountDistribution: distribution(componentCounts),
      bannersWithAtMost2Components: atMost2,
      bannersWithAtMost2ComponentsShare: share(atMost2, accented.length),
      isolatedAccentCells,
      isolatedAccentCellShare: share(isolatedAccentCells, totalAccentCells),
      isolatedCornerSingletons: sum(accented.map(measurement => measurement.isolatedCornerSingletons)),
      isolatedSingletonNearestDistance: summarize(singletonDistances),
    },
    focalPosition: {
      detectableBannerCount: focals.length,
      sourceCounts,
      centerCellCount,
      offCenterCount: focals.length - centerCellCount,
      centerCellShare: share(centerCellCount, focals.length),
      centroidX: summarize(focals.map(focal => focal.centroid.x)),
      centroidY: summarize(focals.map(focal => focal.centroid.y)),
      distanceToCenter: summarize(focals.map(focal => focal.distanceToCenter)),
      distanceToNearestThird: summarize(focals.map(focal => focal.nearestThird.distance)),
      nearestThirdCounts,
    },
    rhythmBreak: {
      measuredBannerCount: rhythmBreaks.length,
      lineCount: rhythmLines.length,
      rowCount: rowLines.length,
      columnCount: columnLines.length,
      perfectLineCount: rhythmLines.filter(line => line.classification === 'perfect').length,
      oneInterruptLineCount: oneInterruptLines.length,
      otherLineCount: rhythmLines.filter(line => line.classification === 'other').length,
      interruptionFrequency: share(oneInterruptLines.length, rhythmLines.length),
      edgeInterruptions: oneInterruptLines.filter(line => line.interrupt?.position === 'edge').length,
      interiorInterruptions: oneInterruptLines.filter(line => line.interrupt?.position === 'interior').length,
      edgeInterruptionShare: share(
        oneInterruptLines.filter(line => line.interrupt?.position === 'edge').length,
        oneInterruptLines.length,
      ),
      rowPerfectCount: rowLines.filter(line => line.classification === 'perfect').length,
      rowOneInterruptCount: rowLines.filter(line => line.classification === 'one-interrupt').length,
      columnPerfectCount: columnLines.filter(line => line.classification === 'perfect').length,
      columnOneInterruptCount: columnLines.filter(line => line.classification === 'one-interrupt').length,
      rowInterruptionPositions,
      columnInterruptionPositions,
      byTemplate,
    },
  };
}

function formFocalCandidates(banner: BannerRecon): FocalCandidate[] {
  return banner.forms
    .filter(form => form.kind === 'figure' || form.cells.length >= 3)
    .map(form => ({
      source: form.kind === 'figure' ? 'figure-form' : 'form-region',
      label: form.id,
      fill: form.ink,
      family: form.family ?? null,
      formKind: form.kind,
      signature: form.family ? `${form.kind}|${form.family}|${form.ink}` : `${form.kind}|${form.ink}`,
      cells: form.cells.map(([col, row]) => ({ col, row })),
    }));
}

function signatureRegionFocalCandidates(banner: BannerRecon, manifest: Manifest): FocalCandidate[] {
  const byPosition = cellsByPosition(banner);
  const signatureByPosition = new Map<string, string>();
  for (const cell of banner.cells) {
    const signature = focalSignature(cell, manifest);
    if (signature) {
      signatureByPosition.set(positionKey(cell), signature);
    }
  }

  const visited = new Set<string>();
  const candidates: FocalCandidate[] = [];
  for (const [startKey, startSignature] of [...signatureByPosition.entries()].sort(([a], [b]) => comparePositionKey(a, b))) {
    if (visited.has(startKey)) continue;
    const stack = [startKey];
    visited.add(startKey);
    const cells: Position[] = [];

    while (stack.length > 0) {
      const key = stack.pop()!;
      const cell = byPosition.get(key)!;
      cells.push({ col: cell.col, row: cell.row });
      for (const [nextCol, nextRow] of neighbors8(cell.col, cell.row)) {
        if (nextCol < 0 || nextCol >= banner.cols || nextRow < 0 || nextRow >= banner.rows) continue;
        const nextKey = `${nextCol},${nextRow}`;
        if (visited.has(nextKey)) continue;
        if (signatureByPosition.get(nextKey) !== startSignature) continue;
        visited.add(nextKey);
        stack.push(nextKey);
      }
    }

    if (cells.length < 3) continue;
    const parsed = parseFocalSignature(startSignature);
    candidates.push({
      source: 'signature-region',
      label: `region:${startSignature}:${positionKey(cells.sort(comparePositions)[0]!)}`,
      fill: parsed.fill,
      family: parsed.family,
      formKind: null,
      signature: startSignature,
      cells,
    });
  }
  return candidates;
}

function classifyRhythmLine(cells: CellRecon[], axis: Axis, index: number): RhythmLineMeasurement {
  const signatures = cells.map(rhythmSignature);
  const counts = new Map<string, number>();
  for (const signature of signatures) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }

  if (counts.size === 1) {
    return {
      axis,
      index,
      length: cells.length,
      classification: 'perfect',
      repeatedSignature: signatures[0] ?? null,
      interrupt: null,
      signatures,
    };
  }

  const sortedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1] || compareCodepoint(a[0], b[0]));
  const [repeatedSignature, repeatedCount] = sortedCounts[0]!;
  const singletonSignatures = sortedCounts.filter(([, count]) => count === 1);
  if (repeatedCount === cells.length - 1 && singletonSignatures.length === 1) {
    const interruptSignature = singletonSignatures[0]![0];
    const interruptIndex = signatures.findIndex(signature => signature === interruptSignature);
    const interruptCell = cells[interruptIndex]!;
    return {
      axis,
      index,
      length: cells.length,
      classification: 'one-interrupt',
      repeatedSignature,
      interrupt: {
        cell: { col: interruptCell.col, row: interruptCell.row },
        signature: interruptSignature,
        position: interruptionPosition(axis, interruptCell, cells.length),
      },
      signatures,
    };
  }

  return {
    axis,
    index,
    length: cells.length,
    classification: 'other',
    repeatedSignature: null,
    interrupt: null,
    signatures,
  };
}

function nearestAccentSingleton(node: AccentNode, nodes: AccentNode[], banner: BannerRecon): IsolatedAccentCell {
  let nearest: { distance: number; cell: Position } | null = null;
  for (const other of nodes) {
    if (other.cell === node.cell) continue;
    const d = distance(node.cell.col, node.cell.row, other.cell.col, other.cell.row);
    if (!nearest || d < nearest.distance || (d === nearest.distance && comparePositions(other.cell, nearest.cell) < 0)) {
      nearest = { distance: d, cell: { col: other.cell.col, row: other.cell.row } };
    }
  }

  return {
    col: node.cell.col,
    row: node.cell.row,
    fills: node.fills,
    nearestDistance: nearest ? round(nearest.distance) : null,
    nearestCell: nearest?.cell ?? null,
    corner: isCorner(node.cell, banner),
  };
}

function accentNeighbors(
  cell: CellRecon,
  banner: BannerRecon,
  nodes: Map<string, AccentNode>,
  byPosition: Map<string, CellRecon>,
): { key: string; node: AccentNode }[] {
  const neighbors: { key: string; node: AccentNode }[] = [];
  for (const [nextCol, nextRow] of neighbors8(cell.col, cell.row)) {
    if (nextCol < 0 || nextCol >= banner.cols || nextRow < 0 || nextRow >= banner.rows) continue;
    const nextCell = byPosition.get(`${nextCol},${nextRow}`);
    if (!nextCell) continue;
    const key = positionKey(nextCell);
    const node = nodes.get(key);
    if (node) neighbors.push({ key, node });
  }
  return neighbors.sort((a, b) => comparePositionKey(a.key, b.key));
}

function focalSignature(cell: CellRecon, manifest: Manifest): string | null {
  if (cell.kind === 'plain' || cell.kind === 'review') {
    return null;
  }
  const fill = cell.ink ?? firstForegroundInk(cell) ?? cell.ground;
  if (cell.kind === 'tile' && cell.tile) {
    const family = manifest.get(cell.tile)?.shape_family ?? 'unknown';
    return `tile|${family}|${fill}`;
  }
  return `${cell.kind}|${cell.kind}|${fill}`;
}

function parseFocalSignature(signature: string): { family: string | null; fill: string | null } {
  const parts = signature.split('|');
  return {
    family: parts[1] ?? null,
    fill: parts[2] ?? null,
  };
}

function rhythmSignature(cell: CellRecon): string {
  const tile = cell.kind === 'tile' ? (cell.tile ?? 'missing') : '-';
  const ink = cell.ink ?? '-';
  return `${cell.kind}|${tile}|${ink}|${cell.ground}`;
}

function firstForegroundInk(cell: CellRecon): string | null {
  return cell.inks?.[0] ?? null;
}

function accentFillsForCell(cell: CellRecon): string[] {
  const fills = new Set<string>();
  for (const fill of [cell.ground, cell.ink, ...(cell.inks ?? [])]) {
    if (!fill) continue;
    const normalized = fill.toUpperCase();
    if (!NEUTRAL_INKS.has(normalized)) {
      fills.add(normalized);
    }
  }
  return [...fills].sort(compareCodepoint);
}

function focalCentroid(cells: Position[], banner: BannerRecon): { x: number; y: number } {
  const x = cells.reduce((total, cell) => total + cell.col + 0.5, 0) / cells.length / banner.cols;
  const y = cells.reduce((total, cell) => total + cell.row + 0.5, 0) / cells.length / banner.rows;
  return { x: round(x), y: round(y) };
}

function centroidContainingCell(centroid: { x: number; y: number }, banner: BannerRecon): Position {
  return {
    col: clamp(Math.floor(centroid.x * banner.cols), 0, banner.cols - 1),
    row: clamp(Math.floor(centroid.y * banner.rows), 0, banner.rows - 1),
  };
}

function nearestThirdPoint(centroid: { x: number; y: number }): FocalPositionMeasurement['nearestThird'] {
  const nearest = [...THIRD_POINTS]
    .map(point => ({
      label: point.label,
      x: round(point.x),
      y: round(point.y),
      distance: round(distance(centroid.x, centroid.y, point.x, point.y)),
    }))
    .sort((a, b) => a.distance - b.distance || compareCodepoint(a.label, b.label))[0]!;
  return nearest;
}

function interruptionPosition(axis: Axis, cell: CellRecon, lineLength: number): InterruptionPosition {
  const index = axis === 'row' ? cell.col : cell.row;
  return index === 0 || index === lineLength - 1 ? 'edge' : 'interior';
}

function isCenterCell(cell: Position, banner: BannerRecon): boolean {
  const centerCols = centerIndices(banner.cols);
  const centerRows = centerIndices(banner.rows);
  return centerCols.includes(cell.col) && centerRows.includes(cell.row);
}

function centerIndices(count: number): number[] {
  return count % 2 === 1 ? [Math.floor(count / 2)] : [count / 2 - 1, count / 2];
}

function isCorner(cell: Position, banner: BannerRecon): boolean {
  return (cell.col === 0 || cell.col === banner.cols - 1) && (cell.row === 0 || cell.row === banner.rows - 1);
}

function neighbors8(col: number, row: number): [number, number][] {
  const result: [number, number][] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      result.push([col + dx, row + dy]);
    }
  }
  return result;
}

function cellsByPosition(banner: BannerRecon): Map<string, CellRecon> {
  const map = new Map<string, CellRecon>();
  for (const cell of banner.cells) {
    map.set(positionKey(cell), cell);
  }
  return map;
}

function buildTemplateLookup(): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [templateId, template] of Object.entries(TEMPLATE_MEMBERS)) {
    for (const bannerId of template.bannerIds) {
      lookup.set(bannerId, templateId);
    }
  }
  return lookup;
}

function isRhythmTemplate(templateId: string | null): templateId is typeof RHYTHM_TEMPLATE_IDS[number] {
  return templateId === 'checker-motif' || templateId === 'repeat-rhythm';
}

function sharesAny(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some(value => rightSet.has(value));
}

function summarize(values: number[]): NumberSummary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted.length > 0 ? round(sorted[0]!) : null,
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    median: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    max: sorted.length > 0 ? round(sorted[sorted.length - 1]!) : null,
    mean: sorted.length > 0 ? round(sum(sorted) / sorted.length) : null,
  };
}

function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  if (sortedAsc.length === 1) return round(sortedAsc[0]!);
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return round(sortedAsc[lo]!);
  const frac = rank - lo;
  return round(sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac);
}

function distribution(values: number[]): Record<string, number> {
  const record: Record<string, number> = {};
  for (const value of values) {
    increment(record, String(value));
  }
  return record;
}

function metricTable(rows: string[][]): string {
  return markdownTable(['metric', 'value'], rows);
}

function markdownTable(headers: string[], rows: string[][]): string {
  const escape = (value: string): string => value.replace(/\|/g, '\\|');
  return [
    `| ${headers.map(escape).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(value => escape(value)).join(' | ')} |`),
  ].join('\n');
}

function formatRecord(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([a], [b]) => compareCodepoint(a, b));
  return entries.length === 0 ? '-' : entries.map(([key, value]) => `${key}:${value}`).join(', ');
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNullable(value: number | null): string {
  return value === null ? '-' : formatNumber(value);
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function share(count: number, total: number): number {
  return total === 0 ? 0 : round(count / total);
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x1 - x2, y1 - y2);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function focalSourceRank(source: FocalSource): number {
  switch (source) {
    case 'figure-form': return 0;
    case 'form-region': return 1;
    case 'signature-region': return 2;
  }
}

function positionKey(cell: Position): string {
  return `${cell.col},${cell.row}`;
}

function comparePositionKey(a: string, b: string): number {
  const [aCol, aRow] = parsePositionKey(a);
  const [bCol, bRow] = parsePositionKey(b);
  return aRow - bRow || aCol - bCol;
}

function parsePositionKey(key: string): [number, number] {
  const [col, row] = key.split(',').map(Number);
  if (col === undefined || row === undefined || !Number.isFinite(col) || !Number.isFinite(row)) {
    throw new Error(`Invalid cell position key: ${key}`);
  }
  return [col, row];
}

function comparePositions(a: Position, b: Position): number {
  return a.row - b.row || a.col - b.col;
}

function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function main(): void {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus;
  const measurements = measureCompositionLaws(corpus, loadMergedManifest());
  writeFileSync(OUT_PATH, JSON.stringify(measurements, null, 2) + '\n');
  console.log(renderMeasurementTables(measurements));
  console.log('');
  console.log(`Wrote ${OUT_PATH}`);
}

function isDirectRun(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
