/**
 * Role → hex resolution. Nodes store semantic roles so recolor() can re-skin
 * a scene without touching geometry.
 */
import type { ColorRole, ResolvedPalette } from "../types";

export function resolveRole(role: ColorRole, p: ResolvedPalette): string {
  switch (role) {
    case "ink":
      return p.ink;
    case "accent":
      return p.accents[0] ?? p.ink;
    case "accent2":
      return p.accents[1] ?? p.accents[0] ?? p.ink;
    case "neutral":
      return p.accents[2] ?? p.ink;
  }
}
