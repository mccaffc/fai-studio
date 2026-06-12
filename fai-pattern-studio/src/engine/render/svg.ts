/** Scene → SVG string. The only string emitter in the engine. */
import type { Scene } from "../types";
import { get } from "../primitives/registry";
import { mulberry32 } from "../rng";
import { assertNoLogomark } from "./logo-guard";

export function renderSvg(scene: Scene): string {
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
    const frag = def
      .draw({ rng: mulberry32(h >>> 0) })
      .replaceAll('"INK"', `"${node.color}"`)
      .replaceAll('"GROUND"', `"${node.ground}"`);
    const { x, y, w, h: ch } = node.cell;
    if (node.ground !== scene.ground) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${ch}" fill="${node.ground}"/>`);
    }
    const ops = [`translate(${x},${y})`, `scale(${w / 200},${ch / 200})`];
    if (node.rot) ops.push(`rotate(${node.rot},100,100)`);
    if (node.flip) ops.push(`translate(200,0) scale(-1,1)`);
    parts.push(`<g transform="${ops.join(" ")}">${frag}</g>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
