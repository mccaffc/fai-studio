import type { BannerPlan, CellPlan } from "../../engine/corpus/types.js";
import { renderPlanSvg } from "../../engine/corpus/render.js";
import { TILES } from "../../engine/corpus/data/tiles.js";
import { $, button, el } from "../editor/dom";
import {
  cellAt,
  clearToPlain,
  cycleRotation,
  forEachSelected,
  setGround,
  setInk,
  setTile,
  toggleFlip,
  type CellRef,
  type PlanOp,
} from "./plan-ops";

export interface CorpusEditorHost {
  flash(msg: string, isError?: boolean): void;
  onExit(): void;
  onSavePlan(plan: BannerPlan): void;
}

export interface CorpusEditorState {
  plan: BannerPlan;
  selection: Set<string>;
  tool: "select";
  history: BannerPlan[];
  future: BannerPlan[];
  dirty: boolean;
}

const CELL_PX = 320;
const UNDO_CAP = 80;
const SELECT_STROKE = "#FF4F00";
const FILLS = [
  "#121212",
  "#FFFFFF",
  "#F3F3F3",
  "#D9D9D6",
  "#FF4F00",
  "#FFA300",
  "#7150D6",
  "#0E8C88",
  "#268B41",
  "#4997D0",
  "#C8102E",
];
const SMOKE_WHITE_CHECK_HEXES = new Set(["#268B41", "#C8102E", "#7150D6"]);

// Intentionally includes programOnly tiles: the editor is a curator's hand
// tool, not the auto-generation path — hand-placing program vocabulary is a
// legitimate use. The program-only gate applies to the SAMPLER only.
const tilesByFamily = new Map<string, string[]>();
for (const [id, tile] of Object.entries(TILES)) {
  const ids = tilesByFamily.get(tile.family) ?? [];
  ids.push(id);
  tilesByFamily.set(tile.family, ids);
}
const families = [...tilesByFamily.keys()].sort((a, b) => a.localeCompare(b));
for (const ids of tilesByFamily.values()) ids.sort((a, b) => a.localeCompare(b));

let host: CorpusEditorHost | null = null;
let st: CorpusEditorState | null = null;
let activeFamily = families[0] ?? "";
let activeTile = tilesByFamily.get(activeFamily)?.[0] ?? "";

function cur(): CorpusEditorState {
  if (!st) throw new Error("corpus editor not active");
  return st;
}

function clonePlan(plan: BannerPlan): BannerPlan {
  return structuredClone(plan);
}

function cellKey(ref: CellRef): string {
  return `${ref.col},${ref.row}`;
}

function parseCellKey(key: string): CellRef | null {
  const [colRaw, rowRaw] = key.split(",");
  const col = Number(colRaw);
  const row = Number(rowRaw);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  return { col, row };
}

function selectedRefs(): CellRef[] {
  return [...cur().selection].flatMap((key) => {
    const ref = parseCellKey(key);
    return ref ? [ref] : [];
  });
}

function firstSelectedCell(): CellPlan | null {
  const first = selectedRefs()[0];
  return first ? cellAt(cur().plan, first) : null;
}

function firstTileForFamily(family: string): string {
  return tilesByFamily.get(family)?.[0] ?? activeTile;
}

function tileFamily(tileId: string | undefined): string {
  return tileId && TILES[tileId] ? TILES[tileId].family : activeFamily;
}

function sample(cell: CellPlan): void {
  if (!cell.tile) return;
  const tile = TILES[cell.tile];
  if (!tile) return;
  activeTile = cell.tile;
  activeFamily = tile.family;
}

export function corpusEditorActive(): boolean {
  return st !== null;
}

export function enterCorpusEdit(plan: BannerPlan, h: CorpusEditorHost): void {
  if (st) exitCorpusEditor(true);
  host = h;
  st = {
    plan: clonePlan(plan),
    selection: new Set(),
    tool: "select",
    history: [],
    future: [],
    dirty: false,
  };
  const firstTileCell = st.plan.cells.find((cell) => cell.kind === "tile" && cell.tile);
  if (firstTileCell) sample(firstTileCell);
  document.body.classList.add("mode-corpus-editor");
  document.addEventListener("keydown", onKey);
  refresh();
}

export function exitCorpusEditor(force = false): void {
  if (!st) return;
  if (st.dirty && !force && !confirm("Discard unsaved edits and exit the corpus editor?"))
    return;
  document.removeEventListener("keydown", onKey);
  document.body.classList.remove("mode-corpus-editor");
  st = null;
  const h = host;
  host = null;
  h?.onExit();
}

export function saveCorpusEditor(): void {
  const s = st;
  if (!s || !host) return;
  host.onSavePlan(clonePlan(s.plan));
  s.dirty = false;
  renderInspector();
}

function pushHistory(s: CorpusEditorState, before: BannerPlan): void {
  s.history.push(before);
  if (s.history.length > UNDO_CAP) s.history.shift();
  s.future = [];
}

function undo(s: CorpusEditorState): boolean {
  const prev = s.history.pop();
  if (!prev) return false;
  s.future.push(clonePlan(s.plan));
  s.plan = prev;
  s.dirty = true;
  pruneSelection(s);
  return true;
}

function redo(s: CorpusEditorState): boolean {
  const next = s.future.pop();
  if (!next) return false;
  s.history.push(clonePlan(s.plan));
  s.plan = next;
  s.dirty = true;
  pruneSelection(s);
  return true;
}

function pruneSelection(s: CorpusEditorState): void {
  for (const key of [...s.selection]) {
    const ref = parseCellKey(key);
    if (!ref || !cellAt(s.plan, ref)) s.selection.delete(key);
  }
}

function applyOp(op: PlanOp): void {
  const s = st;
  if (!s || !host) return;
  const refs = selectedRefs();
  if (!refs.length) {
    host.flash("Select a cell first.", true);
    return;
  }
  const before = clonePlan(s.plan);
  const result = forEachSelected(s.plan, refs, op);
  if (!result.ok) {
    host.flash(result.reason, true);
    refresh();
    return;
  }
  pushHistory(s, before);
  s.dirty = true;
  refresh();
}

function selectCell(ref: CellRef, additive: boolean): void {
  const s = cur();
  const key = cellKey(ref);
  if (additive) s.selection.add(key);
  else {
    s.selection = new Set([key]);
    const cell = cellAt(s.plan, ref);
    if (cell) sample(cell);
  }
  refresh();
}

function renderSelectionRects(plan: BannerPlan, selection: Set<string>): string {
  return [...selection].map((key) => {
    const ref = parseCellKey(key);
    if (!ref || !cellAt(plan, ref)) return "";
    return `<rect class="corpus-editor-selection" x="${ref.col * CELL_PX + 1}" y="${ref.row * CELL_PX + 1}" width="${CELL_PX - 2}" height="${CELL_PX - 2}" fill="none" stroke="${SELECT_STROKE}" stroke-width="2" pointer-events="none"/>`;
  }).join("");
}

function renderHitRects(plan: BannerPlan): string {
  const rects: string[] = [];
  for (let row = 0; row < plan.rows; row += 1) {
    for (let col = 0; col < plan.cols; col += 1) {
      rects.push(`<rect class="corpus-editor-hit" data-node-id="${col},${row}" x="${col * CELL_PX}" y="${row * CELL_PX}" width="${CELL_PX}" height="${CELL_PX}" fill="transparent" pointer-events="all"/>`);
    }
  }
  return rects.join("");
}

function renderEditableSvg(s: CorpusEditorState): string {
  const svg = renderPlanSvg(s.plan, TILES, { nodeIds: true });
  const hits = renderHitRects(s.plan);
  const overlay = renderSelectionRects(s.plan, s.selection);
  return svg.replace("</svg>", `${hits}${overlay}</svg>`);
}

function refreshCanvas(): void {
  const s = st;
  if (!s) return;
  const canvas = $("#canvas");
  canvas.innerHTML = renderEditableSvg(s);
  canvas.onclick = (event) => {
    if ((event.target as Element).closest("[data-node-id]")) return;
    if (!(event as MouseEvent).shiftKey && s.selection.size) {
      s.selection.clear();
      refresh();
    }
  };
  for (const node of canvas.querySelectorAll<SVGElement>("[data-node-id]")) {
    node.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = node.getAttribute("data-node-id");
      const ref = id ? parseCellKey(id) : null;
      if (ref) selectCell(ref, (event as MouseEvent).shiftKey);
    });
  }
}

function makeSwatch(hex: string, selected: boolean, attr: string, fn: () => void): HTMLButtonElement {
  const swatch = el("button", {
    type: "button",
    class: `accent-swatch${selected ? " on" : ""}`,
    [attr]: hex,
    "aria-label": hex,
    "aria-pressed": String(selected),
    title: hex,
  }) as HTMLButtonElement;
  swatch.style.backgroundColor = hex;
  swatch.style.setProperty("--check-color", SMOKE_WHITE_CHECK_HEXES.has(hex) ? "#F3F3F3" : "#121212");
  swatch.addEventListener("click", fn);
  return swatch;
}

function appendSwatches(
  acts: HTMLElement,
  label: string,
  attr: string,
  active: string | undefined,
  fn: (hex: string) => void,
): void {
  // Each fill row takes a full line of the actions strip — eleven 28px swatches
  // can't share a row with the selects without being crushed.
  const line = el("div", { class: "fill-row" });
  line.appendChild(el("span", { class: "sub" }, label));
  const row = el("div", { class: "accent-swatches", role: "group", "aria-label": label });
  for (const hex of FILLS) row.appendChild(makeSwatch(hex, active === hex, attr, () => fn(hex)));
  line.appendChild(row);
  acts.appendChild(line);
}

function renderInspector(): void {
  const s = st;
  if (!s) return;
  const acts = $("#canvas-actions");
  acts.replaceChildren();
  const onErr = (err: unknown) => host?.flash(String(err), true);
  const selected = firstSelectedCell();

  acts.appendChild(button("Exit", "ghost", () => exitCorpusEditor(), onErr, {
    "data-corpus-editor-exit": "",
  }));
  acts.appendChild(button("Save", "primary", () => saveCorpusEditor(), onErr, {
    "data-corpus-editor-save": "",
  }));

  const undoBtn = button("Undo", "", () => {
    if (undo(s)) refresh();
    else host?.flash("Nothing to undo.");
  }, onErr, { "data-corpus-editor-undo": "" });
  if (!s.history.length) undoBtn.setAttribute("disabled", "");
  const redoBtn = button("Redo", "", () => {
    if (redo(s)) refresh();
    else host?.flash("Nothing to redo.");
  }, onErr, { "data-corpus-editor-redo": "" });
  if (!s.future.length) redoBtn.setAttribute("disabled", "");
  acts.append(undoBtn, redoBtn);

  const familySelect = el("select", { "data-corpus-editor-family": "", title: "tile family" }) as HTMLSelectElement;
  for (const family of families) {
    const option = document.createElement("option");
    option.value = family;
    option.textContent = family;
    if (family === activeFamily) option.selected = true;
    familySelect.appendChild(option);
  }
  familySelect.addEventListener("change", () => {
    activeFamily = familySelect.value;
    activeTile = firstTileForFamily(activeFamily);
    renderInspector();
  });
  acts.appendChild(familySelect);

  const tileSelect = el("select", { "data-corpus-editor-tile": "", title: "tile" }) as HTMLSelectElement;
  for (const family of families) {
    const group = document.createElement("optgroup");
    group.label = family;
    for (const id of tilesByFamily.get(family) ?? []) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      if (id === activeTile) option.selected = true;
      group.appendChild(option);
    }
    tileSelect.appendChild(group);
  }
  tileSelect.addEventListener("change", () => {
    activeTile = tileSelect.value;
    activeFamily = tileFamily(activeTile);
    applyOp((plan, ref) => setTile(plan, ref, activeTile));
  });
  acts.appendChild(tileSelect);

  acts.appendChild(button("Rotate", "", () => applyOp(cycleRotation), onErr, {
    "data-corpus-editor-rotate": "",
  }));
  acts.appendChild(button("Flip", "", () => applyOp(toggleFlip), onErr, {
    "data-corpus-editor-flip": "",
  }));
  acts.appendChild(button("Clear", "ghost", () => applyOp(clearToPlain), onErr, {
    "data-corpus-editor-clear": "",
  }));

  appendSwatches(acts, "Ink", "data-corpus-editor-ink", selected?.ink, (hex) => {
    applyOp((plan, ref) => setInk(plan, ref, hex));
  });
  appendSwatches(acts, "Ground", "data-corpus-editor-ground", selected?.ground, (hex) => {
    applyOp((plan, ref) => setGround(plan, ref, hex));
  });
}

function refresh(): void {
  refreshCanvas();
  renderInspector();
}

function onKey(e: KeyboardEvent): void {
  if (!corpusEditorActive()) return;
  const tag = (e.target as HTMLElement)?.tagName;
  if (e.key === "Escape") {
    e.preventDefault();
    exitCorpusEditor();
    return;
  }

  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "z") {
    e.preventDefault();
    const s = cur();
    if (e.shiftKey ? redo(s) : undo(s)) refresh();
    return;
  }
  if (mod && e.key.toLowerCase() === "y") {
    e.preventDefault();
    const s = cur();
    if (redo(s)) refresh();
    return;
  }

  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  switch (e.key.toLowerCase()) {
    case "r":
      e.preventDefault();
      applyOp(cycleRotation);
      break;
    case "f":
      e.preventDefault();
      applyOp(toggleFlip);
      break;
    case "x":
      e.preventDefault();
      applyOp(clearToPlain);
      break;
  }
}
