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
export type * from "./types";
