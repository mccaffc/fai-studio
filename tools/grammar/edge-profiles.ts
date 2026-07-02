/**
 * edge-profiles.ts — per-variant edge bit-profiles for true edge-matching.
 *
 * Edge ACTIVITY (a scalar coverage fraction) says "something touches this
 * edge"; it cannot say whether two tiles' line-work actually LINES UP at the
 * seam. The canonical banners' signature — pipes/stripes flowing unbroken
 * across cells — needs the edge PROFILE: which pixels along the edge are ink.
 *
 * Profiles are computed from the SAME 64×64 masks the matcher uses, for all
 * 8 rotation/flip variants via the verified transformMask — so no orientation
 * math is re-derived here (dedup in the library is bypassed by transforming
 * the rot-0 mask directly). A profile is a 64-bit vector hex-encoded to 16
 * chars; ~44KB total in grammar.json for the 85-tile catalog.
 *
 * Join rule: profileIoU(A.right, B.left) — intersection/union of set bits.
 * Both-empty → 0 (an empty seam is not a join; activity gates emptiness).
 */

import type { TileMaskEntry } from '../mine/tile-match.js';
import { transformMask } from '../mine/tile-match.js';

export interface EdgeProfileSet { top: string; right: string; bottom: string; left: string }
export type VariantKey = `${0 | 90 | 180 | 270}/${'f' | '-'}`;
export type TileEdgeProfiles = Record<VariantKey, EdgeProfileSet>;

const ROTATIONS = [0, 90, 180, 270] as const;
const SIZE = 64;

function bitsToHex(bits: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += ((bits[i]! << 3) | (bits[i + 1]! << 2) | (bits[i + 2]! << 1) | bits[i + 3]!).toString(16);
  }
  return hex;
}

export function maskEdgeProfiles(mask: Uint8Array, size = SIZE): EdgeProfileSet {
  const top = new Uint8Array(size), bottom = new Uint8Array(size);
  const left = new Uint8Array(size), right = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    top[i] = mask[i]!;
    bottom[i] = mask[(size - 1) * size + i]!;
    left[i] = mask[i * size]!;
    right[i] = mask[i * size + size - 1]!;
  }
  return { top: bitsToHex(top), right: bitsToHex(right), bottom: bitsToHex(bottom), left: bitsToHex(left) };
}

/** Build all-variant profiles for every tile present in the library (rot-0 masks + transformMask). */
export function buildEdgeProfiles(lib: TileMaskEntry[], size = SIZE): Record<string, TileEdgeProfiles> {
  const out: Record<string, TileEdgeProfiles> = {};
  const rot0 = new Map<string, Uint8Array>();
  for (const e of lib) if (e.rotation === 0 && !e.flip) rot0.set(e.tile, e.mask);
  for (const [tile, mask] of [...rot0.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const profiles = {} as TileEdgeProfiles;
    for (const rotation of ROTATIONS) {
      for (const flip of [false, true]) {
        const key = `${rotation}/${flip ? 'f' : '-'}` as VariantKey;
        profiles[key] = maskEdgeProfiles(transformMask(mask, size, rotation, flip), size);
      }
    }
    out[tile] = profiles;
  }
  return out;
}

/** IoU over set bits of two hex-encoded profiles. Both empty → 0. */
export function profileIoU(aHex: string, bHex: string): number {
  let inter = 0, union = 0;
  for (let i = 0; i < aHex.length; i++) {
    const a = parseInt(aHex[i]!, 16), b = parseInt(bHex[i]!, 16);
    inter += popcount4(a & b);
    union += popcount4(a | b);
  }
  return union === 0 ? 0 : inter / union;
}

function popcount4(n: number): number {
  return (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
}
