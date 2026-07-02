/**
 * helpers.ts — shared test helpers for engine-corpus tests.
 *
 * Extracted from programs.test.ts (M1: dedup assertProgramPalette).
 */

import { expect } from 'vitest';
import type { BannerPlan } from '../../src/engine/corpus/types.js';

const COD_GRAY    = '#121212';
const SMOKE_WHITE = '#F3F3F3';
const TIMBERWOLF  = '#D9D9D6';

/** Collect every fill color (ground + inks) from a BannerPlan. */
export function allFillsFromPlan(plan: BannerPlan): Set<string> {
  const fills = new Set<string>();
  fills.add(plan.ground.toUpperCase());
  for (const cell of plan.cells) {
    fills.add(cell.ground.toUpperCase());
    if (cell.ink) fills.add(cell.ink.toUpperCase());
    if (cell.inks) for (const ink of cell.inks) fills.add(ink.toUpperCase());
  }
  // M2: include form.ink values
  for (const form of plan.forms) {
    fills.add(form.ink.toUpperCase());
  }
  return fills;
}

/**
 * Assert that every fill in a BannerPlan satisfies the program palette law:
 *   fills ⊆ {#121212, #F3F3F3, #D9D9D6, hue}
 *
 * Checks both plan-level fills and form.ink values (M2).
 */
export function assertProgramPalettePlan(plan: BannerPlan, hue: string, label: string): void {
  const allowed = new Set([COD_GRAY, SMOKE_WHITE, TIMBERWOLF, hue.toUpperCase()]);
  const fills = allFillsFromPlan(plan);
  for (const fill of fills) {
    expect(allowed, `program-law violation: ${fill} in ${label}`).toContain(fill);
  }
}

/**
 * Assert that every fill/stroke hex in a rendered SVG string satisfies the
 * program palette law: ⊆ {#121212, #F3F3F3, #D9D9D6, hue}.
 */
export function assertProgramPaletteSvg(svg: string, hue: string, label: string): void {
  const allowed = new Set([COD_GRAY, SMOKE_WHITE, TIMBERWOLF, hue.toUpperCase()]);
  const hexes = svg.match(/(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g) ?? [];
  for (const attr of hexes) {
    const m = attr.match(/#[0-9A-Fa-f]{6}/)!;
    const hex = m[0].toUpperCase();
    expect(allowed, `program-law violation: ${hex} in ${label} (allowed: ${[...allowed].join(',')})`).toContain(hex);
  }
}
