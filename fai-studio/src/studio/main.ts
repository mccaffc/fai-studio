/** FAI Pattern Studio — consumes the engine; all DOM code lives on this side. */
import {
  ALL_CATEGORIES,
  defaultConfig,
  describe,
  generate,
  recolor,
  renderSvg,
  variations,
} from "../engine/index";
import type {
  CategoryId,
  ColorMode,
  Config,
  GenResult,
  Scene,
} from "../engine/types";
import { downloadPng, downloadSvg, copySvg, finalSvg } from "./export";
import { PROGRAMS, applyProgram } from "./programs";
import {
  editorActive,
  enterEdit,
  enterFreeform,
  initEditor,
  openScene,
} from "./editor/index";

const info = describe();
const SWATCHES: Array<[string, string]> = [
  ["International Orange", "#FF4F00"],
  ["Celestial Blue", "#4997D0"],
  ["Chrome Yellow", "#FFA300"],
  ["Electric Violet", "#8265DB"],
  ["Telemagenta", "#D63A8C"],
  ["Signal Green", "#268B41"],
  ["Frontier Indigo", "#3A4A6B"],
  ["Timberwolf", "#D9D9D6"],
];
const MODE_LABELS: Record<ColorMode, string> = {
  duotone: "B&W",
  vertical: "One accent",
  full: "Full color",
};

/** Generated items reproduce from config+seed; scene items are hand-edited or
 *  freeform and carry a full self-contained scene snapshot. */
type SavedItem =
  | { kind: "generated"; config: Config; seed: number }
  | { kind: "scene"; v: 1; scene: Scene };

const state = {
  config: defaultConfig(),
  current: null as GenResult | null,
  vars: [] as GenResult[],
  saved: [] as SavedItem[],
  lockSeed: false,
  /** print-safe export: boolean-merge to interlocking one-path-per-color */
  flatten: true,
};
state.config.seed = (Math.random() * 0xffffffff) >>> 0;

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;

function el(tag: string, attrs: Record<string, string> = {}, html = ""): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

// ── generation (geometry changes) ──
function regen(newSeed = false): void {
  if (editorActive()) return; // editor owns the canvas/controls while open
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
  renderControls();
}

// ── recolor in place (color changes never re-roll geometry) ──
function recolorInPlace(): void {
  if (!state.current) return;
  try {
    state.current = recolor(state.current.scene, state.config.color);
    state.vars = state.vars.map((v) => recolor(v.scene, state.config.color));
  } catch (err) {
    alert(String(err));
    return;
  }
  renderCanvas();
  renderVariations();
  renderControls();
}

// ── action feedback ──
let flashTimer: number | undefined;
function flash(msg: string, isError = false): void {
  const s = $("#action-status");
  s.textContent = msg;
  s.style.color = isError ? "#c00" : "#666";
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    s.textContent = "";
  }, 4000);
}

// ── canvas ──
let flatToken = 0;
function renderCanvas(): void {
  if (!state.current) return;
  const cur = state.current;
  $("#canvas").innerHTML = cur.svg;
  const acts = $("#canvas-actions");
  acts.innerHTML = "";
  const mkBtn = (label: string, cls: string, fn: () => void | Promise<void>) => {
    const b = el("button", { class: cls }, label);
    b.addEventListener("click", () => {
      Promise.resolve(fn()).catch((err) => flash(String(err), true));
    });
    acts.appendChild(b);
  };
  mkBtn("Randomize", "primary", () => regen(true));
  mkBtn("Edit this ✎", "", () => {
    if (state.current) enterEdit(state.current.scene);
  });
  mkBtn("Freeform ＋", "", () => enterFreeform(state.config));
  mkBtn("Save", "", () => {
    state.saved.push({
      kind: "generated",
      config: state.current!.config,
      seed: state.current!.seed,
    });
    persist();
    renderSaved();
    flash("Saved to the tray below.");
  });
  mkBtn("SVG", "ghost", async () => {
    await downloadSvg(state.current!, state.flatten);
    flash(`SVG${state.flatten ? " (flattened)" : ""} saved to your browser's Downloads folder.`);
  });
  mkBtn("PNG 2×", "ghost", async () => {
    await downloadPng(state.current!, state.flatten);
    flash(`PNG${state.flatten ? " (flattened)" : ""} saved to your browser's Downloads folder.`);
  });
  mkBtn("Copy SVG", "ghost", async () => {
    await copySvg(state.current!, state.flatten);
    flash(`SVG${state.flatten ? " (flattened)" : ""} copied to clipboard ✓`);
  });
  const flat = el(
    "button",
    {
      class: `chip${state.flatten ? " on" : ""}`,
      title: "merge shapes into interlocking one-path-per-color (no seams in PDF/print)",
      style: "width:auto",
    },
    "flatten: print-safe",
  );
  flat.addEventListener("click", () => {
    state.flatten = !state.flatten;
    renderCanvas();
  });
  acts.appendChild(flat);
  // WYSIWYG: with print-safe flatten on, the export re-renders seam-guard-free
  // and boolean-merges, so it differs slightly from the raw preview. Swap the
  // canvas to the exact exported SVG (async; guarded so a stale flatten can't
  // overwrite a newer banner).
  if (state.flatten) {
    const token = ++flatToken;
    finalSvg(cur, true)
      .then((svg) => {
        if (token === flatToken && state.current === cur) $("#canvas").innerHTML = svg;
      })
      .catch(() => {});
  }
}

// ── variations tray ──
function renderVariations(): void {
  const tray = $("#variations");
  tray.innerHTML = "";
  for (const v of state.vars) {
    const t = el(
      "div",
      { class: "thumb" },
      v.svg + `<div class="meta"><span>seed ${v.seed}</span></div>`,
    );
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
    let svg: string;
    let metaLeft: string;
    let metaRight: string;
    let onOpen: () => void;
    try {
      if (item.kind === "scene") {
        svg = renderSvg(item.scene);
        metaLeft = "scene";
        metaRight = item.scene.nodes.length === 0 ? "empty" : "edited";
        onOpen = () => openScene(item.scene); // re-opens into the editor (cloned)
      } else {
        const r = generate({ ...item.config, seed: item.seed });
        svg = r.svg;
        metaLeft = `seed ${item.seed}`;
        metaRight = MODE_LABELS[r.config.color.mode] ?? r.config.color.mode;
        onOpen = () => {
          state.config = { ...r.config };
          state.current = r;
          renderCanvas();
          state.vars = variations(state.config, 6);
          renderVariations();
          renderControls();
        };
      }
    } catch {
      return;
    }
    const t = el(
      "div",
      { class: "thumb" },
      svg +
        `<div class="meta"><span>${metaLeft}</span><span>${metaRight}</span></div>` +
        `<button class="x" title="remove">×</button>`,
    );
    (t.querySelector(".x") as HTMLElement).addEventListener("click", (e) => {
      e.stopPropagation();
      state.saved.splice(i, 1);
      persist();
      renderSaved();
    });
    t.addEventListener("click", onOpen);
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

  // program quick-select — sets shape family + accent + One-accent mode at once
  {
    const g = group("Program");
    const sel = el("select") as HTMLSelectElement;
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "Pick a program…";
    sel.appendChild(ph);
    // reflect the current config as a selected program when it matches a preset
    let activeId = "";
    for (const program of PROGRAMS) {
      const settings = applyProgram(program.id)!;
      const o = document.createElement("option");
      o.value = program.id;
      o.textContent = program.label;
      const sameCats =
        settings.categories.length === c.categories.length &&
        settings.categories.every((x) => c.categories.includes(x));
      if (
        sameCats &&
        c.color.mode === "vertical" &&
        c.color.accent === settings.color.accent
      ) {
        o.selected = true;
        activeId = program.id;
      }
      sel.appendChild(o);
    }
    if (!activeId) ph.selected = true;
    sel.addEventListener("change", () => {
      const settings = applyProgram(sel.value);
      if (!settings) return;
      c.categories = settings.categories;
      c.color = { mode: settings.color.mode, accent: settings.color.accent };
      regen();
    });
    g.appendChild(sel);
  }

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

  // color — the ONE color menu; changes recolor the current design in place
  {
    const g = group("Color");
    const chips = el("div", { class: "chips" });
    for (const mode of ["duotone", "vertical", "full"] as ColorMode[]) {
      const chip = el(
        "button",
        { class: `chip${c.color.mode === mode ? " on" : ""}` },
        MODE_LABELS[mode],
      );
      chip.addEventListener("click", () => {
        // mode switch fully resets color state — nothing leaks
        c.color = { mode, accent: mode === "vertical" ? "#FF4F00" : null };
        recolorInPlace();
      });
      chips.appendChild(chip);
    }
    g.appendChild(chips);
    if (c.color.mode === "vertical") {
      const sw = el("div", { class: "swatches", style: "margin-top:8px" });
      for (const [name, hex] of SWATCHES) {
        const s = el("button", {
          class: `swatch${c.color.accent === hex ? " on" : ""}`,
          style: `background:${hex}`,
          title: name,
        });
        s.addEventListener("click", () => {
          c.color.accent = hex;
          recolorInPlace();
        });
        sw.appendChild(s);
      }
      g.appendChild(sw);
      const inp = el("input", {
        type: "text",
        placeholder: "custom hex #268B41",
        style: "margin-top:8px",
      }) as HTMLInputElement;
      inp.value =
        c.color.accent && !SWATCHES.some(([, h]) => h === c.color.accent)
          ? c.color.accent
          : "";
      inp.addEventListener("change", () => {
        const v = inp.value.trim().toUpperCase();
        if (/^#[0-9A-F]{6}$/.test(v)) {
          c.color.accent = v;
          recolorInPlace();
        }
      });
      g.appendChild(inp);
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
  if (editorActive()) return; // spacebar-reroll is disabled while editing
  const tag = (e.target as HTMLElement).tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  e.preventDefault();
  regen(true);
});

// hand off canvas/controls to the editor when it's open; it reports back here
initEditor({
  flash,
  onExit: () => {
    if (state.current) {
      renderCanvas();
      renderControls();
      renderVariations();
    } else {
      regen();
    }
  },
  onSaveScene: (scene) => {
    state.saved.push({ kind: "scene", v: 1, scene });
    persist();
    renderSaved();
    flash("Saved to the tray below.");
  },
});

try {
  const raw = JSON.parse(localStorage.getItem("fai-pattern-saved") ?? "[]") as unknown[];
  const migrated: SavedItem[] = [];
  for (const entry of raw) {
    const item = entry as Record<string, unknown>;
    if (item?.kind === "scene" && item.scene) {
      migrated.push({ kind: "scene", v: 1, scene: item.scene as Scene });
      continue;
    }
    // generated or legacy (no kind): normalize retired color modes
    const config = (item?.config ?? null) as Config | null;
    if (!config || typeof item?.seed !== "number") continue;
    const m = config.color?.mode as string;
    if (m !== "duotone" && m !== "vertical" && m !== "full") {
      config.color = { mode: "full", accent: null };
    }
    migrated.push({ kind: "generated", config, seed: item.seed as number });
  }
  state.saved = migrated;
} catch {
  state.saved = [];
}
regen();
renderSaved();
