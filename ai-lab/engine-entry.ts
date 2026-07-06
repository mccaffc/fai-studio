// Bundle entry for the AI Lab: the engine's public surface PLUS the super-form
// recipes (the proven multi-cell tilings the studio composes with).
export * from "../src/engine/index";
export { RECIPES, recipesFor } from "../src/engine/compose/superforms";
import "./motifs"; // registers focal motifs (motif/*) into the engine registry
