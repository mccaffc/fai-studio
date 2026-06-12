/** Importing this module populates the registry exactly once. */
import "./cat1-triangles";
import "./cat2-bars";
import "./cat3-arcs";
import "./cat4-discs";
import "./cat5-capsules";
import "./cat6-waves";
import "./cat7-frames";

export { byCategory, get, allKeys } from "./registry";
export type { PrimitiveDef, DrawCtx } from "./registry";

import type { CategoryId } from "../types";

export const CATEGORY_META: Record<CategoryId, { label: string }> = {
  triangles: { label: "Triangles & Chevrons" },
  bars: { label: "Bars & Colonnades" },
  arcs: { label: "Arcs & Sweeps" },
  discs: { label: "Discs & Dots" },
  capsules: { label: "Capsules & Lenses" },
  waves: { label: "Waves & Scallops" },
  frames: { label: "Crosses, Frames & Grids" },
};
