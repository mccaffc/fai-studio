/**
 * @fai/pattern-engine — separable, deterministic, zero-dependency.
 * Runs in browser, Node, or a Worker. No DOM, no fs.
 */
import type {
  ColorConfig,
  Config,
  GenResult,
  Scene,
} from "./types";
import { defaultConfig, normalizeConfig, ALL_CATEGORIES } from "./config";
import { compose } from "./compose/generate";
import { renderSvg } from "./render/svg";
import { resolvePalette, normalizeColor } from "./color/modes";
import { resolveColor } from "./color/roles";
import { ARRANGEMENTS } from "./grid/arrangements";
import { layoutGrid } from "./grid/layout";
import { mulberry32 } from "./rng";
import { CATEGORY_META } from "./primitives/index";
import { ALL_ACCENTS, BRAND, PROPOSAL } from "./color/brand";

export const VERSION = "0.1.0";

export function generate(partial: Partial<Config>): GenResult {
  const config = normalizeConfig(partial);
  const { scene, meta } = compose(config);
  return { svg: renderSvg(scene), scene, seed: config.seed, config, meta };
}

export function reroll(config: Config, nextSeed?: number): GenResult {
  return generate({ ...config, seed: nextSeed ?? (config.seed + 1) >>> 0 });
}

export function variations(config: Config, count: number): GenResult[] {
  return Array.from({ length: count }, (_, i) =>
    generate({ ...config, seed: (config.seed + 1 + i) >>> 0 }),
  );
}

/**
 * An empty scene for a given config — the laid-out grid with no shapes.
 * The freeform editor starts here and adds nodes. `width`/`height` come from
 * `layoutGrid` so canvas/PNG dimensions are correct; the cells themselves are
 * the editor's concern (it tracks its own occupancy), so only the dimensions
 * are kept. The grid is forced uniform (no `varied` supercells) for a clean
 * blank slate.
 */
export function emptyScene(partial: Partial<Config>): Scene {
  const config = normalizeConfig({ ...partial, varied: false });
  const palette = resolvePalette(config.color);
  const layout = layoutGrid(config, mulberry32(config.seed));
  return {
    width: layout.width,
    height: layout.height,
    ground: palette.ground,
    palette,
    nodes: [],
    seed: config.seed,
    config,
  };
}

/** Re-skin an existing scene without moving geometry. */
export function recolor(scene: Scene, color: ColorConfig): GenResult {
  const cc = normalizeColor(color);
  const palette = resolvePalette(cc);
  const config: Config = { ...scene.config, color: cc };
  const next: Scene = {
    ...scene,
    config,
    ground: palette.ground,
    palette,
    nodes: scene.nodes.map((n) => ({
      ...n,
      color: resolveColor(n.role, n.accentIndex, palette),
      ground:
        n.groundRole === "canvas"
          ? palette.ground
          : resolveColor(n.groundRole === "ink" ? "ink" : "accent", n.groundIndex, palette),
    })),
  };
  return {
    svg: renderSvg(next),
    scene: next,
    seed: scene.seed,
    config,
    meta: { cells: 0, filled: next.nodes.length, features: ["recolor"], dominant: config.categories[0]!, rejects: 0 },
  };
}

export function describe() {
  return {
    version: VERSION,
    arrangements: ARRANGEMENTS,
    categories: CATEGORY_META,
    brand: BRAND,
    proposal: PROPOSAL,
    allAccents: ALL_ACCENTS,
    defaults: defaultConfig(),
  };
}

export { renderSvg } from "./render/svg";
export { normalizeConfig, defaultConfig, ALL_CATEGORIES };
export { resolvePalette } from "./color/modes";
export { resolveColor } from "./color/roles";
export { ARRANGEMENTS } from "./grid/arrangements";
// editor-facing surface: enumerate primitives, validate the brand mark
export { byCategory, get, CATEGORY_META } from "./primitives/index";
export type { PrimitiveDef } from "./primitives/index";
export { findLogomarkPair, violatesLogomark } from "./render/logo-guard";
export { ALL_ACCENTS, BRAND, PROPOSAL } from "./color/brand";
export type * from "./types";
