# P8 Task 3 — Corpus Editor Interface Spec (controller-authored)

Port the classic editor's cell-editing experience to corpus mode. The classic editor
(src/studio/editor/) operates on the classic `Scene`; corpus plans are `BannerPlan`/`CellPlan`
(src/engine/corpus/types.ts). This spec defines the corpus counterpart. v1 scope only.

## Architecture

- New `src/studio/editor-corpus/` with:
  - `plan-ops.ts` — pure operations over a working `BannerPlan` copy (the counterpart of
    scene-ops.ts). Every op returns `{ ok: true } | { ok: false, reason: string }` (match the
    classic OpResult idiom) and mutates the working plan in place; the controller module owns
    history via structuredClone snapshots (plans are plain JSON — cloneable).
  - `index.ts` — controller: mounts/unmounts, owns EditorState {plan, selection: Set<cellKey>,
    tool, history[], future[]}, renders through `renderPlanSvg(plan, TILES, { nodeIds: true })`
    (the data-node-id="col,row" attrs are the click-target mapping), wires keyboard (Esc exit,
    Cmd/Ctrl-Z undo, Shift-redo, r rotate, f flip, x clear-to-plain).
  - Reuse from classic editor VERBATIM (import, don't copy): dom.ts helpers. Do NOT reuse
    overlay.ts/state.ts/inspector.ts (Scene-typed throughout) — corpus gets its own thin
    equivalents; keep them small, the classic ones are the style reference.

## plan-ops.ts API (exact signatures)

```ts
export type CellRef = { col: number; row: number };
export function cellAt(plan: BannerPlan, ref: CellRef): CellPlan | null;
export function setTile(plan: BannerPlan, ref: CellRef, tileId: string): OpResult;      // kind→'tile', keeps ink/ground, resets rotation 0 flip false
export function setRotation(plan: BannerPlan, ref: CellRef, rot: 0|90|180|270): OpResult;
export function cycleRotation(plan: BannerPlan, ref: CellRef): OpResult;
export function toggleFlip(plan: BannerPlan, ref: CellRef): OpResult;
export function setInk(plan: BannerPlan, ref: CellRef, hex: string): OpResult;           // hex must be one of the 11 permitted fills → else {ok:false}
export function setGround(plan: BannerPlan, ref: CellRef, hex: string): OpResult;        // same validation; ink==ground → {ok:false,'ink equals ground'}
export function clearToPlain(plan: BannerPlan, ref: CellRef): OpResult;                  // kind→'plain', drops tile/ink/rotation/flip
export function forEachSelected(plan, refs: CellRef[], op): OpResult;                    // applies op to all; first failure aborts + reports
```

- Figure/patch cells (figureId/figureSpan/patchId present): v1 treats them as LOCKED — ops on
  them return `{ok:false, reason:'figure/patch cells are locked in v1'}`. (Moving/authoring is v2.)
- The 11 permitted fills constant: define locally in plan-ops.ts with a comment naming the
  source (locked palette 2026-06-18); do not import studio UI constants into ops.
- After every successful op batch the controller re-renders the full SVG (plans are ≤18 cells —
  no incremental rendering).

## UI

- Entry: `Edit` button appended to the corpus canvas-actions row. Enter → the generate controls
  hide (panel shows a single "editing — changes are yours, scores off" note + Exit/Save buttons);
  canvas becomes click-to-select (click = select, shift-click = add to selection; selected cells
  get a 2px orange outline rect overlaid in SVG coordinates).
- Inspector strip under the canvas (reuse .canvas-actions styling): tile family select + tile
  select (grouped by family, from the engine TILES catalog), rotate/flip buttons, ink + ground
  swatch rows (the 11 fills, reuse .accent-swatch visual), Clear-to-plain, Undo/Redo.
- Exit: returns to generate mode, restores the pre-edit generated banner + controls. Save: stamps
  the edited plan into the save tray via the existing onSave path with `edited: true` in the
  config snapshot; tray thumbnails render edited plans exactly like generated ones; scores hidden
  for edited entries.
- No new colors/fonts; tokens only; every new interactive element gets the standard focus ring.

## Tests (red-first)

- plan-ops unit tests: each op happy path + validation failures (non-permitted hex, ink==ground,
  locked figure/patch cell, out-of-bounds ref); forEachSelected abort semantics.
- Controller tests (jsdom, follow test/studio-corpus.test.ts idioms): enter edit → click a cell →
  setInk via inspector → svg re-renders with the new fill; undo restores; exit restores the
  generated banner; save delivers edited:true.
- Palette-law: an edited plan can never contain a fill outside the 11 (assert by construction:
  ops reject; test tries and asserts unchanged plan).
