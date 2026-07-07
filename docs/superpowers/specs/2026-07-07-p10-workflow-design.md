# P10 Task 3 — Workflow Design (controller-authored; implementation is transcription)

Three features around the real hunt: reroll fearlessly (history), scan wide (sheet), export to the
destination (presets). IBM register, tokens only, no new colors.

## 1. Seed history

- Session-scoped (not persisted). `history: Array<{ seed: number; config: CorpusSaveConfig }>` cap 50,
  plus a pointer. Push on every NEW generation: regen with new seed, spacebar/button reroll, promotion
  from variations or the sheet. Do NOT push on recolor-in-place or config-only re-renders.
- Walking: ← / → keys and ‹ › buttons flanking the seed input. Walking regenerates deterministically
  from the stored snapshot (seed + full config incl. template/arrangement/accentPool/program). Walking
  back then generating something new drops the forward tail (standard editor-history semantics).
- Buttons disabled at the ends; hint line (11px mono, --soft register) under the Seed group:
  `‹ › history · space reroll · S save · E edit`.
- Editor interplay: entering the editor freezes history (no pushes); exiting restores the pointer.

## 2. Batch sheet — "Sheet ×12"

- Button `Sheet ×12` in canvas-actions (generate mode only). Opens a full-viewport overlay:
  near-black scrim (`--ink` at 92%), 4×3 CSS grid, 16px gutters, each cell = the rendered SVG
  (aspect-true, contained) + one caption line `seed · template` (11px mono).
- Content: seeds current+1 … current+12; templates CYCLED through the six template ids in canonical
  order, two each — diversity by construction. All other config (program/accentPool/density/figures/
  arrangement) = current panel state.
- Interactions: click a cell → promote: adopt that seed AND template into the panel config, regenerate
  on the canvas (identical plan by determinism), push history, close. Esc or scrim-click closes without
  promoting. While open: ← → move a focus ring across cells, Enter promotes the focused cell (keyboard
  parity; focus ring = 2px #FF4F00).
- Generation is engine-fast (0.5ms/plan); render all 12 before showing (no skeleton needed).

## 3. Destination export presets

- The export row gains a select `Export…` before the existing buttons:
  `Custom (buttons below)` (default) · `Hero — 2560×1280 PNG` · `Deck panel — 1920×960 PNG` ·
  `Eyebrow — 2880×960 PNG` · `Square social — 2048×2048 PNG`.
- Aspect mapping (SVG is vector — any pixel size at matching aspect): Hero + Deck panel = banner 6×3
  (2:1) · Eyebrow = strip 3×1 (3:1) · Square = square 3×3 (1:1). (Plan said 3840×640 for eyebrow —
  CORRECTED here: 6:1 matches no arrangement; the strip's 3:1 at 2880×960 is right for deck eyebrows.)
- Choosing a preset whose arrangement ≠ current: regenerate the SAME seed under the target arrangement
  first (different design is unavoidable — flash "re-generated at strip 3×1 for Eyebrow"), then export.
  Filename: `fai-{preset-slug}-{template}-{seed}-{WxH}.png`.
- The preset performs the export immediately on selection, then the select snaps back to `Custom` (it
  is an action menu, not a mode).

## 4. Keyboard summary (generate mode)

space reroll · S save · E edit · ← → history · (sheet open: ← → focus, Enter promote, Esc close).
Guard: all single-key shortcuts no-op when focus is in an input/select/textarea.

## Tests (jsdom, existing idioms)

History: reroll ×3 → ← ← restores exact seed+svg of two ago → new reroll drops forward tail.
Sheet: opens with 12 cells, 2 per template, captions correct; click promotes seed+template and closes;
Esc closes without change. Presets: eyebrow preset from banner arrangement regenerates same-seed strip
and the download call carries 2880×960 (spy the export path like existing export tests); select snaps
back to Custom. Keyboard guard: S in the seed input does not save.
