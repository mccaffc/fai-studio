/**
 * corpus-mode.ts — Corpus mode UI for FAI Pattern Studio.
 *
 * Mounts/unmounts the corpus controls panel, drives generation via the
 * corpus grammar engine, and wires canvas actions for corpus exports.
 *
 * The corpus engine is zero-dep and instant (~0.5ms/gen); no async needed.
 */
import {
  generateBanner,
  reroll as engineReroll,
  variations as engineVariations,
  recolorPlan,
  describePlan,
  ARRANGEMENTS,
} from "../engine/corpus/index.js";
import type { CorpusResult, ArrangementId } from "../engine/corpus/index.js";
import { PROGRAMS } from "../engine/corpus/programs.js";
import type { ProgramId } from "../engine/corpus/programs.js";

const TEMPLATE_IDS = [
  "pipe-field",
  "arc-mosaic",
  "checker-motif",
  "repeat-rhythm",
  "figure-field",
  "mixed-quilt",
] as const;

// One flat accent list — orange first (the brand), then the six program hues
// alphabetical. All six are equal; no hue gets set off from the others.
const ACCENT_OPTIONS: Array<[string, string]> = [
  ["International Orange", "#FF4F00"],
  ["Celestial Blue", "#4997D0"],
  ["Chrome Yellow", "#FFA300"],
  ["Electric Violet", "#8265DB"],
  ["Frontier Indigo", "#3A4A6B"],
  ["Signal Green", "#268B41"],
  ["Telemagenta", "#D63A8C"],
];
const FULL_PALETTE_VALUE = "__full__";

// Arrangement labels shown in the size select: id → label with dims
const ARRANGEMENT_LABELS: Record<string, string> = {
  banner:       "Banner 6×3",
  portrait:     "Portrait 2×3",
  square:       "Square 3×3",
  strip:        "Strip 3×1",
  column:       "Column 1×6",
  "column-short": "Column short (experimental) 1×3",
};

// ── helpers ──────────────────────────────────────────────────────────────────

const $ = (sel: string): HTMLElement => document.querySelector(sel) as HTMLElement;

function el(tag: string, attrs: Record<string, string> = {}, html = ""): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

// ── module state ─────────────────────────────────────────────────────────────

// ── localStorage persistence ──────────────────────────────────────────────────

const LS_CORPUS_CONFIG = "fai-corpus-config";

interface PersistedCorpusConfig {
  template?: string;
  accent?: string;
  paletteMode?: "auto" | "full";
  density?: number;
  figures?: boolean;
  program?: string;
  arrangement?: string;
}

function loadCorpusConfig(): PersistedCorpusConfig {
  try {
    const raw = localStorage.getItem(LS_CORPUS_CONFIG);
    if (raw) return JSON.parse(raw) as PersistedCorpusConfig;
  } catch {
    // ignore corrupt storage
  }
  return {};
}

function saveCorpusConfig(): void {
  const persisted: PersistedCorpusConfig = {
    template: state.config.template,
    accent: state.config.accent,
    paletteMode: state.config.paletteMode,
    density: state.config.density,
    figures: state.config.figures,
    program: state.config.program,
    arrangement: state.config.arrangement,
  };
  try {
    localStorage.setItem(LS_CORPUS_CONFIG, JSON.stringify(persisted));
  } catch {
    // ignore storage errors (e.g. private browsing quota)
  }
}

interface CorpusState {
  current: CorpusResult | null;
  vars: CorpusResult[];
  config: {
    template: string;     // "" = auto
    accent: string;       // "" = auto
    paletteMode: "auto" | "full";
    density: number;
    figures: boolean;
    seed: number;
    program: string;      // "" = none, else ProgramId
    arrangement: string;  // "" = banner (default), else ArrangementId
  };
}

function makeDefaultConfig(): CorpusState["config"] {
  const saved = loadCorpusConfig();

  // Validate program ID: only adopt if it exists in PROGRAMS
  let program = saved.program ?? "";
  if (program && !Object.prototype.hasOwnProperty.call(PROGRAMS, program)) {
    program = "";
  }

  // Validate template ID: only adopt if it exists in TEMPLATE_IDS
  let template = saved.template ?? "";
  if (template && !TEMPLATE_IDS.includes(template as any)) {
    template = "";
  }

  // Validate arrangement ID: only adopt if it exists in ARRANGEMENTS
  let arrangement = saved.arrangement ?? "";
  if (arrangement && !Object.prototype.hasOwnProperty.call(ARRANGEMENTS, arrangement)) {
    arrangement = "";
  }

  return {
    template,
    accent: saved.accent ?? "",
    paletteMode: saved.paletteMode === "full" ? "full" : "auto",
    density: saved.density ?? 0.5,
    figures: saved.figures ?? true,
    seed: (Math.random() * 0xffffffff) >>> 0,
    program,
    arrangement,
  };
}

const state: CorpusState = {
  current: null,
  vars: [],
  config: makeDefaultConfig(),
};

// ── export helpers (corpus SVG bypasses finalSvg) ────────────────────────────

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}

function corpusSvgFilename(ext: string): string {
  const tmpl = state.current?.plan.templateId ?? (state.config.template || "auto");
  const seed = state.current?.seed ?? 0;
  // Include arrangement dims (cols×rows·320) in filename so exports self-describe.
  const plan = state.current?.plan;
  const dims = plan ? `${plan.cols * 320}x${plan.rows * 320}` : "1920x960";
  return `fai-corpus-${tmpl}-${dims}-${seed}.${ext}`;
}

function corpusDownloadSvg(): void {
  if (!state.current) return;
  const blob = new Blob([state.current.svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, corpusSvgFilename("svg"));
  URL.revokeObjectURL(url);
}

async function corpusDownloadPng(scale = 2): Promise<void> {
  if (!state.current) return;
  const svg = state.current.svg;
  // parse width/height from SVG root
  const tmp = document.createElement("div");
  tmp.innerHTML = svg;
  const svgEl = tmp.querySelector("svg");
  const w = parseFloat(svgEl?.getAttribute("width") ?? "0") || 800;
  const h = parseFloat(svgEl?.getAttribute("height") ?? "0") || 300;
  const img = new Image();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (png) triggerDownload(URL.createObjectURL(png), corpusSvgFilename("png"));
      URL.revokeObjectURL(url);
    }, "image/png");
  };
  img.src = url;
}

async function corpusCopySvg(): Promise<void> {
  if (!state.current) return;
  const svg = state.current.svg;
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(svg);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = svg;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  if (!ok) throw new Error("clipboard unavailable in this browser context");
}

// ── generation ───────────────────────────────────────────────────────────────

function buildCorpusConfig() {
  return {
    seed: state.config.seed,
    template: state.config.template || undefined,
    // accent is ignored by the engine when program is set, but we pass it
    // anyway so that switching back to None restores the user's chosen accent.
    accent: state.config.program || state.config.paletteMode === "full" ? undefined : (state.config.accent || undefined),
    paletteMode: state.config.program ? "auto" as const : state.config.paletteMode,
    density: state.config.density,
    figures: state.config.figures,
    program: (state.config.program as ProgramId) || undefined,
    arrangement: (state.config.arrangement as ArrangementId) || undefined,
  };
}

function paintCorpusError(err: unknown): void {
  const canvas = document.querySelector("#canvas");
  if (canvas) canvas.innerHTML = `<p style="padding:20px;color:#c00">${String(err)}</p>`;
}

export function corpusRegen(newSeed = false): void {
  if (newSeed) {
    state.config.seed = (Math.random() * 0xffffffff) >>> 0;
  }
  saveCorpusConfig();
  // Defense-in-depth parity with classic regen(): the default mode must never
  // blank the studio — paint any engine error into the canvas instead.
  try {
    state.current = generateBanner(buildCorpusConfig());
    state.vars = engineVariations(state.current, 6);
    renderCorpusCanvas();
    renderCorpusVariations();
    updateSeedDisplay();
    renderCorpusScores();
  } catch (err) {
    paintCorpusError(err);
  }
}

function corpusRecolorInPlace(): void {
  if (!state.current) return;
  saveCorpusConfig();
  const accent = state.config.accent;
  if (accent) {
    state.current = recolorPlan(state.current, accent);
    state.vars = state.vars.map((v) => recolorPlan(v, accent));
  } else {
    // auto accent: regenerate with new accent slot
    state.current = generateBanner(buildCorpusConfig());
    state.vars = engineVariations(state.current, 6);
  }
  renderCorpusCanvas();
  renderCorpusVariations();
  renderCorpusScores();
}

// ── canvas actions ────────────────────────────────────────────────────────────

let flashFn: ((msg: string, isError?: boolean) => void) | null = null;

function flash(msg: string, isError = false): void {
  if (flashFn) flashFn(msg, isError);
}

function renderCorpusCanvas(): void {
  if (!state.current) return;
  const canvas = $("#canvas");
  if (!canvas) return;
  canvas.innerHTML = state.current.svg;
  // Adapt the canvas container to the arrangement's aspect ratio so it doesn't
  // letterbox on non-banner sizes. The SVG carries its own dims; we just clamp
  // max-width/height so the container fits naturally.
  const svgEl = canvas.querySelector("svg");
  if (svgEl) {
    const w = parseFloat(svgEl.getAttribute("width") ?? "0");
    const h = parseFloat(svgEl.getAttribute("height") ?? "0");
    if (w > 0 && h > 0) {
      svgEl.style.maxWidth = "100%";
      svgEl.style.height = "auto";
      svgEl.style.display = "block";
    }
  }

  const acts = $("#canvas-actions");
  if (!acts) return;
  acts.innerHTML = "";

  const mkBtn = (label: string, cls: string, fn: () => void | Promise<void>) => {
    const b = el("button", { class: cls }, label);
    b.addEventListener("click", () => {
      Promise.resolve(fn()).catch((err) => flash(String(err), true));
    });
    acts.appendChild(b);
  };

  mkBtn("Reroll", "primary", () => {
    if (!state.current) return;
    state.current = engineReroll(state.current);
    state.config.seed = state.current.seed;
    state.vars = engineVariations(state.current, 6);
    renderCorpusCanvas();
    renderCorpusVariations();
    updateSeedDisplay();
    renderCorpusScores();
  });
  mkBtn("Save", "", () => {
    if (!state.current) return;
    if (onSaveFn) {
      onSaveFn(state.current.config, state.current.seed);
    }
  });
  mkBtn("SVG", "ghost", () => {
    corpusDownloadSvg();
    flash("SVG saved to your browser's Downloads folder.");
  });
  mkBtn("PNG 2×", "ghost", async () => {
    await corpusDownloadPng();
    flash("PNG saved to your browser's Downloads folder.");
  });
  mkBtn("Copy SVG", "ghost", async () => {
    await corpusCopySvg();
    flash("SVG copied to clipboard.");
  });
}

function renderCorpusVariations(): void {
  const tray = $("#variations");
  if (!tray) return;
  tray.innerHTML = "";
  for (const v of state.vars) {
    const desc = describePlan(v.plan);
    const t = el(
      "div",
      { class: "thumb" },
      v.svg + `<div class="meta"><span>seed ${v.seed}</span><span title="${desc}">${v.plan.templateId ?? "auto"}</span></div>`,
    );
    t.addEventListener("click", () => {
      state.current = v;
      state.config.seed = v.seed;
      state.vars = engineVariations(v, 6);
      renderCorpusCanvas();
      renderCorpusVariations();
      updateSeedDisplay();
      renderCorpusScores();
    });
    tray.appendChild(t);
  }
}

function renderCorpusScores(): void {
  const el = $("#corpus-scores");
  if (!el || !state.current) return;
  const s = state.current.scores;
  const tmpl = state.current.plan.templateId ?? "auto";
  const quiltBadge = s.quiltFail
    ? ` <span class="corpus-quilt-badge">QUILT</span>`
    : "";
  // Show program name in scores line when a program is active.
  const programSuffix = state.config.program && PROGRAMS[state.config.program as ProgramId]
    ? ` · program ${PROGRAMS[state.config.program as ProgramId].name}`
    : "";
  // Composition tooltip: all four metrics (dom/bal/neg/rhy) for full detail.
  const compTooltip =
    `dom ${s.focalDominance.toFixed(1)} · ` +
    `bal ${s.balance.toFixed(2)} · ` +
    `neg ${s.negativeSpaceCluster.toFixed(2)} · ` +
    `rhy ${s.rhythmQuality.toFixed(2)}` +
    (s.floorsPass ? '' : ' [COMP FAIL]');
  el.innerHTML =
    `conn ${s.connectedness.toFixed(2)} · ` +
    `line ${s.lineworkShare.toFixed(2)} · ` +
    `density ${s.density.toFixed(2)} · ` +
    `acc ${s.accentShare.toFixed(2)} · ` +
    tmpl +
    programSuffix +
    ` · <span title="${compTooltip}">dom ${s.focalDominance.toFixed(1)} · rhy ${s.rhythmQuality.toFixed(2)}</span>` +
    quiltBadge;
}

// ── seed display ─────────────────────────────────────────────────────────────

function updateSeedDisplay(): void {
  const inp = document.querySelector(
    "#corpus-controls input[data-corpus-seed]",
  ) as HTMLInputElement | null;
  if (inp && state.current) inp.value = String(state.current.seed);
}

// ── controls panel ────────────────────────────────────────────────────────────

/**
 * Sync accent select disabled state to the current program config.
 * Called after a program selection change (without re-rendering the full panel).
 */
function updateAccentSelectState(): void {
  const sel = document.querySelector(
    "#corpus-controls select[data-corpus-accent]",
  ) as HTMLSelectElement | null;
  if (!sel) return;
  if (state.config.program) {
    sel.disabled = true;
    sel.title = "program mode uses the program hue";
  } else {
    sel.disabled = false;
    sel.title = "";
  }
}

function renderCorpusControls(): void {
  const root = $("#corpus-controls");
  if (!root) return;
  root.innerHTML = "";

  const group = (title: string): HTMLElement => {
    const g = el("div", { class: "group" }, `<h3>${title}</h3>`);
    root.appendChild(g);
    return g;
  };

  // Arrangement (Size) — at top of panel
  {
    const g = group("Size");
    const sel = el("select", { "data-corpus-arrangement": "" }) as HTMLSelectElement;
    for (const id of Object.keys(ARRANGEMENTS) as ArrangementId[]) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = ARRANGEMENT_LABELS[id] ?? id;
      // Default is banner (empty string maps to banner)
      if (id === (state.config.arrangement || "banner")) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      state.config.arrangement = sel.value === "banner" ? "" : sel.value;
      corpusRegen(false);
    });
    g.appendChild(sel);
  }

  // Template
  {
    const g = group("Template");
    const sel = el("select", { "data-corpus-template": "" }) as HTMLSelectElement;
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto";
    sel.appendChild(auto);
    for (const id of TEMPLATE_IDS) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = id;
      if (id === state.config.template) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      state.config.template = sel.value;
      corpusRegen(false);
    });
    g.appendChild(sel);
  }

  // Program (ABOVE accent — single-hue law)
  {
    const g = group("Program");
    const sel = el("select", { "data-corpus-program": "" }) as HTMLSelectElement;
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "None";
    sel.appendChild(none);
    for (const [id, prog] of Object.entries(PROGRAMS) as [ProgramId, { name: string; hue: string }][]) {
      const o = document.createElement("option");
      o.value = id;
      // Swatch dot via unicode + program name (CSS ::before unreliable in <option>)
      o.textContent = `● ${prog.name}`;
      // Store the hue on the option for reference
      o.dataset.hue = prog.hue;
      if (id === state.config.program) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      state.config.program = sel.value;
      // Single-hue law: disable accent select when a program is chosen
      updateAccentSelectState();
      corpusRegen(false);
    });
    g.appendChild(sel);
  }

  // Accent
  {
    const g = group("Accent");
    const sel = el("select", { "data-corpus-accent": "" }) as HTMLSelectElement;
    // Disable when program is active (single-hue law)
    if (state.config.program) {
      sel.disabled = true;
      sel.title = "program mode uses the program hue";
    }
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto";
    sel.appendChild(auto);
    const full = document.createElement("option");
    full.value = FULL_PALETTE_VALUE;
    full.textContent = "Full palette";
    if (state.config.paletteMode === "full") full.selected = true;
    sel.appendChild(full);
    for (const [name, hex] of ACCENT_OPTIONS) {
      const o = document.createElement("option");
      o.value = hex;
      o.textContent = `${name} ${hex}`;
      if (state.config.paletteMode !== "full" && hex === state.config.accent) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      if (sel.value === FULL_PALETTE_VALUE) {
        state.config.paletteMode = "full";
        state.config.accent = "";
        corpusRegen(false);
        return;
      }
      state.config.paletteMode = "auto";
      state.config.accent = sel.value;
      // recolor (geometry frozen) if there's a current result; else regenerate
      if (state.current) {
        corpusRecolorInPlace();
      } else {
        corpusRegen(false);
      }
    });
    g.appendChild(sel);
  }

  // Density
  {
    const g = group("Density");
    const row = el("div", { class: "row" });
    const label = el("label", {}, `Density: ${state.config.density.toFixed(2)}`);
    const slider = el("input", {
      type: "range", min: "0", max: "1", step: "0.01",
      value: String(state.config.density),
    }) as HTMLInputElement;
    // Show live value on input (no regen); regenerate only on change (pointer-up)
    slider.addEventListener("input", () => {
      label.textContent = `Density: ${Number(slider.value).toFixed(2)}`;
    });
    slider.addEventListener("change", () => {
      state.config.density = Number(slider.value);
      label.textContent = `Density: ${state.config.density.toFixed(2)}`;
      corpusRegen(false);
    });
    row.appendChild(label);
    row.appendChild(slider);
    g.appendChild(row);
  }

  // Figures
  {
    const g = group("Figures");
    const chip = el(
      "button",
      { class: `chip${state.config.figures ? " on" : ""}` },
      "figures",
    );
    chip.addEventListener("click", () => {
      state.config.figures = !state.config.figures;
      chip.classList.toggle("on", state.config.figures);
      corpusRegen(false);
    });
    g.appendChild(chip);
  }

  // Seed
  {
    const g = group("Seed");
    const row = el("div", { class: "seed-row" });
    const inp = el("input", {
      type: "text",
      readonly: "",
      "data-corpus-seed": "",
      value: String(state.current?.seed ?? state.config.seed),
    }) as HTMLInputElement;
    const copyBtn = el("button", { class: "chip", title: "copy seed", style: "width:44px" }, "copy");
    copyBtn.addEventListener("click", () => {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(inp.value).catch(() => {});
      }
    });
    row.appendChild(inp);
    row.appendChild(copyBtn);
    g.appendChild(row);
  }
}

// ── mount / unmount ───────────────────────────────────────────────────────────

export interface CorpusModeOptions {
  flash: (msg: string, isError?: boolean) => void;
  /** Called when the user saves a corpus result to the tray. */
  onSave?: (config: import("../engine/corpus/index.js").CorpusConfig, seed: number) => void;
}

let onSaveFn: ((config: import("../engine/corpus/index.js").CorpusConfig, seed: number) => void) | null = null;

export function mountCorpusMode(opts: CorpusModeOptions): void {
  flashFn = opts.flash;
  onSaveFn = opts.onSave ?? null;
  renderCorpusControls();
  corpusRegen(false);
}

/**
 * Generate a banner for tray preview rendering — used by the save tray in main.ts
 * (which can't statically import the corpus engine without blowing the initial bundle).
 */
export function generateBannerForTray(
  config: import("../engine/corpus/index.js").CorpusConfig,
  seed: number,
): import("../engine/corpus/index.js").CorpusResult {
  return generateBanner({ ...config, seed });
}

/** Restore a previously saved corpus item — used by the save tray. */
export function openCorpusItem(config: import("../engine/corpus/index.js").CorpusConfig, seed: number): void {
  try {
    state.config = {
      template: config.template ?? "",
      accent: config.accent ?? "",
      paletteMode: config.paletteMode === "full" ? "full" : "auto",
      density: config.density ?? 0.5,
      figures: config.figures ?? true,
      seed,
      program: config.program ?? "",
      arrangement: config.arrangement ?? "",
    };
    saveCorpusConfig();
    state.current = generateBanner({ ...config, seed });
    state.vars = engineVariations(state.current, 6);
    renderCorpusCanvas();
    renderCorpusVariations();
    updateSeedDisplay();
    renderCorpusScores();
    renderCorpusControls();
  } catch (err) {
    paintCorpusError(err);
  }
}

export function unmountCorpusMode(): void {
  flashFn = null;
  const root = $("#corpus-controls");
  if (root) root.innerHTML = "";
  const scores = $("#corpus-scores");
  if (scores) scores.innerHTML = "";
}

// ── spacebar hook (called from main.ts when corpus is active) ─────────────────

export function corpusSpacebarReroll(): void {
  if (!state.current) return;
  state.current = engineReroll(state.current);
  state.config.seed = state.current.seed;
  state.vars = engineVariations(state.current, 6);
  renderCorpusCanvas();
  renderCorpusVariations();
  updateSeedDisplay();
  renderCorpusScores();
}
