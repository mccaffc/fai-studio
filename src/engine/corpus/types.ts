/**
 * types.ts — engine-side plan + grammar type declarations for the corpus engine.
 *
 * These are declared here (not imported from tools/**) so that
 * `src/engine/corpus/**` is a self-contained, zero-dependency module tree. The
 * plan types (BannerPlan/CellPlan/FormGroup) are STRUCTURALLY IDENTICAL to
 * tools/mine/schema.ts's BannerRecon/CellRecon/FormGroup, so the tools' thin
 * re-export shims type-check against the tools' tests unchanged.
 *
 * Grammar types (EngineGrammar / TileCatalogEntry / Template / TemplateSpec /
 * GroundSchemeKind) are the canonical single declarations, emitted inline in the
 * generated data/grammar.ts. This file re-exports them so the rest of the engine
 * and the studio can import from a stable hand-written path rather than the
 * generated file path.
 */

export type Hex = string; // '#RRGGBB' uppercase

export type ArrangementId = 'banner' | 'portrait' | 'square' | 'strip' | 'column' | 'column-short';

export const ARRANGEMENTS: Record<ArrangementId, { cols: number; rows: number }> = {
  banner: { cols: 6, rows: 3 },
  portrait: { cols: 2, rows: 3 },
  square: { cols: 3, rows: 3 },
  strip: { cols: 3, rows: 1 },
  column: { cols: 1, rows: 6 },
  'column-short': { cols: 1, rows: 3 },
};

// ---------------------------------------------------------------------------
// Plan types (structural twins of tools/mine/schema.ts)
// ---------------------------------------------------------------------------

export interface CellPlan {
  col: number;              // 0..plan.cols-1
  row: number;              // 0..plan.rows-1
  ground: Hex;              // resolved backing color of this cell
  kind: 'tile' | 'plain' | 'freeform' | 'review';
  tile?: string;            // catalog id, when kind==='tile'
  rotation?: 0 | 90 | 180 | 270;
  flip?: boolean;           // horizontal mirror before rotation
  ink?: Hex;                // dominant foreground color
  inks?: Hex[];             // all foreground colors present
  score?: number;           // IoU of the accepted match
  candidates?: { tile: string; rotation: number; flip: boolean; score: number }[];
  figureId?: string;        // figure asset id, present on the freeform anchor cell
  figureAnchor?: boolean;   // true only for the top-left figure anchor cell
  figureSpan?: [number, number]; // [w,h] cells spanned by the figure asset
  patchId?: string;         // iconic patch id, present on the stamped anchor cell
  patchSpan?: [number, number]; // [w,h] cells spanned by the patch, present on the anchor
}

export interface FormGroup {
  id: string;               // e.g. '009-form-1'
  kind: 'run' | 'figure' | 'frieze';
  cells: [number, number][]; // [col,row]
  family?: string;          // shape family when tile-based
  ink: Hex;
}

export interface BannerPlan {
  id: string;               // '009' or 'sample-<seed>'
  width: number; height: number; cols: number; rows: number;
  ground: Hex;              // full-canvas ground
  cells: CellPlan[];        // always cols*rows, row-major
  forms: FormGroup[];
  matchRate: number;        // fraction of non-plain cells with kind==='tile'
  /** Template name used to generate this plan (set by samplePlan / corpus API). */
  templateId?: string;
}

// ---------------------------------------------------------------------------
// Sampler knobs
// ---------------------------------------------------------------------------

export interface SampleKnobs {
  template?: string;
  accent?: string;
  /** User-constrained subset of the locked 7 accent hues. */
  accentPool?: string[];
  /** Optional weighted shape-family preference; multiplier 1 preserves draws. */
  familyBias?: { families: readonly string[]; multiplier: number };
  /** Optional weighted template preference; explicit `template` still wins. */
  templateBias?: { ids: readonly string[]; multiplier: number };
  /** Optional minimum mapped-family share in the selected working tile set. */
  familyFloor?: { families: readonly string[]; minShare: number };
  paletteMode?: 'auto' | 'full';
  density?: number;
  figures?: boolean;
  arrangement?: ArrangementId;
}

export interface CorpusConfig extends SampleKnobs {
  /** Initial seed. Defaults to 1. */
  seed?: number;
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

// ---------------------------------------------------------------------------
// Edge orientation
// ---------------------------------------------------------------------------

export interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ---------------------------------------------------------------------------
// Grammar types — re-exported from the generated data module (single source
// of truth; generated file stays self-contained by inlining these definitions).
// ---------------------------------------------------------------------------

export type {
  EngineGrammar,
  EngineStats,
  TileCatalogEntry,
  GroundSchemeKind,
  TemplateSpec,
  Template,
} from './data/grammar.js';

// EdgeProfileSet / VariantKey / TileEdgeProfiles are declared in data/grammar.ts
// and also re-exported by profiles.ts (the pure edge-matching helpers module).
export type { EdgeProfileSet, VariantKey, TileEdgeProfiles } from './data/grammar.js';
