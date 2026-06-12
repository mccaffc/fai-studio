/**
 * Batch render — proves the engine runs headless in Node (separability) and
 * emits SVGs for the visual gate. PNG conversion happens via cairosvg outside.
 *
 *   npm run batch [-- outdir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { generate } from "../dist-engine/index.js";

const out = process.argv[2] ?? "batch-out";
mkdirSync(out, { recursive: true });

const jobs = [
  { name: "full-banner-a", cfg: { seed: 101, arrangement: "banner", color: { mode: "full" } } },
  { name: "full-banner-b", cfg: { seed: 202, arrangement: "banner", color: { mode: "full" } } },
  { name: "full-banner-c", cfg: { seed: 303, arrangement: "banner", color: { mode: "full" }, density: 0.75 } },
  { name: "full-banner-d", cfg: { seed: 404, arrangement: "banner", color: { mode: "full" }, density: 0.35 } },
  { name: "duotone-orange", cfg: { seed: 505, arrangement: "banner", color: { mode: "duotone" } } },
  { name: "duotone-blue", cfg: { seed: 606, arrangement: "banner", color: { mode: "duotone", accent: "#4997D0" } } },
  { name: "duotone-yellow", cfg: { seed: 707, arrangement: "banner", color: { mode: "duotone", accent: "#FFA300" } } },
  { name: "extended", cfg: { seed: 808, arrangement: "banner", color: { mode: "extended", allowProposal: true } } },
  { name: "strip", cfg: { seed: 909, arrangement: "strip", color: { mode: "full" } } },
  { name: "column", cfg: { seed: 1010, arrangement: "column", color: { mode: "full" } } },
  { name: "landscape", cfg: { seed: 1111, arrangement: "landscape", color: { mode: "full" } } },
  { name: "portrait", cfg: { seed: 1212, arrangement: "portrait", color: { mode: "full" } } },
  { name: "square", cfg: { seed: 1313, arrangement: "square", color: { mode: "full" } } },
  { name: "free", cfg: { seed: 1414, arrangement: "free", color: { mode: "full" } } },
  { name: "tri-only", cfg: { seed: 1515, arrangement: "banner", categories: ["triangles"], color: { mode: "duotone" } } },
  { name: "bars-only", cfg: { seed: 1616, arrangement: "banner", categories: ["bars"], color: { mode: "full" } } },
];

for (const { name, cfg } of jobs) {
  const r = generate(cfg);
  writeFileSync(`${out}/${name}.svg`, r.svg);
  console.log(
    `${name}: ${r.scene.nodes.length} nodes, features=[${r.meta.features.join(", ")}], dominant=${r.meta.dominant}`,
  );
}
console.log(`wrote ${jobs.length} svgs to ${out}/`);
