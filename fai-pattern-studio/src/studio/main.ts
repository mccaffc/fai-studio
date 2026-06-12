/** FAI Pattern Studio — consumes the engine; all DOM code lives on this side. */
import {
  ALL_CATEGORIES,
  defaultConfig,
  describe,
  generate,
  recolor,
  variations,
} from "../engine/index";
import type {
  CategoryId,
  ColorMode,
  Config,
  GenResult,
} from "../engine/types";
import { downloadPng, downloadSvg, copySvg } from "./export";

const info = describe();
const BRAND_SWATCHES: Array<[string, string]> = [
  ["International Orange", "#FF4F00"],
  ["Chrome Yellow", "#FFA300"],
  ["Celestial Blue", "#4997D0"],
  ["Timberwolf", "#D9D9D6"],
  ["Smoke White", "#F3F3F3"],
  ["White", "#FFFFFF"],
  ["Cod Gray", "#121212"],
];

interface SavedItem {
  config: Config;
  seed: number;
}

const state = {
  config: defaultConfig(),
  current: null as GenResult | null,
  vars: [] as GenResult[],
  saved: [] as SavedItem[],
  lockSeed: false,
};
state.config.seed = (Math.random() * 0xffffffff) >>> 0;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

function el(tag: string, attrs: Record<string, string> = {}, html = ""): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

// ── generation ──
function regen(newSeed = false): void {
  if (newSeed && !state.lockSeed) {
    state.config.seed = (Math.random() * 0xffffffff) >>> 0;
  }
  try {
    state.current = generate(state.config);
    state.vars = variations(state.config, 6);
  } catch (err) {
    $("#canvas").innerHTML = `<p style="padding:20px;color:#c00">${String(err)}</p>`;
    return;
  }
  renderCanvas();
  renderVariations();
  renderControls(); // visibility may change with mode
}

function applyRecolor(mode: ColorMode, accent: string | null): void {
  if (!state.current) return;
  state.config.color = { mode, accent, allowProposal: mode === "extended" };
  try {
    state.current = recolor(state.current.scene, state.config.color);
  } catch (err) {
    alert(String(err));
    return;
  }
  renderCanvas();
  renderControls();
}

// ── canvas ──
function renderCanvas(): void {
  if (!state.current) return;
  $("#canvas").innerHTML = state.current.svg;
  const acts = $("#canvas-actions");
  acts.innerHTML = "";
  const mkBtn = (label: string, cls: string, fn: () => void) => {
    const b = el("button", { class: cls }, label);
    b.addEventListener("click", fn);
    acts.appendChild(b);
  };
  mkBtn("Randomize (space)", "primary", () => regen(true));
  mkBtn("Save", "", () => {
    state.saved.push({ config: state.current!.config, seed: state.current!.seed });
    persist();
    renderSaved();
  });
  mkBtn("SVG", "ghost", () => downloadSvg(state.current!));
  mkBtn("PNG 2×", "ghost", () => downloadPng(state.current!));
  mkBtn("Copy SVG", "ghost", () => copySvg(state.current!));
  renderRecolorBar();
}

// ── recolor bar (post-generation re-skin; geometry untouched) ──
function renderRecolorBar(): void {
  const bar = $("#recolor-bar");
  bar.innerHTML = `<span class="label">Recolor</span>`;
  for (const mode of ["duotone", "vertical", "full", "extended"] as ColorMode[]) {
    const b = el(
      "button",
      { class: `chip${state.config.color.mode === mode ? " on" : ""}`, style: "width:auto" },
      mode,
    );
    b.addEventListener("click", () =>
      applyRecolor(mode, mode === "duotone" || mode === "vertical" ? "#FF4F00" : null),
    );
    bar.appendChild(b);
  }
  if (state.current && state.current.scene.palette.ui.accentPicker) {
    for (const [name, hex] of BRAND_SWATCHES.slice(0, 4)) {
      const s = el("button", {
        class: `swatch${state.config.color.accent === hex ? " on" : ""}`,
        style: `background:${hex}`,
        title: name,
      });
      s.addEventListener("click", () => applyRecolor(state.config.color.mode, hex));
      bar.appendChild(s);
    }
  }
}

// ── variations tray ──
function renderVariations(): void {
  const tray = $("#variations");
  tray.innerHTML = "";
  for (const v of state.vars) {
    const t = el("div", { class: "thumb" }, v.svg + `<div class="meta"><span>seed ${v.seed}</span></div>`);
    t.addEventListener("click", () => {
      state.config.seed = v.seed;
      state.current = v;
      renderCanvas();
      state.vars = variations(state.config, 6);
      renderVariations();
      renderControls();
    });
    tray.appendChild(t);
  }
}

// ── save tray ──
function persist(): void {
  localStorage.setItem("fai-pattern-saved", JSON.stringify(state.saved));
}
function renderSaved(): void {
  const tray = $("#saved");
  tray.innerHTML = "";
  state.saved.forEach((item, i) => {
    let r: GenResult;
    try {
      r = generate({ ...item.config, seed: item.seed });
    } catch {
      return;
    }
    const t = el(
      "div",
      { class: "thumb" },
      r.svg +
        `<div class="meta"><span>seed ${item.seed}</span><span>${item.config.color.mode}</span></div>` +
        `<button class="x" title="remove">×</button>`,
    );
    (t.querySelector(".x") as HTMLElement).addEventListener("click", (e) => {
      e.stopPropagation();
      state.saved.splice(i, 1);
      persist();
      renderSaved();
    });
    t.addEventListener("click", () => {
      state.config = { ...item.config };
      state.current = r;
      renderCanvas();
      state.vars = variations(state.config, 6);
      renderVariations();
      renderControls();
    });
    tray.appendChild(t);
  });
}

// ── controls panel ──
function renderControls(): void {
  const c = state.config;
  const root = $("#controls");
  root.innerHTML = "";

  const group = (title: string): HTMLElement => {
    const g = el("div", { class: "group" }, `<h3>${title}</h3>`);
    root.appendChild(g);
    return g;
  };

  // arrangement
  {
    const g = group("Arrangement");
    const sel = el("select") as HTMLSelectElement;
    for (const [key, spec] of Object.entries(info.arrangements)) {
      const o = document.createElement("option");
      o.value = key;
      o.textContent = spec.label;
      if (key === c.arrangement) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      c.arrangement = sel.value as Config["arrangement"];
      c.grid = null;
      regen();
    });
    g.appendChild(sel);
    const varied = el(
      "button",
      { class: `chip${c.varied ? " on" : ""}`, style: "margin-top:8px" },
      "varied grid (merged supercells)",
    );
    varied.addEventListener("click", () => {
      c.varied = !c.varied;
      regen();
    });
    g.appendChild(varied);
  }

  // color mode
  {
    const g = group("Color mode");
    const chips = el("div", { class: "chips" });
    for (const mode of ["duotone", "vertical", "full", "extended"] as ColorMode[]) {
      const chip = el("button", { class: `chip${c.color.mode === mode ? " on" : ""}` }, mode);
      chip.addEventListener("click", () => {
        // mode switch fully resets color state — nothing leaks
        c.color = {
          mode,
          accent: mode === "duotone" || mode === "vertical" ? "#FF4F00" : null,
          allowProposal: mode === "extended",
        };
        regen();
      });
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    if (state.current?.scene.palette.ui.accentPicker) {
      const sw = el("div", { class: "swatches", style: "margin-top:8px" });
      for (const [name, hex] of BRAND_SWATCHES.slice(0, 4)) {
        const s = el("button", {
          class: `swatch${c.color.accent === hex ? " on" : ""}`,
          style: `background:${hex}`,
          title: name,
        });
        s.addEventListener("click", () => {
          c.color.accent = hex;
          regen();
        });
        sw.appendChild(s);
      }
      g.appendChild(sw);
      if (state.current.scene.palette.ui.customHex) {
        const inp = el("input", {
          type: "text",
          placeholder: "#268B41 (proposal hex)",
          style: "margin-top:8px",
        }) as HTMLInputElement;
        inp.value = c.color.accent && !BRAND_SWATCHES.some(([, h]) => h === c.color.accent) ? c.color.accent : "";
        inp.addEventListener("change", () => {
          const v = inp.value.trim().toUpperCase();
          if (/^#[0-9A-F]{6}$/.test(v)) {
            c.color = { mode: "vertical", accent: v, allowProposal: true };
            regen();
          }
        });
        g.appendChild(inp);
      }
    }
  }

  // shape families
  {
    const g = group("Shape families");
    const chips = el("div", { class: "chips" });
    for (const cat of ALL_CATEGORIES) {
      const on = c.categories.includes(cat);
      const chip = el("button", { class: `chip${on ? " on" : ""}` }, info.categories[cat].label);
      chip.addEventListener("click", () => {
        const next = on ? c.categories.filter((x) => x !== cat) : [...c.categories, cat];
        if (next.length === 0) return; // ≥1 family
        c.categories = next as CategoryId[];
        regen();
      });
      chips.appendChild(chip);
    }
    g.appendChild(chips);
  }

  // composition
  {
    const g = group("Composition");
    const dens = el("div", { class: "row" }, `<label>Density</label>`);
    const slider = el("input", {
      type: "range", min: "0", max: "100", value: String(Math.round(c.density * 100)),
    }) as HTMLInputElement;
    slider.addEventListener("change", () => {
      c.density = Number(slider.value) / 100;
      regen();
    });
    dens.appendChild(slider);
    g.appendChild(dens);
    const sym = el("select") as HTMLSelectElement;
    for (const v of ["auto", "mirror", "none"]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = `symmetry: ${v}`;
      if (v === c.symmetry) o.selected = true;
      sym.appendChild(o);
    }
    sym.addEventListener("change", () => {
      c.symmetry = sym.value as Config["symmetry"];
      regen();
    });
    sym.style.marginTop = "8px";
    g.appendChild(sym);
  }

  // seed
  {
    const g = group("Seed");
    const row = el("div", { class: "seed-row" });
    const inp = el("input", { type: "text", inputmode: "numeric" }) as HTMLInputElement;
    inp.value = String(c.seed);
    inp.addEventListener("change", () => {
      const n = Number(inp.value);
      if (Number.isFinite(n)) {
        c.seed = n >>> 0;
        regen();
      }
    });
    const lock = el(
      "button",
      { class: `chip lock${state.lockSeed ? " on" : ""}`, title: "lock seed" },
      "🔒",
    );
    lock.addEventListener("click", () => {
      state.lockSeed = !state.lockSeed;
      renderControls();
    });
    row.appendChild(inp);
    row.appendChild(lock);
    g.appendChild(row);
  }
}

// ── boot ──
document.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  e.preventDefault();
  regen(true);
});

try {
  state.saved = JSON.parse(localStorage.getItem("fai-pattern-saved") ?? "[]");
} catch {
  state.saved = [];
}
regen();
renderSaved();
