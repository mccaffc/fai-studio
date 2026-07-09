/**
 * programs.ts — program palette engine for the corpus banner system.
 *
 * Defines the 6 FAI program hues (LOCKED brand values) and implements
 * applyProgramPalette: a deterministic, pure transform that remaps a sampled
 * BannerPlan to the program-banner palette law:
 *   fills ⊆ {#121212, #F3F3F3, #D9D9D6, programHue}
 *   never #FFFFFF, never #FF4F00, never a second accent.
 *
 * Zero-dependency: no node:* builtins, no filesystem, no wall-clock,
 * no nondeterministic randomness. Engine-safe and browser-safe.
 *
 * ## prevHue reclaim (C1)
 * applyProgramPalette accepts an optional `prevHue` parameter. When provided,
 * remapInk/remapGround will also map prevHue → hue, so that a plan previously
 * transformed with h1 can be re-transformed to h2 without h1 leaking through.
 * This is used by recolorPlan's program-swap path; generateBanner passes no
 * prevHue (fresh corpus plans, no prior hue to reclaim).
 */

import { DEFAULT_ACCENT_STRENGTH, type BannerPlan, type SampleKnobs } from './types.js';

// ---------------------------------------------------------------------------
// Program registry (LOCKED brand values — exact)
// ---------------------------------------------------------------------------

export type ProgramId =
  | 'technology-statecraft'
  | 'american-governance'
  | 'artificial-intelligence'
  | 'energy-infrastructure'
  | 'science-innovation'
  | 'frontier-legal-defense';

export const PROGRAMS: Record<ProgramId, { name: string; hue: string }> = {
  'technology-statecraft':  { name: 'Technology & Statecraft',  hue: '#FFA300' },
  'american-governance':    { name: 'American Governance',       hue: '#8265DB' },
  'artificial-intelligence':{ name: 'Artificial Intelligence',   hue: '#0E8C88' },
  'energy-infrastructure':  { name: 'Energy & Infrastructure',   hue: '#268B41' },
  'science-innovation':     { name: 'Science & Innovation',      hue: '#4997D0' },
  'frontier-legal-defense': { name: 'Frontier Legal Defense',    hue: '#3A4A6B' },
};

/** Program-mode shape identity multiplier for mapped corpus tile families.
 *  Calibrated at the P8 greyscale gate: 3 left ~half of program plans without
 *  a mapped dominant family (T&S unrecognizable without its hue); 8 makes the
 *  mapped families carry the sheet while non-mapped tiles stay reachable. */
export const PROGRAM_FAMILY_BIAS = 8;

/** Program-mode template-register multiplier for mapped corpus templates.
 *  Calibrated at the P9 greyscale gate: 5 left T&S and Energy at 4/6 blind
 *  nameability (off-template leak seeds trading each other's stripe register);
 *  9 closes the leak while unmapped templates stay reachable. */
export const PROGRAM_TEMPLATE_BIAS = 9;

/** Program-mode minimum mapped-family share in the working tile set. */
export const PROGRAM_FAMILY_FLOOR = 0.6;

/** Chris/controller-curated program identity map to corpus tile families. */
export const PROGRAM_FAMILY_MAP: Record<ProgramId, readonly string[]> = {
  'technology-statecraft': ['lines', 'rectangle'],
  'american-governance': ['curve', 'ramp', 'cascade'],
  'artificial-intelligence': ['float', 'merge'],
  'energy-infrastructure': ['wave'],
  'science-innovation': ['circle', 'centric'],
  'frontier-legal-defense': ['square', 'angle', 'joint'],
};

/** Chris/controller-curated program identity map to corpus template registers. */
export const PROGRAM_TEMPLATE_MAP: Record<ProgramId, readonly string[]> = {
  'technology-statecraft': ['repeat-rhythm', 'pipe-field'],
  'american-governance': ['pipe-field', 'figure-field'],
  'artificial-intelligence': ['figure-field', 'mixed-quilt'],
  'energy-infrastructure': ['pipe-field'],
  'science-innovation': ['arc-mosaic', 'checker-motif'],
  'frontier-legal-defense': ['checker-motif', 'repeat-rhythm'],
};

/**
 * Shared program-knob helper — single source of truth for the three program
 * shape-identity knobs (familyBias, templateBias, familyFloor) plus the forced
 * accent hue. Both index.ts (generateBanner) and tools/grammar/render-samples.ts
 * consume this; behavior is byte-identical to the per-caller inline blocks they
 * replaced.
 */
export function programSampleKnobs(program: ProgramId): Pick<SampleKnobs, 'familyBias' | 'templateBias' | 'familyFloor' | 'accentStrength'> & { accent: string } {
  return {
    accent: PROGRAMS[program].hue,
    accentStrength: DEFAULT_ACCENT_STRENGTH,
    familyBias: { families: PROGRAM_FAMILY_MAP[program], multiplier: PROGRAM_FAMILY_BIAS },
    templateBias: { ids: PROGRAM_TEMPLATE_MAP[program], multiplier: PROGRAM_TEMPLATE_BIAS },
    familyFloor: { families: PROGRAM_FAMILY_MAP[program], minShare: PROGRAM_FAMILY_FLOOR },
  };
}

// ---------------------------------------------------------------------------
// Palette constants
// ---------------------------------------------------------------------------

const COD_GRAY    = '#121212';
const SMOKE_WHITE = '#F3F3F3';
const TIMBERWOLF  = '#D9D9D6';
const WHITE       = '#FFFFFF';
const ORANGE      = '#FF4F00';

/** The 3 program-mode neutral fills (no #FFFFFF). */
const PROGRAM_NEUTRALS = new Set([COD_GRAY, SMOKE_WHITE, TIMBERWOLF]);

/** Locked accent-pool fills that the transform replaces with the program hue. */
const ACCENT_POOL = new Set([ORANGE, '#FFA300', '#8265DB', '#0E8C88', '#268B41', '#4997D0', '#3A4A6B']);

// ---------------------------------------------------------------------------
// Luminance helpers (WCAG relative luminance, no external deps)
// ---------------------------------------------------------------------------

function sRGBtoLin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * sRGBtoLin(r) + 0.7152 * sRGBtoLin(g) + 0.0722 * sRGBtoLin(b);
}

/**
 * WCAG-ish contrast ratio between two colors.
 * Returns (lighter + 0.05) / (darker + 0.05).
 */
export function lumRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker  = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Contrast floor check
// ---------------------------------------------------------------------------

const CONTRAST_FLOOR = 1.7;

/**
 * True if programHue-as-ink on the given ground fails the 1.7 contrast floor.
 * A failing pair requires the ground to be remapped to SMOKE_WHITE.
 */
export function hueFailsContrastOnGround(hue: string, ground: string): boolean {
  return lumRatio(hue, ground) < CONTRAST_FLOOR;
}

// ---------------------------------------------------------------------------
// Ground remapping helpers
// ---------------------------------------------------------------------------

/**
 * Remap a single ground value under the program palette law:
 * - #FFFFFF → #F3F3F3
 * - #FF4F00 (orange accent ground) → hue
 *   Unconditional remapping is safe: #FF4F00 can only appear as a ground value
 *   via the sampler's accent-zone 'ground' mode, which exclusively draws from
 *   grammar.palette.accentOrder (corpus accents). There is no code path in
 *   sample.ts that produces #FF4F00 as a non-zone ground. See sample.ts
 *   applyAccentZoning / 'ground' branch.
 * - any other locked accent-pool fill used as ground → hue
 * - prevHue (prior program hue being replaced) → hue
 * - neutrals and current hue → unchanged
 */
function remapGround(ground: string, hue: string, prevHue?: string): string {
  if (ground === WHITE) return SMOKE_WHITE;
  if (ground === ORANGE) return hue;            // orange accent ground → hue
  if (ACCENT_POOL.has(ground)) return hue;      // other accent-pool ground → hue
  if (prevHue && ground === prevHue) return hue; // reclaim prior program hue (C1)
  // Neutral or already the program hue → unchanged
  return ground;
}

/**
 * Remap an ink value under the program palette law:
 * - any locked accent-pool ink → hue
 * - #FFFFFF → #F3F3F3
 * - prevHue (prior program hue being replaced) → hue
 * - neutrals and current hue → unchanged
 */
function remapInk(ink: string, hue: string, prevHue?: string): string {
  if (ACCENT_POOL.has(ink)) return hue;
  if (ink === WHITE) return SMOKE_WHITE;
  if (prevHue && ink === prevHue) return hue;   // reclaim prior program hue (C1)
  return ink;
}

/**
 * Choose the neutral that maximizes contrast against the given ground.
 * Returns whichever of COD_GRAY / SMOKE_WHITE / TIMBERWOLF has the highest
 * contrast ratio against ground, excluding ground itself.
 */
function neutralMaxContrast(ground: string): string {
  const neutrals = [COD_GRAY, SMOKE_WHITE, TIMBERWOLF].filter(n => n !== ground);
  let best = neutrals[0] ?? COD_GRAY;
  let bestRatio = lumRatio(best, ground);
  for (const n of neutrals.slice(1)) {
    const r = lumRatio(n, ground);
    if (r > bestRatio) { bestRatio = r; best = n; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// applyProgramPalette — the public transform
// ---------------------------------------------------------------------------

/**
 * Apply the program palette law to `plan`, returning a deep-copied BannerPlan
 * with all accents remapped to `hue` and no #FFFFFF / #FF4F00 anywhere.
 *
 * Transform rules (deterministic, in order):
 *  1. Remap global ground and all cell grounds (#FFFFFF→#F3F3F3,
 *     accent-as-ground → hue, prevHue-as-ground → hue).
 *  2. Remap all inks (locked accent-pool fills → hue; #FFFFFF → #F3F3F3;
 *     prevHue → hue when provided).
 *  3. Contrast pass per cell (3a before 3b):
 *     a. if ink === ground → flip ink to the neutral maximising contrast
 *     b. dual-floor dark rule: remap ground to #F3F3F3 when
 *        hue-ink-on-ground contrast < 1.7 OR both hue and ground have
 *        relative luminance < 0.10 ("both-dark" rule).
 *  4. Safety: assert the output satisfies the palette law
 *     (fills ⊆ {#121212, #F3F3F3, #D9D9D6, hue}); throws on violation
 *     (deterministic inputs → a throw here is a code bug, not user error).
 *
 * @param plan   Source plan (not mutated — pure function, deep-copies internally).
 * @param hue    Target program hue (e.g. '#8265DB').
 * @param prevHue Prior program hue to reclaim from the plan (C1: prevents
 *               h1→h2 re-transforms from leaving h1 cells behind). Omit when
 *               transforming a fresh corpus plan (generateBanner path).
 */
export function applyProgramPalette(plan: BannerPlan, hue: string, prevHue?: string): BannerPlan {
  // Deep-copy via JSON (all fields are JSON-serializable plain objects).
  const out: BannerPlan = JSON.parse(JSON.stringify(plan)) as BannerPlan;

  // --- Rule 1: global ground ---
  out.ground = remapGround(out.ground, hue, prevHue);

  // --- Rules 1+2: cell grounds and inks ---
  for (const cell of out.cells) {
    // Ground remap
    cell.ground = remapGround(cell.ground, hue, prevHue);

    // Ink remap
    if (cell.ink !== undefined) {
      cell.ink = remapInk(cell.ink, hue, prevHue);
    }
    if (cell.inks !== undefined) {
      cell.inks = cell.inks.map(ink => remapInk(ink, hue, prevHue));
    }
  }

  // --- Rule 2: FormGroup inks ---
  // (I3: dead double-remap removed — single remapInk call only)
  for (const form of out.forms) {
    form.ink = remapInk(form.ink, hue, prevHue);
  }

  // --- Rule 3: contrast pass (3a before 3b — spec ordering) ---
  //
  // Rule 3b — dual-floor dark rule (I2):
  //   Remap ground to SMOKE_WHITE when the cell has hue-as-ink AND either:
  //   (a) contrast ratio of hue-on-ground < 1.7 (numeric floor fails), OR
  //   (b) both hue and ground have relative luminance < 0.10 ("both-dark" rule)
  //
  // The both-dark threshold 0.10 catches FLD (#3A4A6B, lum≈0.069) on CodGray
  // (#121212, lum≈0.006). FLD's ratio (~2.12) passes the numeric floor, so only
  // the both-dark rule fires — preserving the brand intent that FLD must never
  // appear as dark-ink-on-dark-ground. No other current program hue has
  // lum < 0.10 (next lowest: energy-infrastructure lum≈0.193), so the threshold
  // does not change behavior for any other hue/ground pair.
  //
  // Verified 6×3 matrix (✗ = triggers ground→SmokeWhite remap):
  //   technology-statecraft #FFA300:  CodGray 9.36 ✓  SmokeWhite 1.80 ✓  Timberwolf 1.42 ✗(floor)
  //   american-governance   #8265DB:  CodGray 4.31 ✓  SmokeWhite 3.92 ✓  Timberwolf 3.07 ✓
  //   artificial-intelligence #0E8C88: CodGray 4.57 ✓  SmokeWhite 3.69 ✓  Timberwolf 2.90 ✓
  //   energy-infrastructure  #268B41: CodGray 4.33 ✓  SmokeWhite 3.90 ✓  Timberwolf 3.06 ✓
  //   science-innovation     #4997D0: CodGray 5.91 ✓  SmokeWhite 2.86 ✓  Timberwolf 2.24 ✓
  //   frontier-legal-defense #3A4A6B: CodGray ✗(both-dark) SmokeWhite 7.98 ✓ Timberwolf 6.26 ✓
  const HUE_LUM = relativeLuminance(hue);

  for (const cell of out.cells) {
    // Rule 3a: ink === ground → flip ink to neutral maximising contrast
    if (cell.ink !== undefined && cell.ink === cell.ground) {
      cell.ink = neutralMaxContrast(cell.ground);
      if (cell.inks !== undefined) {
        cell.inks = [cell.ink];
      }
    }

    // Rule 3b: dual-floor dark rule — applies only when hue is the ink
    if (cell.ink === hue) {
      const groundLum = relativeLuminance(cell.ground);
      const bothDark = HUE_LUM < 0.10 && groundLum < 0.10;
      if (lumRatio(hue, cell.ground) < CONTRAST_FLOOR || bothDark) {
        cell.ground = SMOKE_WHITE;
      }
    }
  }

  // --- Rule 4: palette-law assertion (M2: includes form.ink values) ---
  // Fail loud: deterministic inputs mean a violation is always a code bug.
  const allowed = new Set([COD_GRAY, SMOKE_WHITE, TIMBERWOLF, hue.toUpperCase()]);
  function assertFill(fill: string, ctx: string): void {
    if (!allowed.has(fill.toUpperCase())) {
      throw new Error(
        `applyProgramPalette: palette-law violation — ${fill} in ${ctx} (allowed: ${[...allowed].join(', ')})`,
      );
    }
  }
  assertFill(out.ground, 'global ground');
  for (const cell of out.cells) {
    assertFill(cell.ground, `cell(${cell.col},${cell.row}).ground`);
    if (cell.ink !== undefined) assertFill(cell.ink, `cell(${cell.col},${cell.row}).ink`);
    if (cell.inks !== undefined) {
      for (const ink of cell.inks) assertFill(ink, `cell(${cell.col},${cell.row}).inks[]`);
    }
  }
  // M2: assert form.ink values as well
  for (const form of out.forms) {
    assertFill(form.ink, `form(${form.id}).ink`);
  }

  return out;
}
