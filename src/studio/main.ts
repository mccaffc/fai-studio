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
import type { CorpusSaveConfig } from "./corpus-mode";
// corpusKeydown type is the same CorpusMod — we get it from the cached module reference

// ── corpus-mode dynamic import ──
// corpus-mode.ts bundles ~56 KB gzip of baked grammar data; classic-only users
// should never pay that cost. We lazy-load it on first corpus activation.
type CorpusMod = typeof import("./corpus-mode");
let _corpusModPromise: Promise<CorpusMod> | null = null;
let _corpusMod: CorpusMod | null = null; // set once promise resolves

function getCorpusMod(): Promise<CorpusMod> {
  if (!_corpusModPromise) {
    _corpusModPromise = import("./corpus-mode").then((mod) => {
      _corpusMod = mod;
      return mod;
    });
  }
  return _corpusModPromise;
}

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
 *  freeform and carry a full self-contained scene snapshot. Corpus items store
 *  config+seed and re-generate deterministically (tiny storage). */
type SavedItem =
  | { kind: "generated"; config: Config; seed: number }
  | { kind: "scene"; v: 1; scene: Scene }
  | { kind: "corpus"; config: CorpusSaveConfig; seed: number };

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

// ── studio mode (corpus | classic) ──
type StudioMode = "corpus" | "classic";
const LS_MODE_KEY = "fai-studio-mode";
// Fall back to classic if the corpus panel mount point isn't in the DOM
// (this keeps older test skeletons working without modification).
const _corpusMountPresent = !!document.getElementById("corpus-controls");
let studioMode: StudioMode = _corpusMountPresent
  ? ((localStorage.getItem(LS_MODE_KEY) as StudioMode | null) ?? "corpus")
  : "classic";

function applyModeVisibility(): void {
  const classicAside = $("#controls");
  const corpusAside = $("#corpus-controls");
  const savedEl = $("#saved");
  const savedHeading = document.getElementById("saved-heading");
  const scoresEl = $("#corpus-scores");

  if (studioMode === "corpus") {
    if (classicAside) classicAside.style.display = "none";
    if (corpusAside) corpusAside.style.display = "";
    // Show the saved tray in corpus mode so corpus items are accessible.
    if (savedEl) savedEl.style.display = "";
    if (savedHeading) savedHeading.style.display = "";
    if (scoresEl) scoresEl.style.display = "";
  } else {
    if (classicAside) classicAside.style.display = "";
    if (corpusAside) corpusAside.style.display = "none";
    if (savedEl) savedEl.style.display = "";
    if (savedHeading) savedHeading.style.display = "";
    if (scoresEl) scoresEl.style.display = "none";
  }
}

function switchMode(mode: StudioMode): void {
  studioMode = mode;
  localStorage.setItem(LS_MODE_KEY, mode);
  applyModeVisibility();
  renderModeToggle();

  if (mode === "corpus") {
    // If module already loaded, switch synchronously (no flicker).
    // Otherwise show loading state and await the dynamic import.
    if (_corpusMod) {
      _corpusMod.unmountCorpusMode();
      _corpusMod.mountCorpusMode({ flash, onSave: saveCorpusItem });
    } else {
      const canvas = document.getElementById("canvas");
      if (canvas) canvas.innerHTML = `<p style="padding:20px;color:#666">Loading…</p>`;
      getCorpusMod().then((mod) => {
        mod.unmountCorpusMode();
        mod.mountCorpusMode({ flash, onSave: saveCorpusItem });
      }).catch((err) => flash(String(err), true));
    }
  } else {
    if (_corpusMod) _corpusMod.unmountCorpusMode();
    // ensure classic canvas is current
    if (state.current) {
      renderCanvas();
      renderControls();
      renderVariations();
    } else {
      regen();
    }
    renderSaved();
  }
}

function renderModeToggle(): void {
  const toggle = $("#mode-toggle");
  if (!toggle) return;
  toggle.innerHTML = "";

  for (const mode of ["corpus", "classic"] as StudioMode[]) {
    const label = mode === "corpus" ? "Corpus" : "Classic";
    const btn = el(
      "button",
      {
        class: `chip${studioMode === mode ? " on" : ""}`,
        style: "border-color:#2a2a2a; color:" + (studioMode === mode ? "#121212" : "#f3f3f3") +
          "; background:" + (studioMode === mode ? "#f3f3f3" : "transparent"),
      },
      label,
    );
    btn.addEventListener("click", () => {
      if (studioMode !== mode) switchMode(mode);
    });
    toggle.appendChild(btn);
  }
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
        // skip if a newer banner rendered, or the editor has since taken over
        // the canvas (a late flatten must never clobber the editor's DOM)
        if (token === flatToken && state.current === cur && !editorActive())
          $("#canvas").innerHTML = svg;
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

/** Called by corpus-mode when the user hits Save in corpus mode. */
function saveCorpusItem(config: CorpusSaveConfig, seed: number): void {
  state.saved.push({ kind: "corpus", config, seed });
  persist();
  // Tray is visible in both modes since the corpus save-tray landed — always repaint.
  renderSaved();
  flash("Saved to the tray below.");
}

function isEditedCorpusItem(config: CorpusSaveConfig): boolean {
  return (config as { edited?: unknown }).edited === true;
}

function persist(): void {
  localStorage.setItem("fai-pattern-saved", JSON.stringify(state.saved));
}
function renderSaved(): void {
  const tray = $("#saved");
  tray.innerHTML = "";
  const bad: SavedItem[] = [];
  state.saved.forEach((item) => {
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
      } else if (item.kind === "corpus") {
        // Re-generate deterministically using the corpus module.
        // The module should be loaded (corpus items can only be saved while in corpus
        // mode, so the dynamic import will have resolved already). If not yet loaded,
        // the item renders as a blank thumb and refreshes on the next renderSaved call.
        const corpusMod = _corpusMod;
        if (!corpusMod) {
          // Module not loaded yet — skip this item; it renders on next call.
          return;
        }
        const r = corpusMod.generateBannerForTray(item.config, item.seed);
        svg = r.svg;
        metaLeft = `seed ${item.seed}`;
        metaRight = isEditedCorpusItem(item.config) ? "edited" : r.plan.templateId ?? "corpus";
        onOpen = () => {
          // Switch to corpus mode and restore this item.
          if (studioMode !== "corpus") {
            switchMode("corpus");
          }
          // Restore via the corpus module (may already be loaded if we just switched).
          getCorpusMod().then((mod) => mod.openCorpusItem(item.config, item.seed)).catch(() => {});
        };
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
      bad.push(item); // drop unrenderable/corrupt items so they can't poison the tray
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
      state.saved = state.saved.filter((x) => x !== item);
      persist();
      renderSaved();
    });
    t.addEventListener("click", onOpen);
    tray.appendChild(t);
  });
  if (bad.length) {
    state.saved = state.saved.filter((x) => !bad.includes(x));
    persist();
    tray.appendChild(el(
      "div",
      { class: "tray-note", role: "status" },
      `${bad.length} saved item(s) couldn't be restored (engine updated)`,
    ));
  }
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
  if (editorActive()) return; // editor owns all shortcuts while open
  const tag = (e.target as HTMLElement).tagName;
  const inInput = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";

  if (e.code === "Space") {
    if (inInput) return;
    e.preventDefault();
    if (studioMode === "corpus") {
      if (_corpusMod) {
        _corpusMod.corpusSpacebarReroll();
      } else {
        getCorpusMod().then((mod) => mod.corpusSpacebarReroll()).catch(() => {});
      }
    } else {
      regen(true);
    }
    return;
  }

  // Corpus-only single-key shortcuts (← → S E) — guarded from inputs
  if (studioMode === "corpus") {
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
      if (inInput) return; // guard: don't intercept cursor movement in inputs
      if (_corpusMod) {
        const handled = _corpusMod.corpusKeydown(e.code);
        if (handled) e.preventDefault();
      }
      return;
    }
    if ((e.code === "KeyS" || e.code === "KeyE") && !inInput) {
      if (_corpusMod) {
        const handled = _corpusMod.corpusKeydown(e.code);
        if (handled) e.preventDefault();
      }
    }
  }
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
    if (item?.kind === "corpus" && item.config && typeof item.seed === "number") {
      migrated.push({ kind: "corpus", config: item.config as CorpusSaveConfig, seed: item.seed as number });
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

// Render the mode toggle in the header
renderModeToggle();
// Apply visibility based on the stored/default mode
applyModeVisibility();

if (studioMode === "corpus") {
  // Boot in corpus mode — show loading state first, then load the module.
  // Top-level await means `import("./main")` callers (including tests) will
  // block until corpus-mode is mounted and the first banner is rendered.
  const canvas = document.getElementById("canvas");
  if (canvas) canvas.innerHTML = `<p style="padding:20px;color:#666">Loading…</p>`;
  try {
    const mod = await getCorpusMod();
    mod.mountCorpusMode({ flash, onSave: saveCorpusItem });
    renderSaved(); // persisted tray items must appear on corpus cold boot too
  } catch (err) {
    flash(String(err), true);
  }
} else {
  // Boot in classic mode
  regen();
  renderSaved();
}
