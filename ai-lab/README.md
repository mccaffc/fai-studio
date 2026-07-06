# AI Composition Lab (temporary)

A throwaway switcher to *feel out* how different LLMs compose FAI banners **using the studio's own
engine** — its real primitives, super-form recipes, grid, and the full FAI palette. The model emits a
plan referencing real engine keys; the browser renders it with the engine's own `renderSvg`
(`engine.bundle.mjs`), so the output is a genuine studio scene. Every model routes through **OpenRouter**
with one key (switching model = a dropdown).

## Run

```sh
cd "FAI/fai-studio/ai-lab"
node server.mjs                 # reads OPENROUTER_API_KEY from the env (it's in ~/.zshenv)
# open http://localhost:5175
```

Zero npm deps (Node ≥ 18). The key stays **server-side**. `AILAB_PORT` changes the port.
Remote (from the laptop): `ssh -L 5175:localhost:5175 studio`, then open `http://localhost:5175`.

## Controls
- **Model** — 10 models (Claude / OpenAI / Google / open-weight), all via OpenRouter.
- **Arrangement** — banner 6×3, square 3×3, landscape, portrait, etc. (engine grid, 200px cells).
- **Shape family** — All, or lock to one of the 7 engine families to iterate within it.
- **Palette in play** — pick any of the 11 canonical FAI fills; the model uses only what you check.
- **Brief** + presets; **Generate · Iterate** (press again to iterate); **History** tray to compare.
Each result shows title, rationale, families used, tokens, **cost**, **latency**.

## How a plan renders
The model places **recipes** (proven multi-cell tilings — `center-disc`, `ground-circle`, `valley`,
`owl-eyes`, `dome-frieze`, …) and **single primitives** on the grid. `engine-entry.ts` is the esbuild
entry that bundles the engine + recipes → `engine.bundle.mjs` (rebuild:
`npx esbuild ai-lab/engine-entry.ts --bundle --format=esm --platform=neutral --outfile=ai-lab/engine.bundle.mjs`).

## Known rough edges (tuning targets)
- The engine vocabulary is **low-level tiles**; quality varies by model and prompt. Recipes help a lot.
- Models sometimes under-scale the focal (a lone tile in a big grid) or leave the banner too sparse —
  the canonical *banners* are dense grids (only freestyle *squares* are sparse figure-ground). The
  system prompt in `prompt.mjs` is where to tune density / focal-scaling per arrangement.
- There is no single "big Capitol dome" primitive; a dome is approximated.

## Not production
Dev tool. Production path: a Vite page in the studio + a **Cloudflare Worker** holding the key (the
deployed studio is static). See `../../FAI Brand/04-Illustrations/llm-planner-battery/FINDINGS.md`.
The old standalone `renderer.mjs` is superseded by `engine.bundle.mjs` and can be deleted.
