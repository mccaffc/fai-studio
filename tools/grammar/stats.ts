import type { BannerRecon, CellRecon, Corpus, ManifestTile } from '../mine/schema';

export interface StatsTables {
  schemaVersion: 1;
  families: Record<string, number>;
  tiles: Record<string, number>;
  tileRotations: Record<string, Record<string, number>>;
  tileFlipShare: Record<string, number>;
  adjacency: {
    horizontal: Record<string, Record<string, number>>;
    vertical: Record<string, Record<string, number>>;
  };
  inkByGround: Record<string, Record<string, number>>;
  globalGrounds: Record<string, number>;
  groundSchemes: {
    perBanner: Record<string, GroundScheme>;
    counts: Record<GroundSchemeKind, number>;
  };
  forms: {
    kinds: Record<string, number>;
    sizes: Record<string, number>;
    byFamily: Record<string, number>;
    friezeRows: Record<string, number>;
  };
  plain: {
    perBannerHistogram: Record<string, number>;
    byRow: [number, number, number];
    positions: Record<string, number>;
  };
  economy: {
    distinctTilesPerBanner: number[];
    dominantFamilyShare: number[];
  };
}

export type GroundSchemeKind = 'uniform' | 'checker' | 'banded-rows' | 'banded-cols' | 'zoned' | 'scatter';

export interface GroundScheme {
  kind: GroundSchemeKind;
  grounds: string[];
  offGlobalCount: number;
}

const ROTATIONS = ['0', '90', '180', '270'] as const;
const GROUND_SCHEME_KINDS: GroundSchemeKind[] = [
  'uniform',
  'checker',
  'banded-rows',
  'banded-cols',
  'zoned',
  'scatter',
];

export function computeStats(
  corpus: Corpus,
  manifest: Map<string, ManifestTile & { baseDir: string }>,
): StatsTables {
  const stats: StatsTables = {
    schemaVersion: 1,
    families: {},
    tiles: {},
    tileRotations: {},
    tileFlipShare: {},
    adjacency: {
      horizontal: {},
      vertical: {},
    },
    inkByGround: {},
    globalGrounds: {},
    groundSchemes: {
      perBanner: {},
      counts: {
        uniform: 0,
        checker: 0,
        'banded-rows': 0,
        'banded-cols': 0,
        zoned: 0,
        scatter: 0,
      },
    },
    forms: {
      kinds: { run: 0, frieze: 0, figure: 0 },
      sizes: {},
      byFamily: {},
      friezeRows: {},
    },
    plain: {
      perBannerHistogram: {},
      byRow: [0, 0, 0],
      positions: {},
    },
    economy: {
      distinctTilesPerBanner: [],
      dominantFamilyShare: [],
    },
  };

  const flipCounts: Record<string, number> = {};

  for (const banner of corpus.banners) {
    increment(stats.globalGrounds, banner.ground);
    accumulateCells(stats, banner, manifest, flipCounts);
    accumulateAdjacency(stats, banner);
    accumulateForms(stats, banner);

    const scheme = classifyGroundScheme(banner);
    stats.groundSchemes.perBanner[banner.id] = scheme;
    stats.groundSchemes.counts[scheme.kind] += 1;
  }

  for (const [tile, count] of Object.entries(stats.tiles)) {
    stats.tileFlipShare[tile] = count === 0 ? 0 : (flipCounts[tile] ?? 0) / count;
  }

  return stats;
}

function accumulateCells(
  stats: StatsTables,
  banner: BannerRecon,
  manifest: Map<string, ManifestTile & { baseDir: string }>,
  flipCounts: Record<string, number>,
): void {
  let plainCount = 0;
  const distinctTiles = new Set<string>();
  const familyCounts = new Map<string, number>();
  let tileCount = 0;

  for (const cell of banner.cells) {
    if (cell.kind === 'plain') {
      plainCount += 1;
      if (cell.row >= 0 && cell.row < stats.plain.byRow.length) {
        stats.plain.byRow[cell.row]! += 1;
      }
      increment(stats.plain.positions, positionKey(cell));
      continue;
    }

    if ((cell.kind === 'tile' || cell.kind === 'freeform') && cell.ink) {
      incrementNested(stats.inkByGround, cell.ground, cell.ink);
    }

    if (cell.kind !== 'tile' || !cell.tile) {
      continue;
    }

    tileCount += 1;
    distinctTiles.add(cell.tile);
    increment(stats.tiles, cell.tile);
    if (cell.flip) {
      increment(flipCounts, cell.tile);
    }

    const rotations = ensureRotationTable(stats.tileRotations, cell.tile);
    rotations[String(cell.rotation ?? 0)] = (rotations[String(cell.rotation ?? 0)] ?? 0) + 1;

    const family = manifest.get(cell.tile)?.shape_family ?? 'unknown';
    increment(stats.families, family);
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }

  increment(stats.plain.perBannerHistogram, String(plainCount));
  stats.economy.distinctTilesPerBanner.push(distinctTiles.size);
  stats.economy.dominantFamilyShare.push(dominantShare(familyCounts, tileCount));
}

function accumulateAdjacency(stats: StatsTables, banner: BannerRecon): void {
  const byPosition = new Map<string, CellRecon>();
  for (const cell of banner.cells) {
    byPosition.set(positionKey(cell), cell);
  }

  for (let row = 0; row < banner.rows; row += 1) {
    for (let col = 0; col < banner.cols; col += 1) {
      const current = byPosition.get(`${col},${row}`);
      if (!isTilePlacement(current)) {
        continue;
      }

      const right = byPosition.get(`${col + 1},${row}`);
      if (col + 1 < banner.cols && isTilePlacement(right)) {
        incrementNested(stats.adjacency.horizontal, placementKey(current), placementKey(right));
      }

      const down = byPosition.get(`${col},${row + 1}`);
      if (row + 1 < banner.rows && isTilePlacement(down)) {
        incrementNested(stats.adjacency.vertical, placementKey(current), placementKey(down));
      }
    }
  }
}

function accumulateForms(stats: StatsTables, banner: BannerRecon): void {
  for (const form of banner.forms) {
    increment(stats.forms.kinds, form.kind);
    increment(stats.forms.sizes, String(form.cells.length));

    if (form.family) {
      increment(stats.forms.byFamily, form.family);
    }

    if (form.kind === 'frieze') {
      const row = form.cells[0]?.[1];
      if (row !== undefined) {
        increment(stats.forms.friezeRows, String(row));
      }
    }
  }
}

function classifyGroundScheme(banner: BannerRecon): GroundScheme {
  const offGlobal = banner.cells.filter((cell) => cell.ground !== banner.ground);
  const grounds = [...new Set(banner.cells.map((cell) => cell.ground))].sort();

  let kind: GroundSchemeKind;
  if (offGlobal.length <= 1) {
    kind = 'uniform';
  } else if (isChecker(banner, offGlobal.length)) {
    kind = 'checker';
  } else if (isBandedRows(banner)) {
    kind = 'banded-rows';
  } else if (isBandedCols(banner)) {
    kind = 'banded-cols';
  } else if (isZoned(banner)) {
    kind = 'zoned';
  } else {
    kind = 'scatter';
  }

  return { kind, grounds, offGlobalCount: offGlobal.length };
}

function isChecker(banner: BannerRecon, offGlobalCount: number): boolean {
  if (offGlobalCount < 8) {
    return false;
  }

  let noSameOffGlobalAdjacent = true;
  let alternatingPairs = 0;
  let totalPairs = 0;
  const byPosition = cellsByPosition(banner);

  for (let row = 0; row < banner.rows; row += 1) {
    for (let col = 0; col < banner.cols; col += 1) {
      const cell = byPosition.get(`${col},${row}`);
      if (!cell) {
        continue;
      }

      for (const [nextCol, nextRow] of [[col + 1, row], [col, row + 1]] as const) {
        if (nextCol >= banner.cols || nextRow >= banner.rows) {
          continue;
        }
        const neighbor = byPosition.get(`${nextCol},${nextRow}`);
        if (!neighbor) {
          continue;
        }

        totalPairs += 1;
        if (cell.ground !== neighbor.ground) {
          alternatingPairs += 1;
        }
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
    if (!first) {
      return false;
    }
    for (let col = 1; col < banner.cols; col += 1) {
      if (byPosition.get(`${col},${row}`)?.ground !== first) {
        return false;
      }
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
    if (!first) {
      return false;
    }
    for (let row = 1; row < banner.rows; row += 1) {
      if (byPosition.get(`${col},${row}`)?.ground !== first) {
        return false;
      }
    }
    colGrounds.push(first);
  }

  return new Set(colGrounds).size >= 2;
}

function isZoned(banner: BannerRecon): boolean {
  const offGlobal = new Set(
    banner.cells
      .filter((cell) => cell.ground !== banner.ground)
      .map((cell) => positionKey(cell)),
  );
  if (offGlobal.size === 0) {
    return false;
  }

  const visited = new Set<string>();
  const regionSizes: number[] = [];

  for (const start of offGlobal) {
    if (visited.has(start)) {
      continue;
    }

    let size = 0;
    const stack = [start];
    visited.add(start);

    while (stack.length > 0) {
      const key = stack.pop()!;
      size += 1;
      const [col, row] = parsePositionKey(key);

      for (const [nextCol, nextRow] of [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
      ] as const) {
        if (nextCol < 0 || nextCol >= banner.cols || nextRow < 0 || nextRow >= banner.rows) {
          continue;
        }
        const nextKey = `${nextCol},${nextRow}`;
        if (!offGlobal.has(nextKey) || visited.has(nextKey)) {
          continue;
        }
        visited.add(nextKey);
        stack.push(nextKey);
      }
    }

    regionSizes.push(size);
  }

  return regionSizes.length <= 3 && regionSizes.every((size) => size >= 2);
}

function ensureRotationTable(
  tileRotations: Record<string, Record<string, number>>,
  tile: string,
): Record<string, number> {
  let table = tileRotations[tile];
  if (!table) {
    table = {};
    for (const rotation of ROTATIONS) {
      table[rotation] = 0;
    }
    tileRotations[tile] = table;
  }
  return table;
}

function dominantShare(familyCounts: Map<string, number>, tileCount: number): number {
  if (tileCount === 0) {
    return 0;
  }

  let max = 0;
  for (const count of familyCounts.values()) {
    if (count > max) {
      max = count;
    }
  }
  return max / tileCount;
}

function isTilePlacement(cell: CellRecon | undefined): cell is CellRecon & { tile: string } {
  return cell?.kind === 'tile' && typeof cell.tile === 'string';
}

function placementKey(cell: CellRecon & { tile: string }): string {
  return `${cell.tile}/${cell.rotation ?? 0}/${cell.flip ? 'f' : '-'}`;
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

function cellsByPosition(banner: BannerRecon): Map<string, CellRecon> {
  const byPosition = new Map<string, CellRecon>();
  for (const cell of banner.cells) {
    byPosition.set(positionKey(cell), cell);
  }
  return byPosition;
}

function increment(record: Record<string, number>, key: string, by = 1): void {
  record[key] = (record[key] ?? 0) + by;
}

function incrementNested(record: Record<string, Record<string, number>>, key: string, nestedKey: string): void {
  const nested = record[key] ?? {};
  nested[nestedKey] = (nested[nestedKey] ?? 0) + 1;
  record[key] = nested;
}
