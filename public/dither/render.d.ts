export interface ChevronSvgMark {
  x: number;
  y: number;
  a: number;
  s: number;
  color: string;
}

export interface ChevronSvgOptions {
  width: number;
  height: number;
  ground: string;
  includeGround: boolean;
  pair: string;
  centerX: number;
  centerY: number;
  marks: ChevronSvgMark[];
}

export function serializeChevronSvg(options: ChevronSvgOptions): string;
