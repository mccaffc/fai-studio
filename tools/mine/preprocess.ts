/**
 * preprocess.ts — SVG text preprocessors shared by banner mining and tile library building.
 *
 * Exported:
 *   resolveCssClasses(svgText) — inlines class-based fill/fill-rule attributes
 *   resolveTransforms(svgText) — analytically resolves circle/ellipse transforms
 *
 * Not exported here: ensureBackgroundRect — banner-specific; lives in mine.ts.
 */

// ---------------------------------------------------------------------------
// CSS class resolver
// Some SVGs (exported from Adobe Illustrator) use CSS class-based fill declarations
// instead of inline fill attributes. We extract the class→fill mapping from the <style>
// block and inline them as fill/fill-rule attributes on the shape elements.
// ---------------------------------------------------------------------------

export function resolveCssClasses(svgText: string): string {
  // Extract <style> block
  const styleMatch = svgText.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleMatch) return svgText;

  const styleText = styleMatch[1]!;

  // Parse CSS class rules: .className { fill: #xxx; fill-rule: yyy; }
  // Also handles multi-selector rules like .st0, .st1 { fill: #xxx; }
  const classFills = new Map<string, string>();       // className → fill hex
  const classFillRules = new Map<string, string>();   // className → fill-rule

  // Match CSS rules: selector { declarations }
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let ruleMatch: RegExpExecArray | null;
  while ((ruleMatch = ruleRe.exec(styleText)) !== null) {
    const selector = ruleMatch[1]!.trim();
    const declarations = ruleMatch[2]!;

    // Extract fill value from declarations
    const fillMatch = declarations.match(/\bfill\s*:\s*([^;]+)/);
    const fillRuleMatch = declarations.match(/\bfill-rule\s*:\s*([^;]+)/);

    // Split multi-selector (e.g. ".st0, .st1")
    for (const part of selector.split(',')) {
      const className = part.trim().replace(/^\./, '');
      if (!className) continue;
      if (fillMatch) {
        classFills.set(className, fillMatch[1]!.trim());
      }
      if (fillRuleMatch) {
        classFillRules.set(className, fillRuleMatch[1]!.trim());
      }
    }
  }

  if (classFills.size === 0 && classFillRules.size === 0) return svgText;

  // Replace class="..." attributes on shape elements with inline fill/fill-rule
  return svgText.replace(
    /<(rect|path|circle|ellipse)([^>]*?)class="([^"]*)"([^>]*?)\/>/g,
    (_match, tag: string, before: string, classAttr: string, after: string) => {
      // Collect all classes; last fill/fill-rule wins (CSS cascade)
      let fill: string | undefined;
      let fillRule: string | undefined;
      for (const cls of classAttr.split(/\s+/)) {
        if (classFills.has(cls)) fill = classFills.get(cls);
        if (classFillRules.has(cls)) fillRule = classFillRules.get(cls);
      }
      let extras = '';
      if (fill !== undefined) extras += ` fill="${fill}"`;
      if (fillRule !== undefined) extras += ` fill-rule="${fillRule}"`;
      // Remove class attribute; inject fill/fill-rule before the closing />
      return `<${tag}${before}${after}${extras}/>`;
    },
  );
}

// ---------------------------------------------------------------------------
// SVG transform resolver
// Banners and tiles contain circle/ellipse elements with simple transforms (rotate, matrix)
// that parseSvgElements rejects. We resolve them analytically before parsing.
// Supported:
//   rotate(angle) or rotate(angle cx cy) on <circle>  → no-op (circles are rotationally symmetric), strip transform
//   rotate(angle cx cy) on <ellipse>: if pivot ≠ shape center (beyond 0.5px), throw (can't resolve without layout context)
//   rotate(angle cx cy) on <ellipse>: if rx===ry, strip (circular); ±90/±270 with rx≠ry → swap rx/ry; 0/180 → strip
//   matrix(-1 0 0 1 tx ty) on <ellipse> → horizontal flip at center; reposition cx = tx - cx; strip
//   matrix(1 ~0 ~0 -1 tx ty) on <ellipse> → vertical flip; cy = ty - cy; strip
//   matrix(-1 ~0 ~0 1 tx ty) on <ellipse> → horizontal flip; cx = tx - cx; strip
// Any transform that doesn't match is left in place and will cause a parse error.
// ---------------------------------------------------------------------------

export function resolveTransforms(svgText: string): string {
  // Match circle or ellipse elements that have a transform attribute
  // We handle them element-by-element with a regex over the SVG text
  return svgText.replace(
    /<(circle|ellipse)([^>]*?)transform="([^"]*)"([^>]*?)\/>/g,
    (match, tag: string, before: string, transformStr: string, after: string) => {
      const attrs = before + after;
      try {
        const resolved = resolveShapeTransform(tag, attrs, transformStr);
        return `<${tag}${resolved}/>`;
      } catch {
        // Return original, will fail in parseSvgElements (and get caught at call site)
        return match;
      }
    },
  );
}

function resolveShapeTransform(tag: string, attrs: string, transformStr: string): string {
  const t = transformStr.trim();

  // rotate(angle) or rotate(angle cx cy)
  const rotateMatch = t.match(/^rotate\(\s*([-\d.e]+)(?:\s+([-\d.e]+)\s+([-\d.e]+))?\s*\)$/i);
  if (rotateMatch) {
    const angle = parseFloat(rotateMatch[1]!);
    const normalizedAngle = ((angle % 360) + 360) % 360;

    if (tag === 'circle') {
      // Circles are rotationally symmetric — pivot doesn't matter, strip transform
      return attrs;
    }

    // Ellipse: check pivot vs shape center when pivot is provided
    if (rotateMatch[2] !== undefined && rotateMatch[3] !== undefined) {
      const pivotX = parseFloat(rotateMatch[2]);
      const pivotY = parseFloat(rotateMatch[3]);
      const cx = parseAttrNum(attrs, 'cx') ?? 0;
      const cy = parseAttrNum(attrs, 'cy') ?? 0;
      if (Math.abs(pivotX - cx) > 0.5 || Math.abs(pivotY - cy) > 0.5) {
        throw new Error(
          `Cannot resolve rotate(${angle} ${pivotX} ${pivotY}) on ellipse: pivot (${pivotX}, ${pivotY}) differs from center (${cx}, ${cy}) by more than 0.5px`,
        );
      }
    }

    const rx = parseAttrNum(attrs, 'rx');
    const ry = parseAttrNum(attrs, 'ry');

    if (rx === null || ry === null) {
      throw new Error('Cannot resolve ellipse without rx/ry');
    }

    if (Math.abs(rx - ry) < 0.001) {
      // Circle-as-ellipse, rotationally symmetric
      return attrs;
    }

    // For ±90/±270 degrees, swap rx and ry
    if (
      Math.abs(normalizedAngle - 90) < 0.5 ||
      Math.abs(normalizedAngle - 270) < 0.5
    ) {
      return setAttr(setAttr(attrs, 'rx', ry), 'ry', rx);
    }

    // For 0/180, no visual change
    if (normalizedAngle < 0.5 || Math.abs(normalizedAngle - 180) < 0.5) {
      return attrs;
    }

    // Other angles — can't resolve without full matrix math; throw
    throw new Error(`Cannot resolve rotate(${angle}) on ellipse with different rx/ry`);
  }

  // matrix(a b c d e f) — handle specific common patterns
  const matrixMatch = t.match(
    /^matrix\(\s*([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)\s*\)$/i,
  );
  if (matrixMatch) {
    const [, aS, bS, cS, dS, eS, fS] = matrixMatch;
    const a = parseFloat(aS!);
    const b = parseFloat(bS!);
    const c = parseFloat(cS!);
    const d = parseFloat(dS!);
    const e = parseFloat(eS!);
    const f = parseFloat(fS!);

    const cx = parseAttrNum(attrs, 'cx');
    const cy = parseAttrNum(attrs, 'cy');
    const rx = parseAttrNum(attrs, 'rx');
    const ry = parseAttrNum(attrs, 'ry');

    if (cx === null || cy === null || rx === null || ry === null) {
      throw new Error('Cannot resolve ellipse matrix without cx/cy/rx/ry');
    }

    // Compute new center: [newCx, newCy] = [a*cx + c*cy + e, b*cx + d*cy + f]
    const newCx = a * cx + c * cy + e;
    const newCy = b * cx + d * cy + f;

    // Determine new rx/ry from the matrix scale factors
    // For a pure scale+translate matrix: newRx = |a|*rx + |c|*ry, newRy = |b|*rx + |d|*ry
    // For common cases: matrix(-1 0 0 1 tx 0) → flip x, matrix(1 0 0 -1 0 ty) → flip y
    // These don't change rx/ry magnitudes for axis-aligned ellipses

    // Check if this is a simple reflection/scale (no shear, |det|=1)
    const det = a * d - b * c;
    const isReflection = Math.abs(Math.abs(det) - 1) < 0.001;

    if (!isReflection) {
      throw new Error(`Cannot resolve non-unit-det matrix transform on ellipse`);
    }

    // For reflections: new rx = sqrt((a*rx)^2 + (c*ry)^2), new ry = sqrt((b*rx)^2 + (d*ry)^2)
    const newRx = Math.sqrt(a * a * rx * rx + c * c * ry * ry);
    const newRy = Math.sqrt(b * b * rx * rx + d * d * ry * ry);

    let result = attrs;
    result = setAttr(result, 'cx', newCx);
    result = setAttr(result, 'cy', newCy);
    result = setAttr(result, 'rx', newRx);
    result = setAttr(result, 'ry', newRy);
    return result;
  }

  throw new Error(`Unrecognized transform: ${transformStr}`);
}

function parseAttrNum(attrs: string, name: string): number | null {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]+)"`));
  if (!m) return null;
  const v = parseFloat(m[1]!);
  return Number.isFinite(v) ? v : null;
}

function setAttr(attrs: string, name: string, value: number): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, '');
  const re = new RegExp(`(\\b${name}=")[^"]*(")`, 'g');
  return attrs.replace(re, `$1${formatted}$2`);
}
