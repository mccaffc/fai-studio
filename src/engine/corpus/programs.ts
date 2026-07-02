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
 */

import type { BannerPlan } from './types.js';

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
  'artificial-intelligence':{ name: 'Artificial Intelligence',   hue: '#D63A8C' },
  'energy-infrastructure':  { name: 'Energy & Infrastructure',   hue: '#268B41' },
  'science-innovation':     { name: 'Science & Innovation',      hue: '#4997D0' },
  'frontier-legal-defense': { name: 'Frontier Legal Defense',    hue: '#3A4A6B' },
};

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

/** Classic accent inks that the transform replaces with the program hue. */
const CLASSIC_ACCENTS = new Set([ORANGE, '#4997D0', '#FFA300']);

// ---------------------------------------------------------------------------
// Luminance helpers (WCAG relative luminance, no external deps)
// ---------------------------------------------------------------------------

function sRGBtoLin(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
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
 * - #FF4F00 (orange accent ground) → hue (it was an accent ground zone)
 * - any other classic accent used as ground → hue
 * - neutrals and hue → unchanged
 */
function remapGround(ground: string, hue: string): string {
  if (ground === WHITE) return SMOKE_WHITE;
  if (ground === ORANGE) return hue;            // orange accent ground → hue
  if (CLASSIC_ACCENTS.has(ground)) return hue;  // other accent as ground → hue
  // Neutral or already the program hue → unchanged
  return ground;
}

/**
 * Remap an ink value under the program palette law:
 * - any classic accent (#FF4F00 / #4997D0 / #FFA300) → hue
 * - #FFFFFF → #F3F3F3
 * - neutrals and hue → unchanged
 */
function remapInk(ink: string, hue: string): string {
  if (CLASSIC_ACCENTS.has(ink)) return hue;
  if (ink === WHITE) return SMOKE_WHITE;
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
 *     accent-as-ground → hue).
 *  2. Remap all inks (classic accents → hue; #FFFFFF → #F3F3F3).
 *  3. Contrast pass per cell:
 *     a. if ink === ground → flip ink to the neutral maximising contrast
 *     b. if hue-on-#121212 fails the 1.7 floor → remap that cell's ground to #F3F3F3
 *     c. special rule: Frontier Indigo on Cod Gray → remap ground to #F3F3F3
 *  4. Safety: assert the output contains no #FFFFFF or #FF4F00.
 *
 * Pure: deep-copies the plan and does not mutate the input.
 */
export function applyProgramPalette(plan: BannerPlan, hue: string): BannerPlan {
  // Deep-copy via JSON (all fields are JSON-serializable plain objects).
  const out: BannerPlan = JSON.parse(JSON.stringify(plan)) as BannerPlan;

  // --- Rule 1: global ground ---
  out.ground = remapGround(out.ground, hue);

  // --- Rules 1+2: cell grounds and inks ---
  for (const cell of out.cells) {
    // Ground remap
    cell.ground = remapGround(cell.ground, hue);

    // Ink remap
    if (cell.ink !== undefined) {
      cell.ink = remapInk(cell.ink, hue);
    }
    if (cell.inks !== undefined) {
      cell.inks = cell.inks.map(ink => remapInk(ink, hue));
    }
  }

  // --- Rule 3: contrast pass ---
  const hueFails121212 = hueFailsContrastOnGround(hue, COD_GRAY);
  const isFrontierIndigo = hue === PROGRAMS['frontier-legal-defense'].hue;

  for (const cell of out.cells) {
    // Rule 3c: Frontier Indigo on Cod Gray → remap ground to Smoke White
    // (explicit brand rule: dark-on-dark must not appear regardless of ratio)
    if (isFrontierIndigo && cell.ground === COD_GRAY && cell.ink === hue) {
      cell.ground = SMOKE_WHITE;
    }

    // Rule 3b: hue-as-ink on Cod Gray fails the 1.7 floor → remap ground to Smoke White
    if (hueFails121212 && cell.ground === COD_GRAY && cell.ink === hue) {
      cell.ground = SMOKE_WHITE;
    }

    // Rule 3a: ink === ground → flip ink to neutral maximising contrast
    if (cell.ink !== undefined && cell.ink === cell.ground) {
      cell.ink = neutralMaxContrast(cell.ground);
      if (cell.inks !== undefined) {
        cell.inks = [cell.ink];
      }
    }
  }

  // Also apply contrast pass to the FormGroup inks
  for (const form of out.forms) {
    form.ink = remapInk(form.ink, hue);
    if (CLASSIC_ACCENTS.has(form.ink) || form.ink === WHITE) {
      form.ink = remapInk(form.ink, hue);
    }
  }

  return out;
}
