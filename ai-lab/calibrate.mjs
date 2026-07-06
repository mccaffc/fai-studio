// "Train" the component gate on the canonical banners: measure their real
// accent-vs-neutral color footprint so the gate's accent band + boost target
// match the reference set instead of a guess. Run: node ai-lab/calibrate.mjs
import { execSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";

const DIR = "/Users/chris/Store/Coding Projects/FAI/FAI Brand/04-Illustrations/output/banners-clean";
// classify each pixel by NEAREST brand color (so anti-aliased midtone greys map
// to neutrals, not "accent"); accent footprint = pixels whose nearest is an accent.
const PAL = { ink: [18, 18, 18], white: [255, 255, 255], smoke: [243, 243, 243], wolf: [217, 217, 214], orange: [255, 79, 0], yellow: [255, 163, 0], blue: [73, 151, 208], violet: [130, 101, 219], magenta: [214, 58, 140], green: [38, 139, 65], indigo: [58, 74, 107] };
const ACC = new Set(["orange", "yellow", "blue", "violet", "magenta", "green", "indigo"]);
const nearest = (r, g, b) => { let best = "ink", bd = 1e9; for (const k in PAL) { const [R, G, B] = PAL[k]; const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < bd) { bd = d; best = k; } } return best; };

function accentShare(file) {
  const out = execSync(`magick "${file}" -resize '160x80!' -format "%c" histogram:info:-`, { encoding: "utf8", maxBuffer: 5e7 });
  let total = 0, accent = 0;
  for (const line of out.split("\n")) {
    const m = line.match(/\s*(\d+):\s*\(\s*(\d+),\s*(\d+),\s*(\d+)/);
    if (!m) continue;
    const c = +m[1], r = +m[2] / 257, g = +m[3] / 257, b = +m[4] / 257; // magick emits 16-bit (0-65535)
    total += c; if (ACC.has(nearest(r, g, b))) accent += c;
  }
  return total ? accent / total : 0;
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".svg")).sort();
const shares = files.map((f) => accentShare(`${DIR}/${f}`)).sort((a, b) => a - b);
const q = (p) => shares[Math.floor(p * (shares.length - 1))];
const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
const nonZero = shares.filter((s) => s > 0.02);
const cal = {
  n: shares.length, withAccent: nonZero.length,
  mean: +mean.toFixed(3), p10: +q(0.1).toFixed(3), p25: +q(0.25).toFixed(3),
  p50: +q(0.5).toFixed(3), p75: +q(0.75).toFixed(3), p90: +q(0.9).toFixed(3),
  meanWithAccent: +(nonZero.reduce((a, b) => a + b, 0) / (nonZero.length || 1)).toFixed(3),
};
console.log(JSON.stringify(cal, null, 2));
writeFileSync(new URL("./calibration.json", import.meta.url), JSON.stringify(cal, null, 2));
