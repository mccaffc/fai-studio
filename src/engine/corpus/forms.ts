/**
 * forms.ts — multi-cell form detection for banner plans (engine, zero-dep).
 *
 * Runs union-find over the cells of a plan and emits FormGroup records for
 * connected groups of ≥ 2 cells, using four join rules:
 *
 *  (a) Both kind==='tile', same ink, and the shared edge has edge coverage ≥ 0.25
 *      on both sides after applying the cell's rotation/flip.
 *  (b) Both kind==='freeform' and share an ink (same ink value).
 *  (c) Both are the same tile+rotation in a row (frieze): same tile, same
 *      rotation, same ink, same row, adjacent columns.
 *  (d) Both kind==='tile', the shared edge has coverage ≥ 0.25 on both sides
 *      (same orientEdges logic as rule a), AND the ink/ground pair is INVERTED:
 *      a.ink === b.ground && a.ground === b.ink. Captures the FAI figure-ground
 *      inversion signature; rule (d) joins take 'run' kind.
 *
 * kind precedence: 'figure' if any member is freeform; 'frieze' if built purely
 * by rule (c); 'run' otherwise.
 *
 * Edge orientation: rotating 90° maps [top,right,bottom,left] → [left,top,right,bottom]
 * (i.e. top←left, right←top, bottom←right, left←bottom). Flip swaps left/right BEFORE rotation.
 *
 * ## Shared core
 *
 * `detectFormsCore` is the parameterized implementation; it takes an edge
 * accessor and family accessor so both the engine variant (catalog + families
 * record) and the tools/mine variant (ManifestTile manifest) can share the same
 * union-find + join logic without duplication.
 *
 * `detectForms` is the engine-facing wrapper.
 */

import type { BannerPlan, CellPlan, Edges, FormGroup } from './types.js';

export type { Edges } from './types.js';

// ---------------------------------------------------------------------------
// Edge orientation transform
// ---------------------------------------------------------------------------

/**
 * orientEdges — Apply a cell's flip + rotation to a tile's edge coverage.
 *
 * The brief says: "rotating 90° maps [top,right,bottom,left] → [left,top,right,bottom]"
 * Meaning the NEW orientation's edges are:
 *   new.top    = old.left
 *   new.right  = old.top
 *   new.bottom = old.right
 *   new.left   = old.bottom
 *
 * Flip swaps left/right BEFORE rotation.
 */
export function orientEdges(
  edges: Edges,
  rotation: 0 | 90 | 180 | 270,
  flip: boolean,
): Edges {
  // Step 1: flip (swap left/right)
  let { top, right, bottom, left } = edges;
  if (flip) {
    [left, right] = [right, left];
  }

  // Step 2: apply rotation in 90° increments
  // One 90° CW rotation: new = { top:left, right:top, bottom:right, left:bottom }
  const steps = (rotation / 90) % 4;
  for (let i = 0; i < steps; i++) {
    [top, right, bottom, left] = [left, top, right, bottom];
  }

  return { top, right, bottom, left };
}

// ---------------------------------------------------------------------------
// Union-find helpers
// ---------------------------------------------------------------------------

function makeUF(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function find(uf: number[], x: number): number {
  while (uf[x] !== x) {
    uf[x] = uf[uf[x]!]!; // path compression
    x = uf[x]!;
  }
  return x;
}

function union(uf: number[], x: number, y: number): void {
  const rx = find(uf, x);
  const ry = find(uf, y);
  if (rx !== ry) uf[rx] = ry;
}

// ---------------------------------------------------------------------------
// Parameterized core (shared by engine variant and tools/mine variant)
// ---------------------------------------------------------------------------

export interface DetectFormsParams {
  /** Return the edge coverage for a tile id, or undefined if not in catalog. */
  getEdges: (tileId: string) => Edges | undefined;
  /** Return the shape family for a tile id, or undefined if unknown. */
  getFamily: (tileId: string) => string | undefined;
  /** Return the ink for a cell — used to look up the dominant foreground. */
  getInk: (cell: CellPlan) => string | undefined;
}

/**
 * detectFormsCore — shared parameterized union-find + join-rules core.
 *
 * Both the engine variant (`detectForms`) and the tools/mine variant call this.
 * The params functor supplies tile-edge and tile-family lookups so the core
 * stays decoupled from whether the data source is a catalog record, a
 * ManifestTile, or anything else.
 */
export function detectFormsCore(
  plan: BannerPlan,
  params: DetectFormsParams,
): FormGroup[] {
  const cells = plan.cells;
  const n = cells.length;

  // Build lookup: cell index by [col, row]
  const cellIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const c = cells[i]!;
    cellIndex.set(`${c.col},${c.row}`, i);
  }

  // Union-find
  const uf = makeUF(n);

  // A group is 'frieze' if ALL its joins were rule (c)-eligible (same-tile-same-row).
  const joinedOnlyByAorB = new Set<number>(); // joined by (a) or (b) but NOT (c)

  for (let i = 0; i < n; i++) {
    const ci = cells[i]!;

    // 'review' and 'plain' cells never join
    if (ci.kind === 'review' || ci.kind === 'plain') continue;

    const neighbors: [number, number, 'h' | 'v'][] = [
      [ci.col + 1, ci.row, 'h'],
      [ci.col, ci.row + 1, 'v'],
    ];

    for (const [nc, nr, dir] of neighbors) {
      const j = cellIndex.get(`${nc},${nr}`);
      if (j === undefined) continue;

      const cj = cells[j]!;

      if (cj.kind === 'review' || cj.kind === 'plain') continue;

      let joined = false;

      // Rule (c) eligibility (same tile, same rotation, same ink, same row, adjacent col)
      const ruleC_eligible =
        dir === 'h' &&
        ci.kind === 'tile' &&
        cj.kind === 'tile' &&
        !!ci.tile && !!cj.tile &&
        ci.tile === cj.tile &&
        (ci.rotation ?? 0) === (cj.rotation ?? 0) &&
        !!ci.ink && !!cj.ink &&
        ci.ink === cj.ink;

      // Rule (b): both freeform, share an ink
      if (ci.kind === 'freeform' && cj.kind === 'freeform') {
        const inkI = params.getInk(ci);
        const inkJ = params.getInk(cj);
        if (inkI && inkJ && inkI === inkJ) {
          joined = true;
          joinedOnlyByAorB.add(i);
          joinedOnlyByAorB.add(j);
        }
      }

      // Rule (a): both tile, same ink, active shared edge on both sides
      if (!joined && ci.kind === 'tile' && cj.kind === 'tile') {
        if (ci.ink && cj.ink && ci.ink === cj.ink && ci.tile && cj.tile) {
          const eI = params.getEdges(ci.tile);
          const eJ = params.getEdges(cj.tile);

          if (eI && eJ) {
            const edgesI = orientEdges(eI, (ci.rotation ?? 0) as 0 | 90 | 180 | 270, ci.flip ?? false);
            const edgesJ = orientEdges(eJ, (cj.rotation ?? 0) as 0 | 90 | 180 | 270, cj.flip ?? false);

            const edgeCovI = dir === 'h' ? edgesI.right : edgesI.bottom;
            const edgeCovJ = dir === 'h' ? edgesJ.left : edgesJ.top;

            if (edgeCovI >= 0.25 && edgeCovJ >= 0.25) {
              joined = true;
              if (!ruleC_eligible) {
                joinedOnlyByAorB.add(i);
                joinedOnlyByAorB.add(j);
              }
            }
          }
        }
      }

      // Rule (d): both tile, active shared edge on both sides, INVERTED ink/ground pair.
      if (!joined && ci.kind === 'tile' && cj.kind === 'tile') {
        if (
          ci.ink && cj.ink && ci.ground && cj.ground &&
          ci.ink === cj.ground && ci.ground === cj.ink &&
          ci.tile && cj.tile
        ) {
          const eI = params.getEdges(ci.tile);
          const eJ = params.getEdges(cj.tile);

          if (eI && eJ) {
            const edgesI = orientEdges(eI, (ci.rotation ?? 0) as 0 | 90 | 180 | 270, ci.flip ?? false);
            const edgesJ = orientEdges(eJ, (cj.rotation ?? 0) as 0 | 90 | 180 | 270, cj.flip ?? false);

            const edgeCovI = dir === 'h' ? edgesI.right : edgesI.bottom;
            const edgeCovJ = dir === 'h' ? edgesJ.left : edgesJ.top;

            if (edgeCovI >= 0.25 && edgeCovJ >= 0.25) {
              joined = true;
              joinedOnlyByAorB.add(i);
              joinedOnlyByAorB.add(j);
            }
          }
        }
      }

      // Rule (c): same tile, same rotation, same ink, same row, horizontally adjacent
      if (!joined && ruleC_eligible) {
        joined = true;
      }

      if (joined) {
        union(uf, i, j);
      }
    }
  }

  // Gather groups by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const ci = cells[i]!;
    if (ci.kind === 'review' || ci.kind === 'plain') continue;
    const root = find(uf, i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  // Filter to groups of size ≥ 2
  const validGroups: number[][] = [];
  for (const [, members] of groups) {
    if (members.length >= 2) validGroups.push(members);
  }

  // Sort groups by topmost-leftmost member (row-major: row first, then col)
  validGroups.sort((a, b) => {
    const minA = a.reduce((best, idx) => {
      const c = cells[idx]!;
      return c.row < cells[best]!.row || (c.row === cells[best]!.row && c.col < cells[best]!.col)
        ? idx
        : best;
    }, a[0]!);
    const minB = b.reduce((best, idx) => {
      const c = cells[idx]!;
      return c.row < cells[best]!.row || (c.row === cells[best]!.row && c.col < cells[best]!.col)
        ? idx
        : best;
    }, b[0]!);
    const cma = cells[minA]!;
    const cmb = cells[minB]!;
    if (cma.row !== cmb.row) return cma.row - cmb.row;
    return cma.col - cmb.col;
  });

  // Build FormGroup records
  const formGroups: FormGroup[] = [];

  for (let gIdx = 0; gIdx < validGroups.length; gIdx++) {
    const members = validGroups[gIdx]!;

    // Sort members row-major
    members.sort((a, b) => {
      const ca = cells[a]!;
      const cb = cells[b]!;
      if (ca.row !== cb.row) return ca.row - cb.row;
      return ca.col - cb.col;
    });

    // Determine kind: 'figure' > 'frieze' > 'run'
    const hasFreeform = members.some((i) => cells[i]!.kind === 'freeform');
    const hasAorBOnlyJoin = members.some((i) => joinedOnlyByAorB.has(i));

    let kind: 'run' | 'figure' | 'frieze';
    if (hasFreeform) {
      kind = 'figure';
    } else if (!hasAorBOnlyJoin) {
      kind = 'frieze';
    } else {
      kind = 'run';
    }

    // Dominant shape family (most common among tile members; undefined for pure freeform)
    let family: string | undefined;
    const familyCount = new Map<string, number>();
    for (const i of members) {
      const c = cells[i]!;
      if (c.kind === 'tile' && c.tile) {
        const fam = params.getFamily(c.tile);
        if (fam) {
          familyCount.set(fam, (familyCount.get(fam) ?? 0) + 1);
        }
      }
    }
    if (familyCount.size > 0) {
      family = [...familyCount.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    }

    // Dominant ink: most common ink among members
    const inkCount = new Map<string, number>();
    for (const i of members) {
      const c = cells[i]!;
      const ink = params.getInk(c);
      if (ink) inkCount.set(ink, (inkCount.get(ink) ?? 0) + 1);
    }
    const ink = [...inkCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#000000';

    const cellPairs: [number, number][] = members.map((i) => {
      const c = cells[i]!;
      return [c.col, c.row];
    });

    formGroups.push({
      id: `${plan.id}-form-${gIdx + 1}`,
      kind,
      cells: cellPairs,
      ...(family !== undefined ? { family } : {}),
      ink,
    });
  }

  return formGroups;
}

// ---------------------------------------------------------------------------
// Engine-facing wrapper (catalog + families record)
// ---------------------------------------------------------------------------

export interface FormsCatalogEntry {
  edges: Edges;
}

/**
 * detectForms — engine variant. Edges come from `catalog[tileId].edges`;
 * shape family comes from the `families` record. Delegates to detectFormsCore.
 */
export function detectForms(
  plan: BannerPlan,
  catalog: Record<string, FormsCatalogEntry>,
  families: Record<string, string>,
): FormGroup[] {
  return detectFormsCore(plan, {
    getEdges: (tileId) => catalog[tileId]?.edges,
    getFamily: (tileId) => families[tileId],
    getInk: (cell) => cell.ink,
  });
}
