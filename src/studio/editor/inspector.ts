/** Editor inspector — the sidebar (#controls): tool switch, the "active"
 *  shape/color/background (sampled from the selected tile), bulk transforms for
 *  the selection, and canvas controls. */
import {
  ALL_CATEGORIES,
  byCategory,
  CATEGORY_META,
  renderSvg,
} from "../../engine/index";
import type { CategoryId, Scene, SceneNode } from "../../engine/types";
import { el } from "./dom";
import { gridDims, nodeSpan, thumbScene } from "./scene-ops";
import type { PendingShape, Tool } from "./state";

/** Brand swatches (name + hex), mirrors the generate-mode palette. */
export const BRAND_SWATCHES: ReadonlyArray<[string, string]> = [
  ["International Orange", "#FF4F00"],
  ["Celestial Blue", "#4997D0"],
  ["Chrome Yellow", "#FFA300"],
  ["Electric Violet", "#8265DB"],
  ["Deep Teal", "#0E8C88"],
  ["Signal Green", "#268B41"],
  ["Frontier Indigo", "#3A4A6B"],
  ["Smoke White", "#F3F3F3"],
  ["Cod Gray", "#121212"],
  ["Timberwolf", "#D9D9D6"],
];

const EDITOR_GRIDS: ReadonlyArray<{ label: string; cols: number; rows: number }> = [
  { label: "Banner · 6×3", cols: 6, rows: 3 },
  { label: "Square · 6×6", cols: 6, rows: 6 },
  { label: "Strip · 3×1", cols: 3, rows: 1 },
  { label: "Column · 1×3", cols: 1, rows: 3 },
  { label: "Landscape · 3×2", cols: 3, rows: 2 },
  { label: "Portrait · 2×3", cols: 2, rows: 3 },
  { label: "Grid · 4×4", cols: 4, rows: 4 },
];

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export interface InspectorCtx {
  scene: Scene;
  tool: Tool;
  selection: SceneNode[];
  activeShape: PendingShape | null;
  activeColor: string;
  activeGround: string | null;
  activeFamily: CategoryId;
  multiAdd: boolean;
  setTool(t: Tool): void;
  toggleMultiAdd(): void;
  setFamily(cat: CategoryId): void;
  setActiveShape(key: string, cat: CategoryId): void;
  setActiveColor(hex: string): void;
  setActiveGround(hex: string | null): void;
  rotate(): void;
  flip(): void;
  merge(): void;
  split(): void;
  duplicate(): void;
  remove(): void;
  setGrid(cols: number, rows: number): void;
  setPageBackground(hex: string): void;
}

const eq = (a: string | null, b: string | null) =>
  (a ?? "").toUpperCase() === (b ?? "").toUpperCase();

export function renderInspector(root: HTMLElement, ctx: InspectorCtx): void {
  root.replaceChildren();
  const sel = ctx.selection;
  const one = sel.length === 1 ? sel[0]! : null;

  const group = (title: string): HTMLElement => {
    const g = el("div", { class: "group" }, `<h3>${title}</h3>`);
    root.appendChild(g);
    return g;
  };

  // ── Tool ──
  {
    const g = group("Tool");
    const chips = el("div", { class: "chips" });
    for (const t of ["select", "paint"] as Tool[]) {
      const chip = el(
        "button",
        {
          class: `chip${ctx.tool === t ? " on" : ""}`,
          title: t === "select" ? "Select tool (V)" : "Paint tool (B)",
        },
        t === "select" ? "Select" : "Paint",
      );
      chip.addEventListener("click", () => ctx.setTool(t));
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    if (ctx.tool === "select") {
      const multi = el(
        "button",
        { class: `chip${ctx.multiAdd ? " on" : ""}`, style: "margin-top:8px" },
        "＋ add to selection",
      );
      multi.addEventListener("click", () => ctx.toggleMultiAdd());
      g.appendChild(multi);
      hint(
        g,
        ctx.multiAdd
          ? "Taps add/remove tiles. Drag a tile to move it."
          : "Tap a tile to edit · Shift-tap to multi-select · drag to move.",
      );
    } else {
      hint(g, "Drag across cells to fill them with the active shape & colors.");
    }
  }

  // ── Active shape + colors ──
  {
    const label =
      ctx.tool === "paint"
        ? "Paint with"
        : sel.length > 1
          ? `Editing ${sel.length} tiles`
          : one
            ? "Editing tile"
            : "Active";
    const g = group(label);

    const tabs = el("div", { class: "chips" });
    for (const cat of ALL_CATEGORIES) {
      const on = cat === ctx.activeFamily;
      const chip = el(
        "button",
        { class: `chip${on ? " on" : ""}` },
        CATEGORY_META[cat].label.replace(/[ ,].*$/, ""),
      );
      chip.addEventListener("click", () => ctx.setFamily(cat));
      tabs.appendChild(chip);
    }
    g.appendChild(tabs);

    const grid = el("div", { class: "ed-thumbs" });
    const activeKey = ctx.activeShape?.key;
    for (const def of byCategory(ctx.activeFamily)) {
      const on = def.key === activeKey;
      const t = el(
        "button",
        { class: `ed-thumb${on ? " on" : ""}`, title: def.key },
        renderSvg(thumbScene(def.key, def.category, "#F3F3F3", "#121212")),
      );
      t.addEventListener("click", () => ctx.setActiveShape(def.key, def.category));
      grid.appendChild(t);
    }
    g.appendChild(grid);

    g.appendChild(el("div", { class: "ed-sublabel" }, "Fill color"));
    g.appendChild(swatchRow((hex) => ctx.setActiveColor(hex), ctx.activeColor));
    g.appendChild(customHex("custom hex #FF4F00", (hex) => ctx.setActiveColor(hex)));

    g.appendChild(el("div", { class: "ed-sublabel" }, "Background block"));
    const bg = swatchRow((hex) => ctx.setActiveGround(hex), ctx.activeGround);
    const none = el(
      "button",
      { class: `chip${ctx.activeGround === null ? " on" : ""}`, style: "margin-top:6px" },
      "no block",
    );
    none.addEventListener("click", () => ctx.setActiveGround(null));
    g.append(bg, none);
  }

  // ── Selected-tile transforms (select tool) ──
  if (ctx.tool === "select" && sel.length) {
    const g = group(one ? `Tile · ${one.primitive}${one.flip ? " ⇄" : ""}` : `${sel.length} tiles`);
    const chips = el("div", { class: "chips" });
    const rot = el("button", { class: "chip", title: "Rotate 90° (R)" }, "Rotate 90° ⟳");
    rot.addEventListener("click", () => ctx.rotate());
    const flip = el("button", { class: "chip", title: "Flip (F)" }, "Flip ⇄");
    flip.addEventListener("click", () => ctx.flip());
    chips.append(rot, flip);

    if (one && nodeSpan(one) === 1) {
      const merge = el("button", { class: "chip", title: "Merge 2×2 (M)" }, "Merge 2×2 ▦");
      merge.addEventListener("click", () => ctx.merge());
      chips.appendChild(merge);
    } else if (one) {
      const split = el("button", { class: "chip", title: "Split (M)" }, "Split ▢▢");
      split.addEventListener("click", () => ctx.split());
      chips.appendChild(split);
    }
    if (one) {
      const dup = el("button", { class: "chip", title: "Duplicate (D)" }, "Duplicate");
      dup.addEventListener("click", () => ctx.duplicate());
      chips.appendChild(dup);
    }
    const del = el(
      "button",
      { class: "chip danger", title: "Delete (⌫)" },
      `Delete${sel.length > 1 ? ` ${sel.length}` : ""} ✕`,
    );
    del.addEventListener("click", () => ctx.remove());
    chips.appendChild(del);
    g.appendChild(chips);
    if (one) hint(g, `Orientation: ${one.rot}°`);
  }

  // ── Canvas ──
  {
    const g = group("Canvas");
    const { cols, rows } = gridDims(ctx.scene);
    const matched = EDITOR_GRIDS.find((p) => p.cols === cols && p.rows === rows);
    const presets = el("select") as HTMLSelectElement;
    if (!matched) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = `Custom · ${cols}×${rows}`;
      o.selected = true;
      presets.appendChild(o);
    }
    for (const pset of EDITOR_GRIDS) {
      const o = document.createElement("option");
      o.value = `${pset.cols}x${pset.rows}`;
      o.textContent = pset.label;
      if (matched === pset) o.selected = true;
      presets.appendChild(o);
    }
    presets.addEventListener("change", () => {
      const m = /^(\d+)x(\d+)$/.exec(presets.value);
      if (m) ctx.setGrid(Number(m[1]), Number(m[2]));
    });
    g.appendChild(presets);

    g.appendChild(el("div", { class: "ed-sublabel" }, "Custom size"));
    const dims = el("div", { class: "ed-dims" });
    dims.append(
      labeled("cols", numInput(cols, (v) => ctx.setGrid(v, gridDims(ctx.scene).rows))),
      labeled("rows", numInput(rows, (v) => ctx.setGrid(gridDims(ctx.scene).cols, v))),
    );
    g.appendChild(dims);

    g.appendChild(el("div", { class: "ed-sublabel" }, "Page background"));
    g.appendChild(swatchRow((hex) => ctx.setPageBackground(hex), ctx.scene.ground));
    g.appendChild(customHex("custom hex #121212", (hex) => ctx.setPageBackground(hex)));
  }
}

// ── builders ──

function swatchRow(onPick: (hex: string) => void, active: string | null): HTMLElement {
  const wrap = el("div", { class: "swatches" });
  for (const [name, hex] of BRAND_SWATCHES) {
    const s = el("button", {
      class: `swatch${eq(hex, active) ? " on" : ""}`,
      style: `background:${hex}`,
      title: name,
    });
    s.addEventListener("click", () => onPick(hex));
    wrap.appendChild(s);
  }
  return wrap;
}

function customHex(placeholder: string, onPick: (hex: string) => void): HTMLElement {
  const inp = el("input", { type: "text", placeholder, style: "margin-top:8px" }) as HTMLInputElement;
  inp.addEventListener("change", () => {
    const v = inp.value.trim().toUpperCase();
    if (HEX_RE.test(v)) onPick(v);
  });
  return inp;
}

function numInput(value: number, onChange: (v: number) => void): HTMLInputElement {
  const inp = el("input", { type: "number", min: "1", max: "12", value: String(value) }) as HTMLInputElement;
  inp.addEventListener("change", () => {
    const v = Math.max(1, Math.min(12, Math.round(Number(inp.value))));
    if (Number.isFinite(v)) onChange(v);
  });
  return inp;
}

function labeled(label: string, control: HTMLElement): HTMLElement {
  const w = el("label", { class: "ed-field" }, `<span>${label}</span>`);
  w.appendChild(control);
  return w;
}

function hint(g: HTMLElement, msg: string): void {
  g.appendChild(el("p", { class: "ed-hint" }, msg));
}
