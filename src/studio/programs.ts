/**
 * FAI program quick-select — six policy programs plus the parent brand, each
 * assigned ONE shape family and ONE brand color. Picking a program sets the
 * shape families (Triangles & Chevrons is the shared FAI motif, so it is always
 * enabled alongside the program's family — except the parent, which is triangles
 * alone), the One-accent color mode, and the program's accent hex.
 */
import type { CategoryId } from "../engine/types";

export interface Program {
  id: string;
  /** short label for the quick-select control */
  label: string;
  /** the program's own shape family */
  category: CategoryId;
  /** the program's accent hex */
  accent: string;
  /** human name of the accent color */
  colorName: string;
}

export const PROGRAMS: readonly Program[] = [
  { id: "fai", label: "FAI", category: "triangles", accent: "#FF4F00", colorName: "International Orange" },
  { id: "tech-statecraft", label: "Technology & Statecraft", category: "bars", accent: "#FFA300", colorName: "Chrome Yellow" },
  { id: "american-governance", label: "American Governance", category: "arcs", accent: "#7150D6", colorName: "Iris Violet" },
  { id: "ai", label: "Artificial Intelligence", category: "capsules", accent: "#0E8C88", colorName: "Deep Teal" },
  { id: "energy-infrastructure", label: "Energy & Infrastructure", category: "waves", accent: "#268B41", colorName: "Signal Green" },
  { id: "science-innovation", label: "Science & Innovation", category: "discs", accent: "#4997D0", colorName: "Celestial Blue" },
  { id: "frontier-legal", label: "Frontier Legal Defense", category: "frames", accent: "#C8102E", colorName: "Frontier Crimson" },
];

export interface ProgramSettings {
  categories: CategoryId[];
  color: { mode: "vertical"; accent: string };
}

/** Resolve a program id to the config changes the studio should apply. */
export function applyProgram(programId: string): ProgramSettings | null {
  const program = PROGRAMS.find((p) => p.id === programId);
  if (!program) return null;
  // Triangles & Chevrons is the shared FAI motif present in every program's
  // work; the parent brand uses triangles alone.
  const categories: CategoryId[] =
    program.category === "triangles" ? ["triangles"] : ["triangles", program.category];
  return { categories, color: { mode: "vertical", accent: program.accent } };
}
