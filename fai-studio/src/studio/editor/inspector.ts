/** Editor inspector — the sidebar (#controls) UI: shape picker, rotation, flip,
 *  color, per-cell ground, merge/split, duplicate/delete, and canvas controls. */
import {
  ALL_CATEGORIES,
  byCategory,
  CATEGORY_META,
  describe,
  renderSvg,
} from "../../engine/index";
import type { CategoryId, Scene, SceneNode } from "../../engine/types";
import { el } from "./dom";
import { gridDims, nodeSpan, thumbScene } from "./scene-ops";
import type { PendingShape } from "./state";

/** Brand swatches (name + hex), mirrors the generate-mode palette. */
export const BRAND_SWATCHES: ReadonlyArray<[string, string]> = [
  ["International Orange", "#FF4F00"],
  ["Celestial Blue", "#4997D0"],
  ["Chrome Yellow", "#FFA300"],
  ["Electric Violet", "#8265DB"],
  ["Telemagenta", "#D63A8C"],
  ["Signal Green", "#268B41"],
  ["Frontier Indigo", "#3A4A6B"],
  ["Smoke White", "#F3F3F3"],
  ["Cod Gray", "#121212"],
  ["Timberwolf", "#D9D9D6"],
];

export interface InspectorCtx {
  scene: Scene;
  selection: SceneNode | null;
  pending: PendingShape | null;
  activeFamily: CategoryId;
  setFamily(cat: CategoryId): void;
  pickPrimitive(key: string, category: CategoryId): void;
  rotate(): void;
  flip(): void;
  setColor(hex: string): void;
  setGround(hex: string | null): void;
  setPageBackground(hex: string): void;
  merge(): void;
  split(): void;
  duplicate(): void;
  remove(): void;
  setGrid(cols: number, rows: number): void;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function renderInspector(root: HTMLElement, ctx: InspectorCtx): void {
  root.replaceChildren();
  const sel = ctx.selection;

  const group = (title: string): HTMLElement => {
    const g = el("div", { class: "group" }, `<h3>${title}</h3>`);
    root.appendChild(g);
    return g;
  };

  // ── Shape picker (sets pending; applies to the selected tile if one is selected) ──
  {
    const g = group(sel ? "Shape · selected tile" : "Add shape");
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
    const activeKey = sel ? sel.primitive : ctx.pending?.key;
    for (const def of byCategory(ctx.activeFamily)) {
      const on = def.key === activeKey;
      const t = el(
        "button",
        { class: `ed-thumb${on ? " on" : ""}`, title: def.key },
        renderSvg(thumbScene(def.key, def.category, "#F3F3F3", "#121212")),
      );
      t.addEventListener("click", () => ctx.pickPrimitive(def.key, def.category));
      grid.appendChild(t);
    }
    g.appendChild(grid);
  }

  // ── Selected-tile transforms ──
  {
    const g = group("Transform");
    const row = el("div", { class: "chips" });
    const rot = el(
      "button",
      { class: "chip", title: "rotate 90°" },
      `Rotate ⟳${sel ? ` · ${sel.rot}°` : ""}`,
    );
    rot.addEventListener("click", () => ctx.rotate());
    const flip = el(
      "button",
      { class: `chip${sel?.flip ? " on" : ""}` },
      "Flip ⇄",
    );
    flip.addEventListener("click", () => ctx.flip());
    row.append(rot, flip);
    g.appendChild(row);
    if (!sel) hint(g, "Select a tile to transform it.");
  }

  // ── Color ──
  {
    const g = group("Tile color");
    g.appendChild(swatchRow(ctx.scene, (hex) => ctx.setColor(hex)));
    g.appendChild(customHex("custom hex #FF4F00", (hex) => ctx.setColor(hex)));
    if (!sel) hint(g, "Select a tile to recolor it.");
  }

  // ── Per-cell ground block ──
  {
    const g = group("Tile background block");
    const swatches = swatchRow(ctx.scene, (hex) => ctx.setGround(hex));
    const none = el("button", { class: "chip", style: "margin-top:8px" }, "no block");
    none.addEventListener("click", () => ctx.setGround(null));
    g.append(swatches, none);
    if (!sel) hint(g, "Select a tile to set a ground block.");
  }

  // ── Arrange (merge/split/duplicate/delete) ──
  if (sel) {
    const g = group("Arrange tile");
    const chips = el("div", { class: "chips" });
    const span = nodeSpan(sel);
    if (span === 1) {
      const merge = el("button", { class: "chip" }, "Merge 2×2 ▦");
      merge.addEventListener("click", () => ctx.merge());
      chips.appendChild(merge);
    } else {
      const split = el("button", { class: "chip" }, "Split ▢▢");
      split.addEventListener("click", () => ctx.split());
      chips.appendChild(split);
    }
    const dup = el("button", { class: "chip" }, "Duplicate");
    dup.addEventListener("click", () => ctx.duplicate());
    const del = el("button", { class: "chip danger" }, "Delete ✕");
    del.addEventListener("click", () => ctx.remove());
    chips.append(dup, del);
    g.appendChild(chips);
  }

  // ── Canvas (grid size + page background) ──
  {
    const g = group("Canvas");
    const { cols, rows } = gridDims(ctx.scene);
    const presets = el("select") as HTMLSelectElement;
    const info = describe();
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = `Grid · ${cols}×${rows}`;
    presets.appendChild(ph);
    for (const [key, spec] of Object.entries(info.arrangements)) {
      const o = document.createElement("option");
      o.value = `${spec.cols}x${spec.rows}`;
      o.textContent = spec.label;
      presets.appendChild(o);
    }
    presets.addEventListener("change", () => {
      const m = /^(\d+)x(\d+)$/.exec(presets.value);
      if (m) ctx.setGrid(Number(m[1]), Number(m[2]));
    });
    g.appendChild(presets);

    const dims = el("div", { class: "ed-dims" });
    const colsI = numInput(cols, (v) => ctx.setGrid(v, gridDims(ctx.scene).rows));
    const rowsI = numInput(rows, (v) => ctx.setGrid(gridDims(ctx.scene).cols, v));
    dims.append(labeled("cols", colsI), labeled("rows", rowsI));
    g.appendChild(dims);

    const bgLabel = el("div", { class: "ed-sublabel" }, "Page background");
    g.appendChild(bgLabel);
    g.appendChild(swatchRow(ctx.scene, (hex) => ctx.setPageBackground(hex)));
    g.appendChild(customHex("custom hex #121212", (hex) => ctx.setPageBackground(hex)));
  }
}

// ── small builders ──

function swatchRow(scene: Scene, onPick: (hex: string) => void): HTMLElement {
  const wrap = el("div", { class: "swatches" });
  for (const [name, hex] of BRAND_SWATCHES) {
    const s = el("button", {
      class: "swatch",
      style: `background:${hex}`,
      title: name,
    });
    s.addEventListener("click", () => onPick(hex));
    wrap.appendChild(s);
  }
  return wrap;
}

function customHex(placeholder: string, onPick: (hex: string) => void): HTMLElement {
  const inp = el("input", {
    type: "text",
    placeholder,
    style: "margin-top:8px",
  }) as HTMLInputElement;
  inp.addEventListener("change", () => {
    const v = inp.value.trim().toUpperCase();
    if (HEX_RE.test(v)) onPick(v);
  });
  return inp;
}

function numInput(value: number, onChange: (v: number) => void): HTMLInputElement {
  const inp = el("input", {
    type: "number",
    min: "1",
    max: "12",
    value: String(value),
  }) as HTMLInputElement;
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
