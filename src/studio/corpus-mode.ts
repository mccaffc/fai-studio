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
} from "../engine/corpus/index.js";
import type { CorpusResult } from "../engine/corpus/index.js";
import { GRAMMAR as GRAMMAR_RAW } from "../engine/corpus/data/grammar.js";
import type { EngineGrammar } from "../engine/corpus/data/grammar.js";

const GRAMMAR = GRAMMAR_RAW as unknown as EngineGrammar;

const TEMPLATE_IDS = [
  "pipe-field",
  "arc-mosaic",
  "checker-motif",
  "repeat-rhythm",
  "figure-field",
  "mixed-quilt",
] as const;

const CORPUS_ACCENTS: Array<[string, string]> = [
  ["International Orange", "#FF4F00"],
  ["Celestial Blue", "#4997D0"],
  ["Chrome Yellow", "#FFA300"],
];

// ── helpers ──────────────────────────────────────────────────────────────────

const $ = (sel: string): HTMLElement => document.querySelector(sel) as HTMLElement;

function el(tag: string, attrs: Record<string, string> = {}, html = ""): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

// ── module state ─────────────────────────────────────────────────────────────

interface CorpusState {
  current: CorpusResult | null;
  vars: CorpusResult[];
  config: {
    template: string; // "" = auto
    accent: string;   // "" = auto
    density: number;
    figures: boolean;
    seed: number;
  };
}

const state: CorpusState = {
  current: null,
  vars: [],
  config: {
    template: "",
    accent: "",
    density: 0.5,
    figures: true,
    seed: (Math.random() * 0xffffffff) >>> 0,
  },
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
  return `fai-corpus-${tmpl}-${seed}.${ext}`;
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
    accent: state.config.accent || undefined,
    density: state.config.density,
    figures: state.config.figures,
  };
}

export function corpusRegen(newSeed = false): void {
  if (newSeed) {
    state.config.seed = (Math.random() * 0xffffffff) >>> 0;
  }
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
    const canvas = document.querySelector("#canvas");
    if (canvas) canvas.innerHTML = `<p style="padding:20px;color:#c00">${String(err)}</p>`;
  }
}

function corpusRecolorInPlace(): void {
  if (!state.current) return;
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
  el.innerHTML =
    `conn ${s.connectedness.toFixed(2)} · ` +
    `line ${s.lineworkShare.toFixed(2)} · ` +
    `density ${s.density.toFixed(2)} · ` +
    `acc ${s.accentShare.toFixed(2)} · ` +
    tmpl +
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

function renderCorpusControls(): void {
  const root = $("#corpus-controls");
  if (!root) return;
  root.innerHTML = "";

  const group = (title: string): HTMLElement => {
    const g = el("div", { class: "group" }, `<h3>${title}</h3>`);
    root.appendChild(g);
    return g;
  };

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

  // Accent
  {
    const g = group("Accent");
    const sel = el("select", { "data-corpus-accent": "" }) as HTMLSelectElement;
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto";
    sel.appendChild(auto);
    for (const [name, hex] of CORPUS_ACCENTS) {
      const o = document.createElement("option");
      o.value = hex;
      o.textContent = `${name} ${hex}`;
      if (hex === state.config.accent) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
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
}

export function mountCorpusMode(opts: CorpusModeOptions): void {
  flashFn = opts.flash;
  renderCorpusControls();
  corpusRegen(false);
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

// Export GRAMMAR accentOrder so main.ts can reference it if needed
export { GRAMMAR };
