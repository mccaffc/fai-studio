/**
 * Color-mode state machine. Each mode is a pure function of its own option
 * subset → ResolvedPalette. There is no shared accent state, so the legacy
 * "vertical hex leaks into full mode" bug is structurally impossible.
 *
 * Modes (per Chris, June 2026): duotone = pure black & white; vertical =
 * b&w + ONE chosen accent (any hex); full = the whole palette — brand fills
 * and proposal hues on the same level.
 */
import type { ColorConfig, ColorMode, ResolvedPalette } from "../types";
import { ALL_ACCENTS, BRAND } from "./brand";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const MODES: readonly ColorMode[] = ["duotone", "vertical", "full"];

export function resolvePalette(c: ColorConfig): ResolvedPalette {
  const ground = BRAND.codGray;
  const ink = BRAND.smokeWhite; // composed surfaces never use pure white (house rule)
  switch (c.mode) {
    case "duotone":
      return { ground, ink, accents: [], ui: { accentPicker: false } };
    case "vertical": {
      const accent = (c.accent ?? BRAND.internationalOrange).toUpperCase();
      if (!HEX_RE.test(accent)) throw new Error(`bad accent hex ${accent}`);
      return { ground, ink, accents: [accent], ui: { accentPicker: true } };
    }
    case "full":
      return { ground, ink, accents: [...ALL_ACCENTS], ui: { accentPicker: false } };
  }
}

/** Null out color fields the active mode does not own (the leak fix), and
 *  coerce unknown modes (e.g. saved configs from older versions) to full. */
export function normalizeColor(c: ColorConfig): ColorConfig {
  const mode: ColorMode = MODES.includes(c.mode) ? c.mode : "full";
  return {
    mode,
    accent: mode === "vertical" ? (c.accent ?? null) : null,
  };
}
