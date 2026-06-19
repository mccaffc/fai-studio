/**
 * Shared flatten algorithm — boolean-merge an SVG into non-overlapping,
 * interlocking shapes (one compound path per color, no layers, no internal
 * seams). Pure: takes an already-initialized PaperScope so it runs unchanged
 * in the browser (studio export) and in Node (batch CLI). This is the single
 * source of truth so the two paths can never drift.
 *
 * Why it's needed: renderers anti-alias shapes independently, so shared edges
 * between same-color shapes leak the field color through as faint seams (PDF
 * export, print RIPs, downscaled thumbnails). Merging every color into one
 * path removes all internal edges; processing top-down with subtraction
 * removes layering.
 */

/** Minimal structural type so this file needs no paper import of its own. */
interface PaperLike {
  project: {
    clear(): void;
    importSVG(svg: string, opts: { expandShapes: boolean }): any;
  };
  Group: new () => any;
  Color: new (hex: string) => any;
}

/**
 * Inline CSS-class fills into presentation attributes. paper.js importSVG does
 * NOT resolve `<style>` class selectors, so Illustrator exports that color via
 * `.st1 { fill: #121212 }` import as default-black and flatten to a solid
 * field. Resolve `.class { fill: ... }` onto elements, then drop the <style>.
 * Engine output has no <style>, so this is a no-op for studio exports.
 */
export function resolveCssFills(svg: string): string {
  const blocks = [...svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
  if (blocks.length === 0) return svg;
  const classFill = new Map<string, string>();
  for (const b of blocks) {
    for (const rule of b[1]!.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
      const fill = rule[2]!.match(/(?:^|[;{\s])fill\s*:\s*([^;}]+)/i);
      if (fill) classFill.set(rule[1]!, fill[1]!.trim());
    }
  }
  if (classFill.size === 0) return svg;
  return svg
    .replace(
      /<(path|rect|circle|ellipse|polygon|polyline|line)\b([^>]*?)(\/?)>/g,
      (m, tag, attrs, close) => {
        if (/\bfill\s*=/.test(attrs)) return m; // inline fill wins
        const cm = attrs.match(/\bclass="([^"]+)"/);
        if (!cm) return m;
        let fill: string | undefined;
        for (const c of cm[1].split(/\s+/)) if (classFill.has(c)) fill = classFill.get(c);
        return fill ? `<${tag} fill="${fill}"${attrs}${close}>` : m;
      },
    )
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
}

export function mergeFlat(ps: PaperLike, svg: string): string {
  ps.project.clear();
  const imported = ps.project.importSVG(resolveCssFills(svg), { expandShapes: true });

  // leaf items in paint order
  const leaves: any[] = [];
  (function walk(item: any) {
    if (item.children && item.children.length > 0) {
      for (const child of [...item.children]) walk(child);
    } else {
      leaves.push(item);
    }
  })(imported);

  const filled = leaves.filter((i) => i.fillColor && i.subtract);
  // decorative linework (globe rings, frames) passes through on top
  const strokedOnly = leaves.filter((i) => !i.fillColor && i.strokeColor);

  // top-down: visible(item) = item − everything above it; union per color
  const noInsert = { insert: false } as const;
  let covered: any = null;
  const byColor = new Map<string, any>();
  const order: string[] = [];
  for (let i = filled.length - 1; i >= 0; i--) {
    const item = filled[i]!;
    const hex = item.fillColor.toCSS(true).toUpperCase();
    const visible = covered ? item.subtract(covered, noInsert) : item.clone(noInsert);
    if (!visible.isEmpty()) {
      const prev = byColor.get(hex);
      byColor.set(hex, prev ? prev.unite(visible, noInsert) : visible);
      if (!prev) order.push(hex);
    }
    covered = covered ? covered.unite(item, noInsert) : item.clone(noInsert);
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

  // preserve the source document's width/height/viewBox (canonical banners
  // are not always 0-origin)
  const head = svg.match(/<svg[^>]*>/)?.[0] ?? "";
  const width = head.match(/\bwidth="([\d.]+)"/)?.[1] ?? "1200";
  const height = head.match(/\bheight="([\d.]+)"/)?.[1] ?? "600";
  const viewBox = head.match(/viewBox="([^"]+)"/)?.[1] ?? `0 0 ${width} ${height}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="${viewBox}">${inner}</svg>`
  );
}
