/** Scene → SVG string. The only string emitter in the engine. */
import type { Scene } from "../types";
import { get } from "../primitives/registry";
import { mulberry32 } from "../rng";
import { assertNoLogomark } from "./logo-guard";

export interface RenderOpts {
  /**
   * Paint a hairline stroke of each shape's own fill over its edge. Renderers
   * anti-alias shapes independently, so shared edges between same-color shapes
   * leak the field color through as faint seams (PDF, print, thumbnails);
   * the overdraw covers the gap. Default on.
   */
  seamGuard?: boolean;
  /**
   * Emit `data-node-id` on each node's `<g>` so an interactive editor can
   * hit-test and select tiles via the live SVG. Default off — exports and the
   * flatten path never tag, so downloaded SVGs stay clean and golden output is
   * unchanged.
   */
  tagNodes?: boolean;
}

/** fill="X" → fill + matching hairline stroke (skips fill="none"). */
function guardFills(fragment: string, sw: number): string {
  return fragment.replace(
    /fill="(#[0-9A-Fa-f]{6})"(?![^<>]*stroke=)/g,
    `fill="$1" stroke="$1" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round"`,
  );
}

export function renderSvg(scene: Scene, opts: RenderOpts = {}): string {
  const seamGuard = opts.seamGuard ?? true;
  const sw = 0.6;
  assertNoLogomark(scene);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}">`,
    `<rect width="${scene.width}" height="${scene.height}" fill="${scene.ground}"/>`,
  ];
  for (const node of scene.nodes) {
    const def = get(node.primitive);
    // deterministic per-node rng (seed+id derived) for primitives with internal variation
    let h = (2166136261 ^ scene.seed) >>> 0;
    for (const c of node.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    let frag = def
      .draw({ rng: mulberry32(h >>> 0) })
      .replaceAll('"INK"', `"${node.color}"`)
      .replaceAll('"GROUND"', `"${node.ground}"`);
    // fragment is in 200-unit cell space, scaled by cell.w/200 at paint time —
    // compensate so the painted hairline is sw px regardless of cell size
    if (seamGuard) frag = guardFills(frag, sw * (200 / node.cell.w));
    const { x, y, w, h: ch } = node.cell;
    if (node.ground !== scene.ground) {
      const g = seamGuard ? ` stroke="${node.ground}" stroke-width="${sw}"` : "";
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ch}" fill="${node.ground}"${g}/>`);
    }
    const ops = [`translate(${x},${y})`, `scale(${w / 200},${ch / 200})`];
    if (node.rot) ops.push(`rotate(${node.rot},100,100)`);
    if (node.flip) ops.push(`translate(200,0) scale(-1,1)`);
    const tag = opts.tagNodes ? ` data-node-id="${node.id}"` : "";
    parts.push(`<g${tag} transform="${ops.join(" ")}">${frag}</g>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
