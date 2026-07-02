export const SCHEMA_VERSION = 1;

export type Hex = string; // '#RRGGBB' uppercase

export interface CellRecon {
  col: number;              // 0..5
  row: number;              // 0..2
  ground: Hex;              // resolved backing color of this cell
  kind: 'tile' | 'plain' | 'freeform' | 'review';
  tile?: string;            // manifest id, when kind==='tile'
  rotation?: 0 | 90 | 180 | 270;
  flip?: boolean;           // horizontal mirror before rotation
  ink?: Hex;                // dominant foreground color
  inks?: Hex[];             // all foreground colors present
  score?: number;           // IoU of the accepted match
  candidates?: { tile: string; rotation: number; flip: boolean; score: number }[]; // top 3, for review
}

export interface FormGroup {
  id: string;               // e.g. '009-form-1'
  kind: 'run' | 'figure' | 'frieze';
  cells: [number, number][]; // [col,row]
  family?: string;          // shape_family when tile-based
  ink: Hex;
}

export interface BannerRecon {
  id: string;               // '009'
  width: 1920; height: 960; cols: 6; rows: 3;
  ground: Hex;              // full-canvas ground
  cells: CellRecon[];       // always 18, row-major
  forms: FormGroup[];
  matchRate: number;        // fraction of non-plain cells with kind==='tile'
}

export interface Corpus {
  schemaVersion: number;
  minedAt: string;          // ISO date, passed in by CLI (never Date.now() in lib code)
  banners: BannerRecon[];
}
