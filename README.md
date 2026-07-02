# FAI Studio

Seeded, deterministic Bauhaus-style pattern/banner generator for the FAI brand.
Ground-up rebuild (June 2026) of the legacy Flask banner studio.

- **Engine** (`src/engine/`) — separable, zero-dependency TypeScript. No DOM, no fs.
  Runs in browser, Node, or a Worker. `npm run build:engine` emits a single-file
  ESM bundle (`dist-engine/index.js`) you can drop into any site or workflow.
  API: `generate(config)`, `reroll`, `variations`, `recolor(scene, color)`, `renderSvg`, `describe`.
- **Corpus mode** (default since July 2026) — generation backed by a grammar
  mined from the 50 canonical hand-made banners: `src/engine/corpus/` (zero-dep;
  baked data modules regenerated via `npm run gen:engine-data`). API:
  `generateBanner`, `reroll`, `variations`, `recolorPlan` (geometry-frozen
  recolor), quilt-test curation built in. **Program banners:** \`generateBanner({program})\`
  (or the studio Program select) yields neutrals-only banners — Cod Gray/Smoke
  White/Timberwolf + exactly one of the six locked program hues — with the palette
  law machine-enforced. Freeform regions place real corpus-mined figure assets. The mining/grammar pipeline lives in
  `tools/mine/` + `tools/grammar/` with the corpus artifacts under `corpus/`
  (validation + sample sheets + gate records included). Classic mode remains
  available via the header toggle.
- **Studio** (`src/studio/` + `index.html`) — static client-side UI: live canvas
  (spacebar rerolls), variations tray, save tray, in-place recolor (color
  changes never re-roll geometry), SVG/PNG/clipboard export with print-safe
  flatten. `npm run dev` to run; `npx vite build` → `dist-site/` (opens from
  file://).

- **Deployment** — GitHub Pages: https://mccaffc.github.io/fai-studio/
  auto-deploys on every push to `main` via `.github/workflows/pages.yml`.
  (The old Render services are retired.)
- **Shape system** — 7 families (~44 procedural primitives) refactored from the
  140 legacy tiles per the `tile-coverage.md` audit (the legacy Python banner
  pipeline and its outputs now live in `FAI Brand/04-Illustrations`).
  Super-form recipes (`src/engine/compose/superforms.ts`) encode the proven
  multi-cell fusions: striped targets, pipe runs, ground-circles, pill columns.
- **Composition knobs** — all in `src/engine/tuning.ts`. Tweak numbers, not logic.
- **Brand law** — the double-chevron logomark is never drawn (`render/logo-guard.ts`
  throws); composed surfaces use Smoke White, never pure white, as primary ink.

Tests: `npm test` (determinism, color-mode isolation, constraints, logo-guard).
Batch render: `npm run batch -- out-dir` (proves Node reuse; emits SVGs).
Batch-flatten a folder of existing SVGs the same way the studio export does:
`npm run flatten:dir -- <inDir> [outDir]` (headless paper.js via jsdom; uses
the shared `src/studio/flatten-core.ts` so results match the in-app export).

This repo lives at `FAI/fai-studio` on the Store mount. For heavy work
(`npm install`/build/test) clone locally and push back — don't run npm
installs on the Store mount.
