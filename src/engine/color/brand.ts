/** FAI brand constants — ported verbatim from scripts/fai_colors.py. */

export const BRAND = {
  internationalOrange: "#FF4F00",
  codGray: "#121212",
  white: "#FFFFFF",
  smokeWhite: "#F3F3F3",
  chromeYellow: "#FFA300",
  celestialBlue: "#4997D0",
  timberwolf: "#D9D9D6",
} as const;

export const BRAND_HEXES: readonly string[] = Object.values(BRAND);

/** Program wayfinding hues — FINAL, locked 2026-06-18 (one per policy program).
 *  Wayfinding use only (eyebrow/tag, hairline, runner, data-viz, single accent);
 *  never a master-brand ground, never recoloring the chevron. Chrome Yellow &
 *  Celestial Blue are program hues too, but live in BRAND above (the engine's
 *  warm/cool sets and isBrandHex predate the 2026 palette lock). */
export const PROGRAM = {
  electricViolet: "#8265DB", // American Governance
  telemagenta: "#D63A8C", // Artificial Intelligence
  signalGreen: "#268B41", // Energy & Infrastructure
  frontierIndigo: "#3A4A6B", // Frontier Legal Defense
} as const;

export const PROGRAM_HEXES: readonly string[] = Object.values(PROGRAM);

export const WARM: ReadonlySet<string> = new Set([
  BRAND.internationalOrange,
  BRAND.chromeYellow,
  PROGRAM.telemagenta,
]);
export const COOL: ReadonlySet<string> = new Set([
  BRAND.celestialBlue,
  PROGRAM.electricViolet,
  PROGRAM.signalGreen,
  PROGRAM.frontierIndigo,
]);
export const NEUTRAL: ReadonlySet<string> = new Set([
  BRAND.codGray,
  BRAND.white,
  BRAND.smokeWhite,
  BRAND.timberwolf,
]);

/** The full accent palette — master fills and program hues on the same level.
 *  Index order matters: it is the accent-slot order nodes reference.
 *  Even slots warm, odd slots cool (zoning picks by parity). */
export const ALL_ACCENTS: readonly string[] = [
  BRAND.internationalOrange, // 0 warm lead
  BRAND.celestialBlue, // 1 cool lead
  BRAND.chromeYellow, // 2 warm
  PROGRAM.electricViolet, // 3 cool
  PROGRAM.telemagenta, // 4 warm
  PROGRAM.signalGreen, // 5 cool
  BRAND.timberwolf, // 6
  PROGRAM.frontierIndigo, // 7
];

function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio. */
export function contrast(a: string, b: string): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function isBrandHex(hex: string): boolean {
  return BRAND_HEXES.includes(hex.toUpperCase());
}
