/**
 * Role → hex resolution. Nodes store semantic roles (+ accent slot indices) so
 * recolor() can re-skin a scene without touching geometry: in duotone every
 * accent collapses to ink (pure b&w), in vertical to the one chosen accent,
 * in full each index picks its own hue. "canvas" is the shared field color —
 * black shapes on colored ground blocks (canonical banners 003/008/020).
 */
import type { ColorRole, ResolvedPalette } from "../types";

export function resolveColor(
  role: ColorRole,
  accentIndex: number | undefined,
  p: ResolvedPalette,
): string {
  if (role === "canvas") return p.ground;
  if (role === "ink" || p.accents.length === 0) return p.ink;
  return p.accents[(accentIndex ?? 0) % p.accents.length]!;
}
