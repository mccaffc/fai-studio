/**
 * Batch-flatten every SVG in a directory through the EXACT same merge as the
 * studio's "print-safe" export (shared src/studio/flatten-core.ts) — produces
 * clean, seam-free, one-path-per-color interlocking SVGs.
 *
 *   npm run flatten:dir -- <inDir> [outDir]
 *   (default outDir = <inDir>/../<inDirName>-flat)
 *
 * Runs paper.js headless via jsdom + canvas (dev deps).
 */
import { createRequire } from "node:module";
import { readdirSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { mergeFlat } from "../dist-flatten/flatten-core.js";

const inDir = process.argv[2];
if (!inDir) {
  console.error("usage: node scripts/flatten-dir.mjs <inDir> [outDir]");
  process.exit(1);
}
const outDir =
  process.argv[3] ?? join(dirname(resolve(inDir)), `${basename(resolve(inDir))}-flat`);

// paper's node build pulls in jsdom/canvas at require() time, so set up DOM
// globals first, then require paper (NOT dynamic import — that triggers a
// broken node-canvas resolution path).
const dom = new JSDOM("<!DOCTYPE html><body></body>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.self = dom.window;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;

const require = createRequire(import.meta.url);
const paperLib = require("paper");
const ps = typeof paperLib.PaperScope === "function" ? new paperLib.PaperScope() : paperLib;
ps.setup(new ps.Size(8, 8));

mkdirSync(outDir, { recursive: true });
const files = readdirSync(inDir).filter((f) => f.toLowerCase().endsWith(".svg")).sort();
let ok = 0;
let failed = 0;
for (const f of files) {
  try {
    const src = readFileSync(join(inDir, f), "utf8");
    const flat = mergeFlat(ps, src);
    writeFileSync(join(outDir, f), flat);
    const colors = [...new Set(flat.match(/#[0-9A-Fa-f]{6}/g) || [])].length;
    console.log(`✓ ${f}  (${colors} colors, ${flat.length} bytes)`);
    ok++;
  } catch (e) {
    console.error(`✗ ${f}: ${e.message}`);
    failed++;
  }
}
console.log(`\nflattened ${ok}/${files.length} → ${outDir}${failed ? `  (${failed} failed)` : ""}`);
