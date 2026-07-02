/**
 * forms.ts — Multi-cell form detection for banner reconstructions.
 *
 * Runs union-find over the 18 cells of a banner and emits FormGroup records
 * for connected groups of ≥ 2 cells, using three join rules:
 *
 *  (a) Both kind==='tile', same ink, and the shared edge has edge_coverage ≥ 0.25
 *      on both sides after applying the cell's rotation/flip.
 *  (b) Both kind==='freeform' and share an ink (same ink value).
 *  (c) Both are the same tile+rotation in a row (frieze): same tile, same rotation,
 *      same ink, same row, adjacent columns.
 *
 * kind precedence: 'figure' if any member is freeform; 'frieze' if built purely by
 * rule (c); 'run' otherwise.
 *
 * Edge orientation: rotating 90° maps [top,right,bottom,left] → [left,top,right,bottom]
 * (i.e. top←left, right←top, bottom←right, left←bottom). Flip swaps left/right BEFORE rotation.
 */

import type { BannerRecon, CellRecon, FormGroup, ManifestTile } from './schema.js';

// ---------------------------------------------------------------------------
// Edge orientation transform
// ---------------------------------------------------------------------------

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * orientEdges — Apply a cell's flip + rotation to a manifest's edge_coverage.
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
// Main detectForms function
// ---------------------------------------------------------------------------

export function detectForms(banner: BannerRecon, manifest: ManifestTile[]): FormGroup[] {
  const cells = banner.cells;
  const n = cells.length;

  // Build lookup: cell index by [col, row]
  const cellIndex = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const c = cells[i]!;
    cellIndex.set(`${c.col},${c.row}`, i);
  }

  // Build manifest lookup by tile id
  const manifestById = new Map<string, ManifestTile>();
  for (const tile of manifest) {
    manifestById.set(tile.id, tile);
  }

  // Union-find
  const uf = makeUF(n);

  // Track join rule provenance per edge pair for kind detection.
  // For each union edge (pair), we record whether it was joined by rule (a/b) only,
  // or whether rule (c) applied (possibly alongside rule (a)).
  // A group is 'frieze' if ALL its joins were rule (c)-eligible (same-tile-same-row).
  // We track per-cell: ruleCOnly = was only ever joined by (c), never solely by (a/b).
  const joinedOnlyByAorB = new Set<number>(); // joined by (a) or (b) but NOT (c)

  for (let i = 0; i < n; i++) {
    const ci = cells[i]!;

    // 'review' and 'plain' cells never join
    if (ci.kind === 'review' || ci.kind === 'plain') continue;

    // Check 4 neighbors: right (col+1), down (row+1) — we only check each pair once
    const neighbors: [number, number, 'h' | 'v'][] = [
      [ci.col + 1, ci.row, 'h'],
      [ci.col, ci.row + 1, 'v'],
    ];

    for (const [nc, nr, dir] of neighbors) {
      const j = cellIndex.get(`${nc},${nr}`);
      if (j === undefined) continue;

      const cj = cells[j]!;

      // 'review' and 'plain' cells never join
      if (cj.kind === 'review' || cj.kind === 'plain') continue;

      let joined = false;

      // Check rule (c) eligibility first (same tile, same rotation, same ink, same row, adjacent col)
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
        const inkI = ci.ink;
        const inkJ = cj.ink;
        if (inkI && inkJ && inkI === inkJ) {
          joined = true;
          // freeform joins are always rule (b), not (c)
          joinedOnlyByAorB.add(i);
          joinedOnlyByAorB.add(j);
        }
      }

      // Rule (a): both tile, same ink, active shared edge on both sides
      if (!joined && ci.kind === 'tile' && cj.kind === 'tile') {
        if (ci.ink && cj.ink && ci.ink === cj.ink && ci.tile && cj.tile) {
          const mI = manifestById.get(ci.tile);
          const mJ = manifestById.get(cj.tile);

          if (mI && mJ) {
            const edgesI = orientEdges(
              mI.edge_coverage,
              (ci.rotation ?? 0) as 0 | 90 | 180 | 270,
              ci.flip ?? false,
            );
            const edgesJ = orientEdges(
              mJ.edge_coverage,
              (cj.rotation ?? 0) as 0 | 90 | 180 | 270,
              cj.flip ?? false,
            );

            // Shared edge: for horizontal adjacency (i is left of j): i's right ↔ j's left
            // For vertical adjacency (i is above j): i's bottom ↔ j's top
            const edgeCovI = dir === 'h' ? edgesI.right : edgesI.bottom;
            const edgeCovJ = dir === 'h' ? edgesJ.left : edgesJ.top;

            if (edgeCovI >= 0.25 && edgeCovJ >= 0.25) {
              joined = true;
              // If rule (c) also applies, don't mark as AorB-only
              if (!ruleC_eligible) {
                joinedOnlyByAorB.add(i);
                joinedOnlyByAorB.add(j);
              }
              // (if ruleC_eligible too, the join came from both — treat as frieze-eligible)
            }
          }
        }
      }

      // Rule (c): same tile, same rotation, same ink, same row, horizontally adjacent
      if (!joined && ruleC_eligible) {
        joined = true;
        // Not marking as AorB-only — these are frieze-eligible
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
    // Only include cells that are actually in a union (root has ≥ 2 members)
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
    const ca = cells[a[0]!]!;
    const cb = cells[b[0]!]!;
    // find min cell in each group
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
    // 'frieze' = built purely by rule (c) — no member was joined solely by rule (a) or (b)
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

    // Dominant shape_family (most common among tile members; undefined for pure freeform)
    let family: string | undefined;
    const familyCount = new Map<string, number>();
    for (const i of members) {
      const c = cells[i]!;
      if (c.kind === 'tile' && c.tile) {
        const m = manifestById.get(c.tile);
        if (m?.shape_family) {
          familyCount.set(m.shape_family, (familyCount.get(m.shape_family) ?? 0) + 1);
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
      if (c.ink) inkCount.set(c.ink, (inkCount.get(c.ink) ?? 0) + 1);
    }
    const ink = [...inkCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#000000';

    // Cell pairs [col, row], sorted row-major
    const cellPairs: [number, number][] = members.map((i) => {
      const c = cells[i]!;
      return [c.col, c.row];
    });

    formGroups.push({
      id: `${banner.id}-form-${gIdx + 1}`,
      kind,
      cells: cellPairs,
      ...(family !== undefined ? { family } : {}),
      ink,
    });
  }

  return formGroups;
}
