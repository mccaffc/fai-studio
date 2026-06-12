/** The engine contract. Everything else is internal. */

export type ColorMode = "duotone" | "vertical" | "full";

export type Arrangement =
  | "banner" // 6×3
  | "strip" // 3×1
  | "column" // 1×3
  | "landscape" // 3×2
  | "portrait" // 2×3
  | "square" // 3×3
  | "free"; // 4×4 with heavy block merging

export type CategoryId =
  | "triangles"
  | "bars"
  | "arcs"
  | "discs"
  | "capsules"
  | "waves"
  | "frames";

export type Rotation = 0 | 90 | 180 | 270;

/** Semantic color roles; recolor() re-resolves roles without moving geometry.
 *  "canvas" paints with the canvas ground hex — black shapes on colored blocks. */
export type ColorRole = "ink" | "accent" | "canvas";

export interface ColorConfig {
  mode: ColorMode;
  /** vertical only — the single accent hex. Nulled by normalizeConfig elsewhere. */
  accent?: string | null;
}

export interface Config {
  seed: number;
  arrangement: Arrangement;
  /** custom grid override (cols×rows); cells stay square, canvas aspect follows */
  grid?: { cols: number; rows: number } | null;
  /** false = clean uniform grid; true = Robson-style block merging for varied cell sizes */
  varied: boolean;
  color: ColorConfig;
  /** enabled shape families (≥1) */
  categories: CategoryId[];
  /** 0..1 → fill probability + feature count */
  density: number;
  symmetry: "none" | "mirror" | "auto";
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneNode {
  id: string;
  primitive: string;
  category: CategoryId;
  cell: Rect;
  rot: Rotation;
  flip: boolean;
  role: ColorRole;
  /** which accent slot an accent node draws from (mod palette size at resolve) */
  accentIndex?: number;
  /** resolved fg hex (so render targets need no palette) */
  color: string;
  /** colored ground block under this cell ("canvas" = the shared field) */
  groundRole: "canvas" | "accent" | "ink";
  groundIndex?: number;
  /** resolved ground hex for this cell */
  ground: string;
  /** which feature/run produced it (debugging + run identity) */
  form: string;
}

export interface ResolvedPalette {
  ground: string;
  ink: string;
  /** empty in duotone (pure b&w); one hex in vertical; all fills in full */
  accents: string[];
  /** UI hint — vertical owns the accent picker */
  ui: { accentPicker: boolean };
}

export interface Scene {
  width: number;
  height: number;
  ground: string;
  palette: ResolvedPalette;
  nodes: SceneNode[];
  seed: number;
  config: Config;
}

export interface GenMeta {
  cells: number;
  filled: number;
  features: string[];
  dominant: CategoryId;
  rejects: number;
}

export interface GenResult {
  svg: string;
  scene: Scene;
  seed: number;
  config: Config;
  meta: GenMeta;
}

export interface Rng {
  /** [0,1) */ next(): number;
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
}
