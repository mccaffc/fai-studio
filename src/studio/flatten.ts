/**
 * Studio (browser) flatten — lazy-loads paper.js, then delegates to the shared
 * mergeFlat algorithm so studio exports and the batch CLI behave identically.
 */
import { mergeFlat } from "./flatten-core";

let scopePromise: Promise<paper.PaperScope> | null = null;

async function getPaper(): Promise<paper.PaperScope> {
  if (!scopePromise) {
    scopePromise = import("paper").then((mod) => {
      // paper is CJS (module.exports = an initialized paper scope object);
      // under Vite/ESM interop that lands on .default, and PaperScope is a
      // runtime property, not a named export
      const lib = ((mod as unknown as { default?: unknown }).default ??
        mod) as paper.PaperScope & { PaperScope?: new () => paper.PaperScope };
      const scope =
        typeof lib.PaperScope === "function" ? new lib.PaperScope() : lib;
      scope.setup(new scope.Size(8, 8)); // no visible canvas needed for booleans
      return scope;
    });
  }
  return scopePromise;
}

export async function flattenSvg(svg: string): Promise<string> {
  const ps = await getPaper();
  return mergeFlat(ps as never, svg);
}
