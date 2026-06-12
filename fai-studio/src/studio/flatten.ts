/**
 * Print-safe flatten: boolean-merge the scene into non-overlapping,
 * interlocking shapes — one compound path per color, no layers.
 *
 * Why: renderers anti-alias shapes independently, so shared edges between
 * same-color shapes leak the field color through as faint seams (PDF export,
 * print RIPs, downscaled thumbnails). Merging every color into a single path
 * removes all internal edges; processing top-down with subtraction removes
 * layering entirely.
 *
 * paper.js is lazy-loaded here so the engine stays zero-dependency and the
 * studio bundle stays small until the first flattened export.
 */

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
  ps.project.clear();
  const imported = ps.project.importSVG(svg, { expandShapes: true });

  // leaf items in paint order
  const leaves: paper.Item[] = [];
  (function walk(item: paper.Item) {
    if (item.children && item.children.length > 0) {
      for (const child of [...item.children]) walk(child);
    } else {
      leaves.push(item);
    }
  })(imported);

  const filled = leaves.filter(
    (i) => i.fillColor && (i as paper.PathItem).subtract,
  ) as paper.PathItem[];
  // decorative linework (globe rings, frames) passes through on top
  const strokedOnly = leaves.filter((i) => !i.fillColor && i.strokeColor);

  // top-down: visible(item) = item − everything above it; union per color
  const noInsert = { insert: false } as const;
  let covered: paper.PathItem | null = null;
  const byColor = new Map<string, paper.PathItem>();
  const order: string[] = [];
  for (let i = filled.length - 1; i >= 0; i--) {
    const item = filled[i]!;
    const hex = item.fillColor!.toCSS(true).toUpperCase();
    const visible = covered ? item.subtract(covered, noInsert) : item.clone(noInsert);
    if (!visible.isEmpty()) {
      const prev = byColor.get(hex);
      byColor.set(hex, prev ? prev.unite(visible, noInsert) : (visible as paper.PathItem));
      if (!prev) order.push(hex);
    }
    covered = covered ? covered.unite(item, noInsert) : (item.clone(noInsert) as paper.PathItem);
  }

  const out = new ps.Group();
  for (const hex of order) {
    const p = byColor.get(hex)!;
    p.fillColor = new ps.Color(hex);
    p.strokeColor = null;
    out.addChild(p);
  }
  for (const s of strokedOnly) out.addChild(s.clone(noInsert));

  const inner = out.exportSVG({ asString: true }) as string;
  out.remove();
  ps.project.clear();

  // re-wrap with the original document dimensions
  const head = svg.match(/<svg[^>]*>/)?.[0] ?? "";
  const width = head.match(/width="([\d.]+)"/)?.[1] ?? "1200";
  const height = head.match(/height="([\d.]+)"/)?.[1] ?? "600";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${inner}</svg>`
  );
}
