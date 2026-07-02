import { JSDOM } from 'jsdom';

export interface SvgElement {
  kind: 'rect' | 'path' | 'circle' | 'ellipse';
  fill: string;
  fillRule?: 'nonzero' | 'evenodd';
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  cx?: number;
  cy?: number;
  r?: number;
  rx?: number;
  ry?: number;
  d?: string;
}

type FillRule = NonNullable<SvgElement['fillRule']>;

const SKIP_SUBTREES = new Set(['defs', 'clippath', 'mask']);
const SHAPE_TAGS = new Set(['rect', 'path', 'circle', 'ellipse']);

export function parseSvgElements(svgText: string): { width: number; height: number; elements: SvgElement[] } {
  const dom = new JSDOM(svgText, { contentType: 'image/svg+xml' });
  const root = dom.window.document.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg') {
    throw new Error('Expected an <svg> root element');
  }

  const viewBox = parseViewBox(root.getAttribute('viewBox'));
  const width = parseLength(root.getAttribute('width'), 'svg width', viewBox?.w);
  const height = parseLength(root.getAttribute('height'), 'svg height', viewBox?.h);
  const elements: SvgElement[] = [];

  const walk = (node: Element, inheritedFill: string | undefined, inheritedFillRule: FillRule | undefined): void => {
    const tag = node.localName.toLowerCase();

    if (SKIP_SUBTREES.has(tag)) {
      return;
    }

    if (node.hasAttribute('transform')) {
      throw new Error(`Unsupported transform on <${tag}>`);
    }

    const fill = resolveFill(node, inheritedFill);
    const fillRule = resolveFillRule(node, inheritedFillRule);

    if (SHAPE_TAGS.has(tag)) {
      if (fill === undefined) {
        throw new Error(`<${tag}> has no fill attribute and none inherited — corpus SVGs must carry explicit fills`);
      }
      elements.push(parseShape(node, tag, fill, fillRule));
    }

    for (const child of Array.from(node.children) as Element[]) {
      walk(child, fill, fillRule);
    }
  };

  walk(root, undefined, undefined);

  return { width, height, elements };
}

function parseShape(node: Element, tag: string, fill: string, fillRule: FillRule | undefined): SvgElement {
  const base: Pick<SvgElement, 'fill' | 'fillRule'> = fillRule ? { fill, fillRule } : { fill };

  if (tag === 'rect') {
    return {
      kind: 'rect',
      ...base,
      x: parseLength(node.getAttribute('x'), 'rect x', 0),
      y: parseLength(node.getAttribute('y'), 'rect y', 0),
      w: parseLength(node.getAttribute('width'), 'rect width', 0),
      h: parseLength(node.getAttribute('height'), 'rect height', 0),
    };
  }

  if (tag === 'path') {
    const d = node.getAttribute('d');
    if (!d) {
      throw new Error('Path element is missing d');
    }
    return { kind: 'path', ...base, d };
  }

  if (tag === 'circle') {
    return {
      kind: 'circle',
      ...base,
      cx: parseLength(node.getAttribute('cx'), 'circle cx', 0),
      cy: parseLength(node.getAttribute('cy'), 'circle cy', 0),
      r: parseLength(node.getAttribute('r'), 'circle r', 0),
    };
  }

  if (tag === 'ellipse') {
    return {
      kind: 'ellipse',
      ...base,
      cx: parseLength(node.getAttribute('cx'), 'ellipse cx', 0),
      cy: parseLength(node.getAttribute('cy'), 'ellipse cy', 0),
      rx: parseLength(node.getAttribute('rx'), 'ellipse rx', 0),
      ry: parseLength(node.getAttribute('ry'), 'ellipse ry', 0),
    };
  }

  throw new Error(`Unsupported SVG shape <${tag}>`);
}

function resolveFill(node: Element, inheritedFill: string | undefined): string | undefined {
  const fillAttr = node.getAttribute('fill');
  const styleFill = getStyleProperty(node.getAttribute('style'), 'fill');
  const raw = styleFill ?? fillAttr;
  if (raw == null) {
    return inheritedFill;
  }
  return normalizeFill(raw);
}

function resolveFillRule(node: Element, inheritedFillRule: FillRule | undefined): FillRule | undefined {
  const ruleAttr = node.getAttribute('fill-rule');
  const styleRule = getStyleProperty(node.getAttribute('style'), 'fill-rule');
  const raw = styleRule ?? ruleAttr;
  if (raw == null || raw.trim() === '') {
    return inheritedFillRule;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'nonzero' || normalized === 'evenodd') {
    return normalized;
  }
  throw new Error(`Unsupported fill-rule: ${raw}`);
}

function normalizeFill(fill: string): string {
  const trimmed = fill.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'none') {
    return 'none';
  }
  if (lower === 'white') {
    return '#FFFFFF';
  }
  if (lower === 'black') {
    return '#000000';
  }

  const shortHex = lower.match(/^#([0-9a-f]{3})$/);
  if (shortHex) {
    const hex = shortHex[1];
    if (!hex) {
      throw new Error(`Unsupported fill: ${fill}`);
    }
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toUpperCase();
  }

  if (/^#[0-9a-f]{6}$/.test(lower)) {
    return lower.toUpperCase();
  }

  const rgb = lower.match(/^rgb\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)\s*\)$/);
  if (rgb) {
    const channels = rgb.slice(1).map((value) => {
      const channel = Number(value);
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        throw new Error(`Unsupported rgb() fill channel: ${fill}`);
      }
      return channel.toString(16).padStart(2, '0');
    });
    return `#${channels.join('')}`.toUpperCase();
  }

  throw new Error(`Unsupported fill: ${fill}`);
}

function getStyleProperty(style: string | null, property: string): string | undefined {
  if (!style) {
    return undefined;
  }

  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const name = declaration.slice(0, colon).trim().toLowerCase();
    if (name === property) {
      return declaration.slice(colon + 1).trim();
    }
  }

  return undefined;
}

function parseViewBox(viewBox: string | null): { x: number; y: number; w: number; h: number } | undefined {
  if (!viewBox) {
    return undefined;
  }
  const parts = viewBox.trim().split(/[\s,]+/);
  if (parts.length !== 4) {
    throw new Error(`Invalid viewBox: ${viewBox}`);
  }
  const x = parseNumberToken(parts[0]!, 'viewBox');
  const y = parseNumberToken(parts[1]!, 'viewBox');
  const w = parseNumberToken(parts[2]!, 'viewBox');
  const h = parseNumberToken(parts[3]!, 'viewBox');
  return { x, y, w, h };
}

function parseLength(raw: string | null, label: string, fallback?: number): number {
  if (raw == null || raw.trim() === '') {
    if (fallback != null) {
      return fallback;
    }
    throw new Error(`Missing ${label}`);
  }
  return parseNumberToken(raw, label);
}

function parseNumberToken(raw: string, label: string): number {
  const trimmed = raw.trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i.test(trimmed)) {
    throw new Error(`Unsupported numeric value for ${label}: ${raw}`);
  }
  const value = Number(trimmed.replace(/px$/i, ''));
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for ${label}: ${raw}`);
  }
  return value;
}
