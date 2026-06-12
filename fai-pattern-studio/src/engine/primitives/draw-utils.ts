/** Path helpers — all geometry in 0..200 cell space. */

/** Quarter annulus ring centered at a corner. corner: which cell corner is the ring center. */
export function qring(
  corner: "tl" | "tr" | "bl" | "br",
  r1: number,
  r2: number,
): string {
  // Build for center (200,0) [tr]: outer arc from (200-r2,0) to (200,r2),
  // line in to inner radius, inner arc back.
  const path = `M${200 - r2} 0 A${r2} ${r2} 0 0 0 200 ${r2} L200 ${r1} A${r1} ${r1} 0 0 1 ${200 - r1} 0 Z`;
  return cornered(path, corner, "tr");
}

/** Solid quarter disc centered at a corner. */
export function qdisc(corner: "tl" | "tr" | "bl" | "br", r: number): string {
  const path = `M${200 - r} 0 A${r} ${r} 0 0 0 200 ${r} L200 0 Z`;
  return cornered(path, corner, "tr");
}

/** Wrap a path built for `built` corner so it appears at `want` corner. */
function cornered(
  d: string,
  want: "tl" | "tr" | "bl" | "br",
  built: "tr",
): string {
  void built;
  const t = {
    tr: "",
    tl: ' transform="matrix(-1,0,0,1,200,0)"',
    br: ' transform="matrix(1,0,0,-1,0,200)"',
    bl: ' transform="matrix(-1,0,0,-1,200,200)"',
  }[want];
  return `<path d="${d}" fill="INK"${t}/>`;
}

export function rect(x: number, y: number, w: number, h: number, fill = "INK"): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

export function circle(cx: number, cy: number, r: number, fill = "INK"): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

export function poly(points: Array<[number, number]>, fill = "INK"): string {
  return `<polygon points="${points.map((p) => p.join(",")).join(" ")}" fill="${fill}"/>`;
}

export function path(d: string, fill = "INK"): string {
  return `<path d="${d}" fill="${fill}"/>`;
}

/**
 * The shared stripe system (from the legacy Lines family):
 * bands 20 wide on a 40 pitch. Phase A bands: [20,40],[60,80]..[180,200].
 */
export const BAND = 20;
export const PITCH = 40;
export const PHASE_A = [20, 60, 100, 140, 180] as const;

/** Vertical phase-A stripe field (connects to bars/bend ports). */
export function stripesV(): string {
  return PHASE_A.map((x) => rect(x, 0, BAND, 200)).join("");
}
