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
import type { CorpusConfig, CorpusResult, ArrangementId } from "../engine/corpus/index.js";
import { DEFAULT_ACCENT_STRENGTH, IDENTITY_ACCENT_STRENGTH, type BannerPlan } from "../engine/corpus/types.js";
import { renderPlanSvg } from "../engine/corpus/render.js";
import { TILES } from "../engine/corpus/data/tiles.js";
import { PROGRAMS } from "../engine/corpus/programs.js";
import type { ProgramId } from "../engine/corpus/programs.js";
import {
  corpusEditorActive,
  enterCorpusEdit,
  exitCorpusEditor,
  saveCorpusEditor,
} from "./editor-corpus/index";

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
  ["Deep Teal", "#0E8C88"],
];
const ACCENT_HEXES = ACCENT_OPTIONS.map(([, hex]) => hex);
const ACCENT_SET = new Set(ACCENT_HEXES);
// Mirrors sample.ts's DARK_GROUND_ZONE_LUMINANCE rule without importing engine
// code: the two dark locked hues get a SmokeWhite check; the rest get CodGray.
const SMOKE_WHITE_CHECK_HEXES = new Set(["#268B41", "#3A4A6B"]);

// Arrangement labels shown in the size select: id → label with dims
const ARRANGEMENT_LABELS: Record<string, string> = {
  banner:       "Banner 6×3",
  portrait:     "Portrait 2×3",
  square:       "Square 3×3",
  strip:        "Strip 3×1",
  column:       "Column 1×6",
  "column-short": "Column 1×3",
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
  accentPool?: string[];
  /** Legacy read-only migration input. Do not write. */
  accent?: string;
  /** Legacy read-only migration input. Do not write. */
  paletteMode?: "auto" | "full";
  accentStrength?: number;
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

function normalizeAccentHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.toUpperCase();
  return ACCENT_SET.has(hex) ? hex : null;
}

function normalizeAccentPool(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const selected = new Set<string>();
  for (const raw of value) {
    const hex = normalizeAccentHex(raw);
    if (hex) selected.add(hex);
  }
  return ACCENT_HEXES.filter((hex) => selected.has(hex));
}

function normalizeAccentStrength(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

function migrateAccentPool(saved: Pick<PersistedCorpusConfig, "accentPool" | "accent" | "paletteMode">): string[] {
  const pool = normalizeAccentPool(saved.accentPool);
  if (pool.length) return pool;
  if (saved.paletteMode === "full") return [...ACCENT_HEXES];
  const accent = normalizeAccentHex(saved.accent);
  return accent ? [accent] : [];
}

function saveCorpusConfig(): void {
  const persisted: PersistedCorpusConfig = {
    template: state.config.template,
    accentPool: [...state.config.accentPool],
    accentStrength: state.config.accentStrength,
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
  editing: boolean;
  preEdit: CorpusResult | null;
  config: {
    template: string;     // "" = auto
    accentPool: string[]; // [] = auto/canon; 1..7 = explicit user pool
    accentStrength?: number;
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
    accentPool: migrateAccentPool(saved),
    accentStrength: normalizeAccentStrength(saved.accentStrength),
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
  editing: false,
  preEdit: null,
  config: makeDefaultConfig(),
};

// ── seed history (session-scoped, cap 50) ────────────────────────────────────

interface HistoryEntry {
  seed: number;
  config: CorpusSaveConfig;
}

const history: HistoryEntry[] = [];
let historyPtr = -1; // index of the currently displayed entry (-1 = none yet)

/** Push a new entry onto history (drops forward tail; no-op for edited configs). */
function historyPush(result: import("../engine/corpus/index.js").CorpusResult): void {
  if (state.editing) return;
  if (isEditedCorpusConfig(result.config)) return; // spec: edited items not pushed
  // Drop forward tail
  if (historyPtr < history.length - 1) {
    history.splice(historyPtr + 1);
  }
  history.push({ seed: result.seed, config: result.config });
  if (history.length > 50) history.shift();
  historyPtr = history.length - 1;
  updateHistoryButtons();
}

function historyWalk(delta: -1 | 1): void {
  if (state.editing) return;
  const next = historyPtr + delta;
  if (next < 0 || next >= history.length) return;
  historyPtr = next;
  const entry = history[historyPtr]!;
  // Restore config from the snapshot
  state.config = {
    template: (entry.config as { template?: string }).template ?? "",
    accentPool: (entry.config as { accentPool?: string[] }).accentPool
      ? [...((entry.config as { accentPool: string[] }).accentPool)]
      : [],
    accentStrength: normalizeAccentStrength((entry.config as { accentStrength?: number }).accentStrength),
    density: (entry.config as { density?: number }).density ?? 0.5,
    figures: (entry.config as { figures?: boolean }).figures ?? true,
    seed: entry.seed,
    program: (entry.config as { program?: string }).program ?? "",
    arrangement: (entry.config as { arrangement?: string }).arrangement ?? "",
  };
  saveCorpusConfig();
  state.current = generateBanner(buildCorpusConfig());
  state.vars = engineVariations(state.current, 6);
  renderCorpusCanvas();
  renderCorpusVariations();
  updateSeedDisplay();
  renderCorpusScores();
  updateHistoryButtons();
  renderCorpusControls();
}

function updateHistoryButtons(): void {
  const backBtn = document.querySelector<HTMLButtonElement>("[data-corpus-hist-back]");
  const fwdBtn = document.querySelector<HTMLButtonElement>("[data-corpus-hist-fwd]");
  if (backBtn) backBtn.disabled = historyPtr <= 0;
  if (fwdBtn) fwdBtn.disabled = historyPtr >= history.length - 1;
}

export type EditedCorpusConfig = CorpusConfig & {
  edited: true;
  plan: BannerPlan;
};

export type CorpusSaveConfig = CorpusConfig | EditedCorpusConfig;

function isEditedCorpusConfig(config: CorpusSaveConfig): config is EditedCorpusConfig {
  return (config as { edited?: unknown }).edited === true && Boolean((config as { plan?: unknown }).plan);
}

function emptyScores(): CorpusResult["scores"] {
  return {
    connectedness: 0,
    lineworkShare: 0,
    groundShifts: 0,
    density: 0,
    accentShare: 0,
    maxTileRepetition: 0,
    rhythmic: false,
    connected: false,
    quiltFail: false,
    focalDominance: 0,
    balance: 0,
    negativeSpaceCluster: 0,
    rhythmQuality: 0,
    floorsPass: false,
  };
}

function editedResultFromPlan(config: EditedCorpusConfig, seed: number): CorpusResult {
  const plan = structuredClone(config.plan);
  return {
    svg: renderPlanSvg(plan, TILES),
    plan,
    scores: emptyScores(),
    seed,
    attempts: 1,
    config,
  };
}

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

// ── destination export presets ───────────────────────────────────────────────

interface ExportPresetSpec {
  slug: string;
  arrangement: string; // ArrangementId
  w: number;
  h: number;
}

const PRESET_SPECS: Record<string, ExportPresetSpec> = {
  hero:    { slug: "hero",    arrangement: "banner", w: 2560, h: 1280 },
  deck:    { slug: "deck",    arrangement: "banner", w: 1920, h: 960  },
  eyebrow: { slug: "eyebrow", arrangement: "strip",  w: 2880, h: 960  },
  square:  { slug: "square",  arrangement: "square", w: 2048, h: 2048 },
};

async function corpusDownloadPreset(preset: string): Promise<void> {
  if (!state.current) return;
  const spec = PRESET_SPECS[preset];
  if (!spec) return;

  const currentArrangement = state.config.arrangement || "banner";
  let result = state.current;

  // If current arrangement doesn't match preset arrangement, regenerate same seed
  // under the target arrangement.
  if (currentArrangement !== spec.arrangement) {
    // Edited banners carry a fixed plan; cross-arrangement regeneration would
    // silently discard the user's edits.  Guard: refuse the mismatched preset
    // and tell the user to use the SVG/PNG buttons instead.
    if (isEditedCorpusConfig(state.current.config)) {
      flash("edited banners export at their own arrangement — use SVG/PNG buttons", true);
      return;
    }
    flash(`Re-generated at ${spec.arrangement} for ${spec.slug}`);
    result = generateBanner({
      ...buildCorpusConfig(),
      arrangement: spec.arrangement as import("../engine/corpus/index.js").ArrangementId,
    });
  }

  const svg = result.svg;
  const tmpl = result.plan.templateId ?? (state.config.template || "auto");
  const seed = result.seed;
  const filename = `fai-${spec.slug}-${tmpl}-${seed}-${spec.w}x${spec.h}.png`;

  // Rasterize at target pixel size
  const img = new Image();
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = spec.w;
      canvas.height = spec.h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((png) => {
        if (png) triggerDownload(URL.createObjectURL(png), filename);
        URL.revokeObjectURL(url);
        resolve();
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG render failed")); };
    img.src = url;
  });
  flash(`${spec.slug} PNG (${spec.w}×${spec.h}) saved to your browser's Downloads folder.`);
}

// ── sheet ×12 overlay ─────────────────────────────────────────────────────────

const SHEET_TEMPLATE_ORDER = [
  "pipe-field",
  "arc-mosaic",
  "checker-motif",
  "repeat-rhythm",
  "figure-field",
  "mixed-quilt",
] as const;

function openSheetOverlay(): void {
  if (!state.current) return;
  const baseSeed = state.current.seed;

  // Build 12 cells: seeds baseSeed+1…+12, templates cycled two each
  const cells: Array<{ seed: number; template: string; svg: string }> = [];
  for (let i = 0; i < 12; i++) {
    const seed = (baseSeed + 1 + i) >>> 0;
    const template = SHEET_TEMPLATE_ORDER[i % 6]!;
    const cfg = buildCorpusConfig();
    cfg.seed = seed;
    cfg.template = template;
    try {
      const r = generateBanner(cfg);
      cells.push({ seed, template, svg: r.svg });
    } catch {
      cells.push({ seed, template: template as string, svg: "" });
    }
  }

  // Overlay element
  const overlay = el("div", {
    class: "corpus-sheet-overlay",
    "data-corpus-sheet-overlay": "",
    role: "dialog",
    "aria-modal": "true",
  });

  const grid = el("div", { class: "corpus-sheet-grid" });

  let focusedIdx = 0;

  const cellEls: HTMLElement[] = [];

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const cellEl = el("div", {
      class: "corpus-sheet-cell" + (i === 0 ? " focus" : ""),
      "data-corpus-sheet-cell": "",
      tabindex: "0",
    });
    cellEl.innerHTML = c.svg;
    const cap = el("div", {
      class: "corpus-sheet-caption",
      "data-corpus-sheet-caption": "",
    }, `${c.seed} · ${c.template}`);
    cellEl.appendChild(cap);

    cellEl.addEventListener("click", (e) => {
      e.stopPropagation();
      promoteCell(i);
    });
    cellEls.push(cellEl);
    grid.appendChild(cellEl);
  }

  overlay.appendChild(grid);
  document.body.appendChild(overlay);

  function promoteCell(idx: number): void {
    const c = cells[idx]!;
    // Adopt seed and template
    state.config.seed = c.seed;
    state.config.template = c.template;
    saveCorpusConfig();
    state.current = generateBanner(buildCorpusConfig());
    state.vars = engineVariations(state.current, 6);
    historyPush(state.current);
    closeOverlay();
    renderCorpusCanvas();
    renderCorpusVariations();
    updateSeedDisplay();
    renderCorpusScores();
    // Update template select to reflect promoted template
    const tmplSel = document.querySelector<HTMLSelectElement>("#corpus-controls select[data-corpus-template]");
    if (tmplSel) tmplSel.value = c.template;
  }

  function closeOverlay(): void {
    overlay.remove();
    document.removeEventListener("keydown", overlayKeydown);
  }

  function updateFocus(newIdx: number): void {
    cellEls[focusedIdx]?.classList.remove("focus");
    focusedIdx = newIdx;
    cellEls[focusedIdx]?.classList.add("focus");
    cellEls[focusedIdx]?.focus();
  }

  function overlayKeydown(e: KeyboardEvent): void {
    if (e.code === "Escape") { e.preventDefault(); closeOverlay(); return; }
    if (e.code === "ArrowLeft") { e.preventDefault(); updateFocus(Math.max(0, focusedIdx - 1)); return; }
    if (e.code === "ArrowRight") { e.preventDefault(); updateFocus(Math.min(11, focusedIdx + 1)); return; }
    if (e.code === "Enter") { e.preventDefault(); promoteCell(focusedIdx); return; }
  }

  document.addEventListener("keydown", overlayKeydown);

  // Scrim click closes (click on overlay but not grid)
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeOverlay();
  });
}

// ── generation ───────────────────────────────────────────────────────────────

function buildCorpusConfig(): CorpusConfig {
  const config: CorpusConfig = {
    seed: state.config.seed,
    density: state.config.density,
    figures: state.config.figures,
  };
  if (state.config.accentStrength !== undefined) config.accentStrength = state.config.accentStrength;
  if (state.config.template) config.template = state.config.template;
  if (!state.config.program && state.config.accentPool.length) {
    config.accentPool = [...state.config.accentPool];
  }
  if (state.config.program) config.program = state.config.program as ProgramId;
  if (state.config.arrangement) config.arrangement = state.config.arrangement as ArrangementId;
  return config;
}

function withCurrentCorpusConfig(result: CorpusResult): CorpusResult {
  return {
    ...result,
    config: { ...buildCorpusConfig(), seed: result.seed },
  };
}

function paintCorpusError(err: unknown): void {
  const canvas = document.querySelector("#canvas");
  if (canvas) canvas.innerHTML = `<p style="padding:20px;color:#c00">${String(err)}</p>`;
}

export function corpusRegen(newSeed = false, pushHistory = true): void {
  if (state.editing) return;
  if (newSeed) {
    state.config.seed = (Math.random() * 0xffffffff) >>> 0;
  }
  saveCorpusConfig();
  // Defense-in-depth parity with classic regen(): the default mode must never
  // blank the studio — paint any engine error into the canvas instead.
  try {
    state.current = generateBanner(buildCorpusConfig());
    state.vars = engineVariations(state.current, 6);
    if (pushHistory) historyPush(state.current);
    renderCorpusCanvas();
    renderCorpusVariations();
    updateSeedDisplay();
    renderCorpusScores();
  } catch (err) {
    paintCorpusError(err);
  }
}

function corpusRecolorInPlace(): void {
  if (state.editing) return;
  if (!state.current) return;
  saveCorpusConfig();
  const [accent] = state.config.accentPool;
  if (state.config.accentPool.length === 1 && accent) {
    state.current = withCurrentCorpusConfig(recolorPlan(state.current, accent));
    state.vars = state.vars.map((v) => withCurrentCorpusConfig(recolorPlan(v, accent)));
  } else {
    // Auto/full/multi-accent pools change sampler constraints, so regenerate.
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
  if (state.editing) return;
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
    if (isEditedCorpusConfig(state.current.config)) {
      // Edited configs must not be spread into fresh generations — rebuild a
      // clean config from the current panel state with an incremented seed.
      state.config.seed = state.current.seed + 1;
      state.current = generateBanner(buildCorpusConfig());
    } else {
      state.current = engineReroll(state.current);
      state.config.seed = state.current.seed;
    }
    state.vars = engineVariations(state.current, 6);
    historyPush(state.current);
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
  mkBtn("Edit", "", () => {
    beginCorpusEdit();
  });
  acts.lastElementChild?.setAttribute("data-corpus-edit", "");
  mkBtn("Sheet ×12", "ghost", () => {
    openSheetOverlay();
  });

  // ── Destination export preset select ────────────────────────────────────────
  const exportPreset = el("select", { "data-corpus-export-preset": "", style: "width:auto" }) as HTMLSelectElement;
  const EXPORT_PRESETS: Array<{ value: string; label: string }> = [
    { value: "custom",  label: "Export…" },
    { value: "hero",    label: "Hero — 2560×1280 PNG" },
    { value: "deck",    label: "Deck panel — 1920×960 PNG" },
    { value: "eyebrow", label: "Eyebrow — 2880×960 PNG" },
    { value: "square",  label: "Square social — 2048×2048 PNG" },
  ];
  for (const p of EXPORT_PRESETS) {
    const o = document.createElement("option");
    o.value = p.value;
    o.textContent = p.label;
    exportPreset.appendChild(o);
  }
  exportPreset.addEventListener("change", () => {
    const preset = exportPreset.value;
    exportPreset.value = "custom"; // snap back immediately
    if (preset === "custom") return;
    void corpusDownloadPreset(preset).catch((err) => flash(String(err), true));
  });
  acts.appendChild(exportPreset);

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
      historyPush(state.current);
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
  if (state.editing || isEditedCorpusConfig(state.current.config)) {
    el.innerHTML = "";
    return;
  }
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

function activeProgramHue(): string {
  const program = state.config.program as ProgramId;
  return program && PROGRAMS[program] ? PROGRAMS[program].hue : "";
}

function accentAmountEnabled(): boolean {
  return Boolean(state.config.program) || state.config.accentPool.length > 0;
}

function effectiveAccentStrength(): number {
  if (state.config.accentStrength !== undefined) return state.config.accentStrength;
  return accentAmountEnabled() ? DEFAULT_ACCENT_STRENGTH : IDENTITY_ACCENT_STRENGTH;
}

function accentStrengthLabelText(value = effectiveAccentStrength()): string {
  return `Accent amount: ${value.toFixed(2)}`;
}

function visibleAccentSet(): Set<string> {
  const programHue = activeProgramHue();
  return new Set(programHue ? [programHue] : state.config.accentPool);
}

function accentCaption(): string {
  if (state.config.program) return "program hue";
  const count = state.config.accentPool.length;
  if (count === 0) return "canon mix";
  if (count === ACCENT_HEXES.length) return "full palette";
  return count === 1 ? "1 accent" : `${count} accents`;
}

function updateAccentSwatchState(): void {
  const selected = visibleAccentSet();
  const programLocked = Boolean(state.config.program);
  const presetWrap = document.querySelector("[data-corpus-accent-presets]") as HTMLElement | null;
  if (presetWrap) presetWrap.hidden = programLocked;

  const caption = document.querySelector("[data-corpus-accent-caption]") as HTMLElement | null;
  if (caption) caption.textContent = accentCaption();

  const buttons = document.querySelectorAll<HTMLButtonElement>(".accent-swatch[data-corpus-accent]");
  for (const button of buttons) {
    const hex = button.dataset.corpusAccent ?? "";
    const on = selected.has(hex);
    button.classList.toggle("on", on);
    button.classList.toggle("locked", programLocked && on);
    button.setAttribute("aria-pressed", String(on));
    button.disabled = programLocked;
    button.title = programLocked
      ? `${button.dataset.accentName ?? "Accent"} ${hex} — program hue locked`
      : `${button.dataset.accentName ?? "Accent"} ${hex}`;
  }
  updateAccentStrengthControl();
}

function updateAccentStrengthControl(): void {
  const enabled = accentAmountEnabled();
  const value = effectiveAccentStrength();
  const row = document.querySelector("[data-corpus-accent-strength-row]") as HTMLElement | null;
  const label = document.querySelector("[data-corpus-accent-strength-label]") as HTMLElement | null;
  const slider = document.querySelector("[data-corpus-accent-strength]") as HTMLInputElement | null;
  if (row) {
    row.classList.toggle("disabled", !enabled);
    row.title = enabled ? "" : "check an accent first";
  }
  if (label) label.textContent = accentStrengthLabelText(value);
  if (slider) {
    slider.disabled = !enabled;
    slider.value = String(value);
    slider.title = enabled ? "" : "check an accent first";
  }
}

function renderCorpusControls(): void {
  const root = $("#corpus-controls");
  if (!root) return;
  root.innerHTML = "";

  if (state.editing) {
    const g = el("div", { class: "group" });
    g.appendChild(el("div", {
      class: "tray-note",
      "data-corpus-edit-note": "",
      role: "status",
    }, "editing — changes are yours, scores off"));
    const actions = el("div", { class: "canvas-actions" });
    const exit = el("button", { type: "button", class: "ghost" }, "Exit") as HTMLButtonElement;
    exit.addEventListener("click", () => exitCorpusEditor());
    const save = el("button", { type: "button", class: "primary" }, "Save") as HTMLButtonElement;
    save.addEventListener("click", () => saveCorpusEditor());
    actions.append(exit, save);
    g.appendChild(actions);
    root.appendChild(g);
    return;
  }

  const group = (title: string, actions?: HTMLElement): HTMLElement => {
    const g = el("div", { class: "group" });
    const head = el("div", { class: "group-head" });
    head.appendChild(el("h3", {}, title));
    if (actions) head.appendChild(actions);
    g.appendChild(head);
    root.appendChild(g);
    return g;
  };

  const appendControlRow = (parent: HTMLElement, labelText: string, control: HTMLElement): void => {
    const row = el("div", { class: "row" });
    row.appendChild(el("label", {}, labelText));
    row.appendChild(control);
    parent.appendChild(row);
  };

  // Size
  {
    const g = group("Size");
    const chips = el("div", { class: "chips size-chips", role: "group", "aria-label": "Size" });
    for (const id of Object.keys(ARRANGEMENTS) as ArrangementId[]) {
      const active = id === (state.config.arrangement || "banner");
      const chip = el(
        "button",
        {
          type: "button",
          class: `chip${active ? " on" : ""}`,
          "data-corpus-arrangement": id,
          "aria-pressed": String(active),
        },
        ARRANGEMENT_LABELS[id] ?? id,
      ) as HTMLButtonElement;
      chip.addEventListener("click", () => {
        state.config.arrangement = id === "banner" ? "" : id;
        for (const other of chips.querySelectorAll<HTMLButtonElement>(".chip")) {
          const on = other === chip;
          other.classList.toggle("on", on);
          other.setAttribute("aria-pressed", String(on));
        }
        corpusRegen(false, false);
      });
      chips.appendChild(chip);
    }
    g.appendChild(chips);
  }

  // Color
  {
    const presets = el("div", { class: "group-actions", "data-corpus-accent-presets": "" });
    const nonePreset = el("button", { type: "button", class: "text-preset", "data-corpus-accent-none": "" }, "none");
    nonePreset.addEventListener("click", () => {
      state.config.accentPool = [];
      updateAccentSwatchState();
      if (state.current) corpusRecolorInPlace(); else corpusRegen(false, false);
    });
    const allPreset = el("button", { type: "button", class: "text-preset", "data-corpus-accent-all": "" }, "all");
    allPreset.addEventListener("click", () => {
      state.config.accentPool = [...ACCENT_HEXES];
      updateAccentSwatchState();
      if (state.current) corpusRecolorInPlace(); else corpusRegen(false, false);
    });
    presets.appendChild(nonePreset);
    presets.appendChild(allPreset);

    const g = group("Color", presets);
    const sel = el("select", { "data-corpus-program": "" }) as HTMLSelectElement;
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto";
    sel.appendChild(auto);
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
      updateAccentSwatchState();
      corpusRegen(false, false);
    });
    appendControlRow(g, "Program", sel);

    const swatches = el("div", { class: "accent-swatches", role: "group", "aria-label": "Accents" });
    for (const [name, hex] of ACCENT_OPTIONS) {
      const swatch = el(
        "button",
        {
          type: "button",
          class: "accent-swatch",
          "data-corpus-accent": hex,
          "data-accent-name": name,
          "aria-label": `${name} ${hex}`,
          "aria-pressed": "false",
          title: `${name} ${hex}`,
        },
      ) as HTMLButtonElement;
      swatch.style.backgroundColor = hex;
      swatch.style.setProperty("--check-color", SMOKE_WHITE_CHECK_HEXES.has(hex) ? "#F3F3F3" : "#121212");
      swatch.addEventListener("click", () => {
        if (state.config.program) return;
        const selected = new Set(state.config.accentPool);
        if (selected.has(hex)) selected.delete(hex);
        else selected.add(hex);
        state.config.accentPool = ACCENT_HEXES.filter((accent) => selected.has(accent));
        updateAccentSwatchState();
        if (state.current) corpusRecolorInPlace(); else corpusRegen(false, false);
      });
      swatches.appendChild(swatch);
    }
    g.appendChild(swatches);
    g.appendChild(el("div", { class: "accent-caption", "data-corpus-accent-caption": "" }, accentCaption()));
    const amountRow = el("div", { class: "row accent-amount-row", "data-corpus-accent-strength-row": "" });
    const amountLabel = el("label", { "data-corpus-accent-strength-label": "" }, accentStrengthLabelText());
    const amountSlider = el("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      value: String(effectiveAccentStrength()),
      "data-corpus-accent-strength": "",
    }) as HTMLInputElement;
    amountSlider.addEventListener("input", () => {
      amountLabel.textContent = accentStrengthLabelText(Number(amountSlider.value));
    });
    amountSlider.addEventListener("change", () => {
      state.config.accentStrength = Number(amountSlider.value);
      amountLabel.textContent = accentStrengthLabelText(state.config.accentStrength);
      corpusRegen(false, false);
    });
    amountRow.appendChild(amountLabel);
    amountRow.appendChild(amountSlider);
    g.appendChild(amountRow);
    updateAccentSwatchState();
  }

  // Pattern
  {
    const g = group("Pattern");
    const template = el("select", { "data-corpus-template": "" }) as HTMLSelectElement;
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Auto";
    template.appendChild(auto);
    for (const id of TEMPLATE_IDS) {
      const o = document.createElement("option");
      o.value = id;
      o.textContent = id;
      if (id === state.config.template) o.selected = true;
      template.appendChild(o);
    }
    template.addEventListener("change", () => {
      state.config.template = template.value;
      corpusRegen(false, false);
    });
    appendControlRow(g, "Template", template);

    const row = el("div", { class: "row" });
    const label = el("label", {}, `Density: ${state.config.density.toFixed(2)}`);
    const slider = el("input", {
      type: "range", min: "0", max: "1", step: "0.01",
      value: String(state.config.density),
      "data-corpus-density": "",
    }) as HTMLInputElement;
    // Show live value on input (no regen); regenerate only on change (pointer-up)
    slider.addEventListener("input", () => {
      label.textContent = `Density: ${Number(slider.value).toFixed(2)}`;
    });
    slider.addEventListener("change", () => {
      state.config.density = Number(slider.value);
      label.textContent = `Density: ${state.config.density.toFixed(2)}`;
      corpusRegen(false, false);
    });
    row.appendChild(label);
    row.appendChild(slider);
    g.appendChild(row);

    const chip = el(
      "button",
      {
        type: "button",
        class: `chip${state.config.figures ? " on" : ""}`,
        "aria-pressed": String(state.config.figures),
      },
      "figures",
    ) as HTMLButtonElement;
    chip.addEventListener("click", () => {
      state.config.figures = !state.config.figures;
      chip.classList.toggle("on", state.config.figures);
      chip.setAttribute("aria-pressed", String(state.config.figures));
      corpusRegen(false, false);
    });
    appendControlRow(g, "Figures", chip);
  }

  // Seed
  {
    const g = group("Seed");
    const row = el("div", { class: "seed-row seed-row--hist" });
    const backBtn = el("button", {
      class: "chip",
      title: "previous (← key)",
      "data-corpus-hist-back": "",
      style: "width:32px; padding:0",
    }, "‹") as HTMLButtonElement;
    backBtn.disabled = historyPtr <= 0;
    backBtn.addEventListener("click", () => historyWalk(-1));

    const inp = el("input", {
      type: "text",
      readonly: "",
      "data-corpus-seed": "",
      value: String(state.current?.seed ?? state.config.seed),
    }) as HTMLInputElement;

    const fwdBtn = el("button", {
      class: "chip",
      title: "next (→ key)",
      "data-corpus-hist-fwd": "",
      style: "width:32px; padding:0",
    }, "›") as HTMLButtonElement;
    fwdBtn.disabled = historyPtr >= history.length - 1;
    fwdBtn.addEventListener("click", () => historyWalk(1));

    const copyBtn = el("button", { class: "chip", title: "copy seed", style: "width:44px" }, "copy");
    copyBtn.addEventListener("click", () => {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(inp.value).catch(() => {});
      }
    });
    row.appendChild(backBtn);
    row.appendChild(inp);
    row.appendChild(fwdBtn);
    row.appendChild(copyBtn);
    g.appendChild(row);

    // Hint line under Seed group
    const hint = el("div", {
      class: "corpus-hist-hint",
      "data-corpus-history-hint": "",
    }, "‹ › history · space reroll · S save · E edit");
    g.appendChild(hint);
  }
}

// ── mount / unmount ───────────────────────────────────────────────────────────

export interface CorpusModeOptions {
  flash: (msg: string, isError?: boolean) => void;
  /** Called when the user saves a corpus result to the tray. */
  onSave?: (config: CorpusSaveConfig, seed: number) => void;
}

let onSaveFn: ((config: CorpusSaveConfig, seed: number) => void) | null = null;

function beginCorpusEdit(): void {
  if (!state.current || state.editing) return;
  state.preEdit = state.current;
  state.editing = true;
  renderCorpusControls();
  renderCorpusScores();
  enterCorpusEdit(state.current.plan, {
    flash,
    onExit: () => {
      state.editing = false;
      if (state.preEdit) state.current = state.preEdit;
      state.preEdit = null;
      renderCorpusControls();
      renderCorpusCanvas();
      renderCorpusVariations();
      renderCorpusScores();
      updateSeedDisplay();
    },
    onSavePlan: (plan) => {
      if (!state.current || !onSaveFn) return;
      onSaveFn({
        ...buildCorpusConfig(),
        edited: true,
        plan: structuredClone(plan),
      }, state.current.seed);
    },
  });
}

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
  config: CorpusSaveConfig,
  seed: number,
): import("../engine/corpus/index.js").CorpusResult {
  if (isEditedCorpusConfig(config)) return editedResultFromPlan(config, seed);
  return generateBanner({ ...config, seed });
}

/** Restore a previously saved corpus item — used by the save tray. */
export function openCorpusItem(config: CorpusSaveConfig, seed: number): void {
  try {
    if (isEditedCorpusConfig(config)) {
      state.config = {
        template: config.template ?? "",
        accentPool: migrateAccentPool(config),
        accentStrength: normalizeAccentStrength(config.accentStrength),
        density: config.density ?? 0.5,
        figures: config.figures ?? true,
        seed,
        program: config.program ?? "",
        arrangement: config.arrangement ?? "",
      };
      saveCorpusConfig();
      state.editing = false;
      state.preEdit = null;
      state.current = editedResultFromPlan(config, seed);
      state.vars = [];
      renderCorpusCanvas();
      renderCorpusVariations();
      updateSeedDisplay();
      renderCorpusScores();
      renderCorpusControls();
      return;
    }
    state.config = {
      template: config.template ?? "",
      accentPool: migrateAccentPool(config),
      accentStrength: normalizeAccentStrength(config.accentStrength),
      density: config.density ?? 0.5,
      figures: config.figures ?? true,
      seed,
      program: config.program ?? "",
      arrangement: config.arrangement ?? "",
    };
    saveCorpusConfig();
    state.current = generateBanner(buildCorpusConfig());
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
  if (corpusEditorActive()) exitCorpusEditor(true);
  state.editing = false;
  state.preEdit = null;
  flashFn = null;
  const root = $("#corpus-controls");
  if (root) root.innerHTML = "";
  const scores = $("#corpus-scores");
  if (scores) scores.innerHTML = "";
}

// ── keyboard hook (called from main.ts when corpus is active) ────────────────
// Returns true if the key was handled (caller should preventDefault).

export function corpusKeydown(code: string): boolean {
  if (state.editing) return false;
  // Guard: if the sheet overlay is open, it owns ArrowLeft/Right/Enter/Escape
  // and KeyE — do not let the main keydown handler act on those keys while it
  // is visible.  main.ts's listener is registered before the overlay's, so
  // stopPropagation/stopImmediatePropagation in the overlay handler runs too
  // late; the guard here is the only reliable interception point.
  const overlayOpen = !!document.querySelector("[data-corpus-sheet-overlay]");
  if (overlayOpen) return false;
  if (code === "ArrowLeft") { historyWalk(-1); return true; }
  if (code === "ArrowRight") { historyWalk(1); return true; }
  if (code === "KeyS") {
    // S = save
    if (!state.current || !onSaveFn) return false;
    onSaveFn(state.current.config, state.current.seed);
    flash("Saved to the tray below.");
    return true;
  }
  if (code === "KeyE") {
    beginCorpusEdit();
    return true;
  }
  return false;
}

// ── spacebar hook (called from main.ts when corpus is active) ─────────────────

export function corpusSpacebarReroll(): void {
  if (state.editing) return;
  // Same guard as corpusKeydown: a reroll behind the open Sheet ×12 overlay
  // would silently replace state.current and stale the overlay's cells.
  if (document.querySelector("[data-corpus-sheet-overlay]")) return;
  if (!state.current) return;
  if (isEditedCorpusConfig(state.current.config)) {
    // Edited configs must not be spread into fresh generations — rebuild a
    // clean config from the current panel state with an incremented seed.
    state.config.seed = state.current.seed + 1;
    state.current = generateBanner(buildCorpusConfig());
  } else {
    state.current = engineReroll(state.current);
    state.config.seed = state.current.seed;
  }
  state.vars = engineVariations(state.current, 6);
  historyPush(state.current);
  renderCorpusCanvas();
  renderCorpusVariations();
  updateSeedDisplay();
  renderCorpusScores();
}
