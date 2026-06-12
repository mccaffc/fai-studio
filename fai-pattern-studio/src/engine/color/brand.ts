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

/** Proposal hues — extended mode only (unratified). */
export const PROPOSAL = {
  irisViolet: "#8265DB",
  telemagenta: "#D63A8C",
  signalGreen: "#268B41",
  slateIndigo: "#3A4A6B",
} as const;

export const PROPOSAL_HEXES: readonly string[] = Object.values(PROPOSAL);

export const WARM: ReadonlySet<string> = new Set([
  BRAND.internationalOrange,
  BRAND.chromeYellow,
]);
export const COOL: ReadonlySet<string> = new Set([BRAND.celestialBlue]);
export const NEUTRAL: ReadonlySet<string> = new Set([
  BRAND.codGray,
  BRAND.white,
  BRAND.smokeWhite,
  BRAND.timberwolf,
]);

/** Accent candidates (non-ground, non-white fills). */
export const ACCENT_CHOICES: readonly string[] = [
  BRAND.internationalOrange,
  BRAND.chromeYellow,
  BRAND.celestialBlue,
  BRAND.timberwolf,
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
