/**
 * types.ts — engine-side plan + grammar type declarations for the corpus engine.
 *
 * These are declared here (not imported from tools/**) so that
 * `src/engine/corpus/**` is a self-contained, zero-dependency module tree. The
 * plan types (BannerPlan/CellPlan/FormGroup) are STRUCTURALLY IDENTICAL to
 * tools/mine/schema.ts's BannerRecon/CellRecon/FormGroup, so the tools' thin
 * re-export shims type-check against the tools' tests unchanged.
 *
 * The grammar type (EngineGrammar) is the shape the sampler actually reads. It
 * is a structural subset of the tools' `Grammar` (grammar-schema.ts) and of the
 * generated `data/grammar.ts` GRAMMAR value, so both can be passed to
 * samplePlan without conversion.
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
// Grammar types (structural subset of tools' Grammar + generated GRAMMAR)
// ---------------------------------------------------------------------------

export type GroundSchemeKind =
  | 'uniform'
  | 'checker'
  | 'banded-rows'
  | 'banded-cols'
  | 'zoned'
  | 'scatter';

export interface TemplateSpec {
  groundSchemes: GroundSchemeKind[];
  dominantFamilies: string[];
  distinctTiles: [number, number];
  forms: { run: [number, number]; frieze: [number, number]; figure: [number, number] };
  figureShare: [number, number];
  plainShare: [number, number];
  lineworkShare: [number, number];
}

export interface Template {
  id: string;
  name: string;
  bannerIds: string[];
  spec: TemplateSpec;
}

export type VariantKey = `${0 | 90 | 180 | 270}/${'f' | '-'}`;

export interface EdgeProfileSet {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export type TileEdgeProfiles = Record<VariantKey, EdgeProfileSet>;

export interface TileCatalogEntry {
  family: string;
  edges: Edges;
  rotations: Record<string, number>;
  flipShare: number;
  profiles?: TileEdgeProfiles;
}

export interface EngineStats {
  schemaVersion: number;
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
  groundSchemes: { counts: Record<string, number> };
  forms: {
    kinds: Record<string, number>;
    sizes: Record<string, number>;
    byFamily: Record<string, number>;
    friezeRows: Record<string, number>;
  };
  plain: { positions: Record<string, number> };
}

export interface EngineGrammar {
  schemaVersion: number;
  stats: EngineStats;
  templates: Template[];
  tileCatalog: Record<string, TileCatalogEntry>;
  palette: {
    globalGrounds: Record<string, number>;
    inkByGround: Record<string, Record<string, number>>;
    accentOrder: string[];
  };
}
