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

// ---------------------------------------------------------------------------
// Plan types (structural twins of tools/mine/schema.ts)
// ---------------------------------------------------------------------------

export interface CellPlan {
  col: number;              // 0..5
  row: number;              // 0..2
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
  width: 1920; height: 960; cols: 6; rows: 3;
  ground: Hex;              // full-canvas ground
  cells: CellPlan[];        // always 18, row-major
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
  density?: number;
  figures?: boolean;
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
