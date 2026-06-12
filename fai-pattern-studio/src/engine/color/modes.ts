/**
 * Color-mode state machine. Each mode is a pure function of its own option
 * subset → ResolvedPalette. There is no shared accent state, so the legacy
 * "vertical hex leaks into full mode" bug is structurally impossible.
 */
import type { ColorConfig, ResolvedPalette } from "../types";
import {
  ACCENT_CHOICES,
  BRAND,
  PROPOSAL_HEXES,
  isBrandHex,
} from "./brand";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function resolvePalette(c: ColorConfig): ResolvedPalette {
  const ground = BRAND.codGray;
  const ink = BRAND.smokeWhite; // composed surfaces never use pure white (house rule)
  switch (c.mode) {
    case "duotone": {
      // ground + white + ONE accent — any brand color (default International Orange)
      const accent = (c.accent ?? BRAND.internationalOrange).toUpperCase();
      if (!isBrandHex(accent)) {
        throw new Error(`duotone accent must be a brand color, got ${accent}`);
      }
      return {
        ground,
        ink,
        accents: [accent],
        ui: { accentPicker: true, customHex: false },
      };
    }
    case "vertical": {
      // ground + white + ONE accent — any hex, but unratified requires the proposal gate
      const accent = (c.accent ?? BRAND.celestialBlue).toUpperCase();
      if (!HEX_RE.test(accent)) throw new Error(`bad hex ${accent}`);
      if (!isBrandHex(accent) && !c.allowProposal) {
        throw new Error(
          "unratified accent hexes are proposal-work — allowProposal required",
        );
      }
      return {
        ground,
        ink,
        accents: [accent],
        ui: { accentPicker: true, customHex: true },
      };
    }
    case "full":
      // all brand fills, multi-accent, NO forced single accent
      return {
        ground,
        ink,
        accents: [...ACCENT_CHOICES],
        ui: { accentPicker: false, customHex: false },
      };
    case "extended": {
      if (!c.allowProposal) {
        throw new Error("extended mode uses proposal hues — allowProposal required");
      }
      // proposal hue in the reachable third role slot so extended is visibly
      // different from full
      const [warm, cool, ...rest] = ACCENT_CHOICES;
      return {
        ground,
        ink,
        accents: [warm!, cool!, ...PROPOSAL_HEXES, ...rest],
        ui: { accentPicker: false, customHex: false },
      };
    }
  }
}

/** Null out color fields the active mode does not own (the leak fix).
 *  Duotone additionally drops non-brand accents (e.g. a stale custom vertical
 *  hex) instead of letting resolvePalette throw on a leak. */
export function normalizeColor(c: ColorConfig): ColorConfig {
  let accent: string | null = null;
  if (c.mode === "vertical") accent = c.accent ?? null;
  if (c.mode === "duotone") {
    accent = c.accent && isBrandHex(c.accent) ? c.accent : null;
  }
  return {
    mode: c.mode,
    accent,
    allowProposal: c.allowProposal ?? false,
  };
}
