/** FAI locked palette constants. */

export const MASTER_FILLS = {
  internationalOrange: "#FF4F00",
  codGray: "#121212",
  white: "#FFFFFF",
  smokeWhite: "#F3F3F3",
  timberwolf: "#D9D9D6",
} as const;

export const PROGRAM_HUES = {
  chromeYellow: "#FFA300",
  irisViolet: "#7150D6",
  deepTeal: "#0E8C88",
  signalGreen: "#268B41",
  celestialBlue: "#4997D0",
  frontierCrimson: "#C8102E",
} as const;

/** @deprecated Use MASTER_FILLS / PROGRAM_HUES. Kept for classic engine byte identity. */
export const BRAND = {
  ...MASTER_FILLS,
  chromeYellow: PROGRAM_HUES.chromeYellow,
  celestialBlue: PROGRAM_HUES.celestialBlue,
} as const;

export const BRAND_HEXES: readonly string[] = Object.values(BRAND);

/** @deprecated Use PROGRAM_HUES. Kept for classic engine byte identity. */
export const PROPOSAL = {
  irisViolet: PROGRAM_HUES.irisViolet,
  deepTeal: PROGRAM_HUES.deepTeal,
  signalGreen: PROGRAM_HUES.signalGreen,
  frontierCrimson: PROGRAM_HUES.frontierCrimson,
} as const;

export const PROPOSAL_HEXES: readonly string[] = Object.values(PROPOSAL);

export const WARM: ReadonlySet<string> = new Set([
  MASTER_FILLS.internationalOrange,
  PROGRAM_HUES.chromeYellow,
  PROGRAM_HUES.frontierCrimson,
]);
export const COOL: ReadonlySet<string> = new Set([
  PROGRAM_HUES.celestialBlue,
  PROGRAM_HUES.irisViolet,
  PROGRAM_HUES.signalGreen,
  PROGRAM_HUES.deepTeal,
]);
export const NEUTRAL: ReadonlySet<string> = new Set([
  MASTER_FILLS.codGray,
  MASTER_FILLS.white,
  MASTER_FILLS.smokeWhite,
  MASTER_FILLS.timberwolf,
]);

/** The classic full-mode accent palette.
 *  Index order matters: it is the accent-slot order nodes reference.
 *  Even slots warm, odd slots cool (zoning picks by parity). */
export const ALL_ACCENTS: readonly string[] = [
  MASTER_FILLS.internationalOrange, // 0 warm lead
  PROGRAM_HUES.celestialBlue, // 1 cool lead
  PROGRAM_HUES.chromeYellow, // 2 warm
  PROGRAM_HUES.irisViolet, // 3 cool
  PROGRAM_HUES.deepTeal, // 4 cool (Deep Teal — AI; ex-Telemagenta, moved warm→cool 2026-07-09)
  PROGRAM_HUES.signalGreen, // 5 cool
  MASTER_FILLS.timberwolf, // 6
  PROGRAM_HUES.frontierCrimson, // 7 warm (Frontier Crimson — FLD; ex-Frontier Indigo, cool→warm 2026-07-16)
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
