/**
 * forms.ts — Multi-cell form detection for banner reconstructions.
 *
 * Wraps the shared detectFormsCore from src/engine/corpus/forms.ts with
 * ManifestTile-specific edge and family accessors. Behavior is identical to
 * the previous standalone implementation; the shared core ensures that the
 * mining pipeline and the engine always apply exactly the same join rules.
 *
 * Four join rules:
 *
 *  (a) Both kind==='tile', same ink, and the shared edge has edge_coverage ≥ 0.25
 *      on both sides after applying the cell's rotation/flip.
 *  (b) Both kind==='freeform' and share an ink (same ink value).
 *  (c) Both are the same tile+rotation in a row (frieze): same tile, same rotation,
 *      same ink, same row, adjacent columns.
 *  (d) Both kind==='tile', the shared edge has edge_coverage ≥ 0.25 on both sides
 *      (same orientEdges logic as rule a), AND the ink/ground pair is INVERTED:
 *      a.ink === b.ground && a.ground === b.ink.
 *
 * kind precedence: 'figure' if any member is freeform; 'frieze' if built purely by
 * rule (c); 'run' otherwise.
 */

import type { BannerRecon, FormGroup, ManifestTile } from './schema.js';

// orientEdges + Edges type + DetectFormsParams live in the engine (single source of truth);
// tools import from src (never the reverse). Re-exported so existing importers keep working.
import { orientEdges, detectFormsCore, type Edges, type DetectFormsParams } from '../../src/engine/corpus/forms.js';
export { orientEdges };
export type { Edges, DetectFormsParams };

// ---------------------------------------------------------------------------
// Main detectForms — manifest variant
// ---------------------------------------------------------------------------

export function detectForms(banner: BannerRecon, manifest: ManifestTile[]): FormGroup[] {
  // Build manifest lookup by tile id
  const manifestById = new Map<string, ManifestTile>();
  for (const tile of manifest) {
    manifestById.set(tile.id, tile);
  }

  // Adapt BannerRecon to BannerPlan shape (structurally identical via shims in schema.ts).
  // The cells are structurally compatible — CellRecon is a structural twin of CellPlan.
  const plan = banner as unknown as import('../../src/engine/corpus/types.js').BannerPlan;

  return detectFormsCore(plan, {
    getEdges: (tileId) => {
      const m = manifestById.get(tileId);
      return m?.edge_coverage;
    },
    getFamily: (tileId) => {
      const m = manifestById.get(tileId);
      return m?.shape_family;
    },
    getInk: (cell) => cell.ink,
  });
}
