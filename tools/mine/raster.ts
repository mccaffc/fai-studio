import { Buffer } from 'node:buffer';
import { createCanvas, loadImage } from 'canvas';
import type { SvgElement } from './svg';

export interface Viewport { x: number; y: number; w: number; h: number; }

export async function rasterizeMask(
  elements: SvgElement[],
  viewport: Viewport,
  size: number,
  isForeground: (el: SvgElement) => boolean,
): Promise<Uint8Array> {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewport.x} ${viewport.y} ${viewport.w} ${viewport.h}" width="${size}" height="${size}">`,
    `<rect x="${viewport.x}" y="${viewport.y}" width="${viewport.w}" height="${viewport.h}" fill="#000000"/>`,
    ...elements.flatMap((el) => serializeElement(el, isForeground(el) ? '#FFFFFF' : '#000000')),
    '</svg>',
  ].join('');

  const img = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);

  const pixels = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = (pixels[i * 4] ?? 0) > 127 ? 1 : 0;
  }
  return mask;
}

export function maskIoU(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    throw new Error(`Mask length mismatch: ${a.length} !== ${b.length}`);
  }

  let intersection = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const aOn = a[i] !== 0;
    const bOn = b[i] !== 0;
    if (aOn && bOn) {
      intersection += 1;
    }
    if (aOn || bOn) {
      union += 1;
    }
  }

  return union === 0 ? 1 : intersection / union;
}

export function maskFillRatio(a: Uint8Array): number {
  if (a.length === 0) {
    return 0;
  }

  let filled = 0;
  for (const value of a) {
    if (value !== 0) {
      filled += 1;
    }
  }
  return filled / a.length;
}

function serializeElement(el: SvgElement, fill: '#FFFFFF' | '#000000'): string[] {
  if (el.fill === 'none') {
    return [];
  }

  const fillRule = el.fillRule ? ` fill-rule="${el.fillRule}"` : '';
  if (el.kind === 'rect') {
    return [`<rect x="${numberAttr(el.x ?? 0)}" y="${numberAttr(el.y ?? 0)}" width="${numberAttr(el.w ?? 0)}" height="${numberAttr(el.h ?? 0)}" fill="${fill}"${fillRule}/>`];
  }
  if (el.kind === 'path') {
    if (!el.d) {
      throw new Error('Cannot rasterize path without d');
    }
    return [`<path d="${escapeAttr(el.d)}" fill="${fill}"${fillRule}/>`];
  }
  if (el.kind === 'circle') {
    return [`<circle cx="${numberAttr(el.cx ?? 0)}" cy="${numberAttr(el.cy ?? 0)}" r="${numberAttr(el.r ?? 0)}" fill="${fill}"${fillRule}/>`];
  }
  if (el.kind === 'ellipse') {
    return [`<ellipse cx="${numberAttr(el.cx ?? 0)}" cy="${numberAttr(el.cy ?? 0)}" rx="${numberAttr(el.rx ?? 0)}" ry="${numberAttr(el.ry ?? 0)}" fill="${fill}"${fillRule}/>`];
  }

  throw new Error(`Cannot rasterize unsupported element kind: ${el.kind}`);
}

function numberAttr(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Cannot serialize non-finite number: ${value}`);
  }
  return String(value);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
