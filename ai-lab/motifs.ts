// Self-contained FOCAL motifs — registered as real engine primitives so they
// render through the engine and could graduate into the studio's primitive set.
// Drawn in 0..200 cell space; "INK" → node.color, "GROUND" → node.ground (the
// engine substitutes both). Two-tone, like every FAI tile. Place at span 2–3.
import { register } from "../src/engine/primitives/registry";

const motif = (key: string, category: any, draw: () => string) =>
  register({ key, category, focal: true, draw });

motif("motif/eye", "discs", () =>
  `<circle cx="100" cy="100" r="94" fill="INK"/><circle cx="100" cy="100" r="66" fill="GROUND"/><circle cx="100" cy="100" r="30" fill="INK"/>`);

motif("motif/iris", "discs", () => {
  let s = ""; for (let i = 0; i < 6; i++) s += `<circle cx="100" cy="100" r="${94 - i * 15}" fill="${i % 2 ? "GROUND" : "INK"}"/>`; return s;
});

motif("motif/sunrise", "arcs", () => {
  let s = ""; for (let i = 0; i < 7; i++) { const r = 98 - i * 13; s += `<path d="M${100 - r} 134 A${r} ${r} 0 0 1 ${100 + r} 134 Z" fill="${i % 2 ? "GROUND" : "INK"}"/>`; } return s;
});

motif("motif/rays", "discs", () => {
  let s = `<circle cx="100" cy="100" r="24" fill="INK"/>`; const n = 16;
  for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI, a2 = (i + 0.5) / n * 2 * Math.PI; const p = (r: number, x: number) => `${(100 + r * Math.cos(x)).toFixed(1)} ${(100 + r * Math.sin(x)).toFixed(1)}`; s += `<path d="M${p(28, a)} L${p(98, a)} L${p(98, a2)} L${p(28, a2)} Z" fill="INK"/>`; }
  return s;
});

motif("motif/dome", "arcs", () => {
  let s = `<path d="M28 150 A72 72 0 0 1 172 150 Z" fill="INK"/><rect x="22" y="150" width="156" height="26" fill="INK"/>`;
  for (let i = 0; i < 5; i++) s += `<rect x="${52 + i * 20}" y="118" width="9" height="58" fill="GROUND"/>`;
  return s;
});

motif("motif/orbit", "discs", () =>
  `<circle cx="100" cy="100" r="80" fill="none" stroke="INK" stroke-width="7"/><circle cx="100" cy="100" r="34" fill="INK"/><circle cx="180" cy="100" r="13" fill="INK"/>`);

motif("motif/globe", "frames", () => {
  let s = `<circle cx="100" cy="100" r="92" fill="none" stroke="INK" stroke-width="6"/>`;
  for (let i = 1; i <= 3; i++) { const r = (92 * (1 - i / 4)).toFixed(0); s += `<ellipse cx="100" cy="100" rx="${r}" ry="92" fill="none" stroke="INK" stroke-width="5"/><ellipse cx="100" cy="100" rx="92" ry="${r}" fill="none" stroke="INK" stroke-width="5"/>`; }
  return s;
});

motif("motif/wavefield", "waves", () => {
  let s = ""; for (let k = 0; k < 3; k++) { const y = 62 + k * 40; s += `<path d="M0 ${y} C50 ${y - 26} 150 ${y + 26} 200 ${y} L200 ${y + 36} C150 ${y + 10} 50 ${y + 62} 0 ${y + 36} Z" fill="${k % 2 ? "GROUND" : "INK"}"/>`; } return s;
});

motif("motif/peak", "triangles", () =>
  `<path d="M0 188 L72 44 L144 188 Z" fill="INK"/><path d="M96 188 L150 78 L200 188 Z" fill="GROUND"/>`);
