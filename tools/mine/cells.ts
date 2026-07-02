import { SvgElement } from './svg.js';

export interface CellSlice {
  col: number;
  row: number;
  ground: string;           // resolved backing hex for this cell
  foreground: SvgElement[]; // elements (paint order) intersecting this cell, painted after its ground
  inks: string[];           // distinct fills in foreground, most-covering first (by bbox area within cell)
}

export function segmentCells(
  parsed: { width: number; height: number; elements: SvgElement[] },
  grid?: { cols: number; rows: number; cellPx: number },
): { ground: string; cells: CellSlice[] } {
  const { width, height, elements } = parsed;
  const { cols, rows, cellPx } = { cols: 6, rows: 3, cellPx: 320, ...grid };

  // --- global ground ---
  const globalGroundEl = elements[0];
  if (
    !globalGroundEl ||
    globalGroundEl.kind !== 'rect' ||
    (globalGroundEl.x ?? 0) !== 0 ||
    (globalGroundEl.y ?? 0) !== 0 ||
    globalGroundEl.w !== width ||
    globalGroundEl.h !== height
  ) {
    throw new Error(
      `segmentCells: elements[0] must be a rect covering the full canvas (${width}×${height}); got ${JSON.stringify(globalGroundEl)}`,
    );
  }
  const globalGround = globalGroundEl.fill;

  // --- find the last cell-ground rect for each cell ---
  // A cell ground rect: rect with w=h=cellPx, x/y are multiples of cellPx,
  // and x+cellPx <= width, y+cellPx <= height (it covers exactly one cell).
  const cellGroundIdx = new Map<string, { fill: string; idx: number }>(); // key = "col,row"
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i]!;
    if (el.kind !== 'rect') continue;
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.w ?? 0;
    const h = el.h ?? 0;
    if (w !== cellPx || h !== cellPx) continue;
    if (x % cellPx !== 0 || y % cellPx !== 0) continue;
    const col = x / cellPx;
    const row = y / cellPx;
    if (col >= cols || row >= rows) continue;
    const key = `${col},${row}`;
    // always update — last one wins
    cellGroundIdx.set(key, { fill: el.fill, idx: i });
  }

  // --- build cells in row-major order ---
  const cells: CellSlice[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = `${col},${row}`;
      const groundEntry = cellGroundIdx.get(key);
      const cellGround = groundEntry ? groundEntry.fill : globalGround;
      const groundEltIdx = groundEntry ? groundEntry.idx : -1; // -1 = use global ground (elements[0])

      // Cell bounding box
      const cellX = col * cellPx;
      const cellY = row * cellPx;
      const cellX2 = cellX + cellPx;
      const cellY2 = cellY + cellPx;

      // Foreground = elements AFTER the cell's ground rect whose bbox intersects the cell with area > 1px²
      // If no cell ground rect, the "ground" is elements[0] so foreground starts from elements[1].
      const startIdx = groundEltIdx >= 0 ? groundEltIdx + 1 : 1;

      const foreground: SvgElement[] = [];
      for (let i = startIdx; i < elements.length; i++) {
        const el = elements[i]!;
        const bbox = elementBbox(el);
        if (bbox === null) continue;
        const intersectArea = rectIntersectArea(bbox, { x: cellX, y: cellY, x2: cellX2, y2: cellY2 });
        if (intersectArea > 1) {
          foreground.push(el);
        }
      }

      // inks: distinct fills from foreground, most-covering first (by bbox area within cell)
      const inkAreaMap = new Map<string, number>();
      for (const el of foreground) {
        const fill = el.fill;
        if (fill === 'none') continue;
        const bbox = elementBbox(el);
        if (bbox === null) continue;
        const area = rectIntersectArea(bbox, { x: cellX, y: cellY, x2: cellX2, y2: cellY2 });
        inkAreaMap.set(fill, (inkAreaMap.get(fill) ?? 0) + area);
      }
      const inks = [...inkAreaMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([fill]) => fill);

      cells.push({ col, row, ground: cellGround, foreground, inks });
    }
  }

  return { ground: globalGround, cells };
}

// --- bbox helpers ---

interface BBox {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

function elementBbox(el: SvgElement): BBox | null {
  if (el.kind === 'rect') {
    const x = el.x ?? 0;
    const y = el.y ?? 0;
    const w = el.w ?? 0;
    const h = el.h ?? 0;
    return { x, y, x2: x + w, y2: y + h };
  }

  if (el.kind === 'circle') {
    const cx = el.cx ?? 0;
    const cy = el.cy ?? 0;
    const r = el.r ?? 0;
    return { x: cx - r, y: cy - r, x2: cx + r, y2: cy + r };
  }

  if (el.kind === 'ellipse') {
    const cx = el.cx ?? 0;
    const cy = el.cy ?? 0;
    const rx = el.rx ?? 0;
    const ry = el.ry ?? 0;
    return { x: cx - rx, y: cy - ry, x2: cx + rx, y2: cy + ry };
  }

  if (el.kind === 'path') {
    return pathBbox(el.d ?? '');
  }

  return null;
}

function pathBbox(d: string): BBox | null {
  // Verify no relative path commands (lowercase command letters).
  // In SVG path data, command letters appear either:
  //   - at the start of the string, or
  //   - immediately after whitespace, comma, or another letter.
  // Scientific notation (e.g. "1.39876e-06") has 'e' preceded by a digit — not a command.
  // We scan for letter characters and check whether they are command letters by looking at
  // the preceding character. A letter is a path command if preceded by: start, whitespace,
  // comma, or another letter. A letter preceded by a digit or '.' is an exponent.
  for (let i = 0; i < d.length; i++) {
    const ch = d[i]!;
    if (!/[a-zA-Z]/.test(ch)) continue;
    // Check preceding character
    const prev = i > 0 ? d[i - 1]! : '';
    const isExponent = prev !== '' && /[0-9.]/.test(prev);
    if (isExponent) continue; // scientific notation exponent — not a command
    // This letter is a path command
    if (ch >= 'a' && ch <= 'z') {
      throw new Error(
        `segmentCells: relative path command '${ch}' found in d="${d.slice(0, 60)}…" — corpus paths must use absolute commands`,
      );
    }
  }

  // Extract all coordinate numbers from d (signed floats / scientific notation)
  const numberRe = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const coords: number[] = [];
  let numMatch: RegExpExecArray | null;
  while ((numMatch = numberRe.exec(d)) !== null) {
    coords.push(Number(numMatch[0]));
  }

  if (coords.length === 0) return null;

  // Pair up as x,y — but path coords aren't always x,y pairs in isolation (e.g. H/V/A have
  // different arities). For bbox purposes (brief says "acceptable" to over-inflate from control
  // points), just take min/max of all numbers assuming alternating x,y pairs from the full list.
  // This is per-brief: "regex all coordinate pairs from d, min/max them".
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < coords.length; i += 2) {
    const x = coords[i]!;
    const y = coords[i + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // If odd count, the last number is unpaired — include it in both x and y ranges
  if (coords.length % 2 === 1) {
    const last = coords[coords.length - 1]!;
    if (last < minX) minX = last;
    if (last > maxX) maxX = last;
    if (last < minY) minY = last;
    if (last > maxY) maxY = last;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;

  return { x: minX, y: minY, x2: maxX, y2: maxY };
}

function rectIntersectArea(a: BBox, b: BBox): number {
  const ix = Math.min(a.x2, b.x2) - Math.max(a.x, b.x);
  const iy = Math.min(a.y2, b.y2) - Math.max(a.y, b.y);
  if (ix <= 0 || iy <= 0) return 0;
  return ix * iy;
}
