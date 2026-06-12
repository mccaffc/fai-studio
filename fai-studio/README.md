# FAI Studio

Seeded, deterministic Bauhaus-style pattern/banner generator for the FAI brand.
Ground-up rebuild (June 2026) of the legacy Flask banner studio.

- **Engine** (`src/engine/`) — separable, zero-dependency TypeScript. No DOM, no fs.
  Runs in browser, Node, or a Worker. `npm run build:engine` emits a single-file
  ESM bundle (`dist-engine/index.js`) you can drop into any site or workflow.
  API: `generate(config)`, `reroll`, `variations`, `recolor(scene, color)`, `renderSvg`, `describe`.
- **Studio** (`src/studio/` + `index.html`) — static client-side UI: live canvas
  (spacebar rerolls), variations tray, save tray, in-place recolor (color
  changes never re-roll geometry), SVG/PNG/clipboard export with print-safe
  flatten. `npm run dev` to run; `npx vite build` → `dist-site/` (opens from
  file://).

- **Deployment** — GitHub Pages: https://mccaffc.github.io/fai-studio/
  auto-deploys from `main` via `.github/workflows/pages.yml` whenever
  `fai-studio/**` changes. (The old Render services are retired.)
- **Shape system** — 7 families (~44 procedural primitives) refactored from the
  140 legacy tiles per the audit in `../output/audit/tile-coverage.md`.
  Super-form recipes (`src/engine/compose/superforms.ts`) encode the proven
  multi-cell fusions: striped targets, pipe runs, ground-circles, pill columns.
- **Composition knobs** — all in `src/engine/tuning.ts`. Tweak numbers, not logic.
- **Brand law** — the double-chevron logomark is never drawn (`render/logo-guard.ts`
  throws); composed surfaces use Smoke White, never pure white, as primary ink.

Tests: `npm test` (determinism, color-mode isolation, constraints, logo-guard).
Batch render: `npm run batch -- out-dir` (proves Node reuse; emits SVGs).

Heavy work happens in a local clone (`~/Developer/fai-studio` on the
laptop); source syncs back here. Don't run npm installs on the Store mount.
