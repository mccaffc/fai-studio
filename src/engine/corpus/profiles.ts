/**
 * profiles.ts — the PURE parts of edge-profile matching (engine-side).
 *
 * Edge ACTIVITY (a scalar coverage fraction) says "something touches this
 * edge"; the edge PROFILE says which pixels along the edge are ink, so two
 * tiles can be tested for whether their line-work actually LINES UP at the
 * seam. A profile is a 64-bit vector hex-encoded to 16 chars.
 *
 * Only the mask-INDEPENDENT pieces live here so the engine stays zero-dep:
 * `profileIoU` (join test), `popcount4`, and the profile-set types. The
 * mask-dependent builders (buildEdgeProfiles, maskEdgeProfiles, bitsToHex)
 * stay in tools/grammar/edge-profiles.ts, which re-imports these.
 *
 * Join rule: profileIoU(A.right, B.left) — intersection/union of set bits.
 * Both-empty → 0 (an empty seam is not a join; activity gates emptiness).
 */

import type { EdgeProfileSet, VariantKey } from './types.js';

export type { EdgeProfileSet, VariantKey } from './types.js';
export type TileEdgeProfiles = Record<VariantKey, EdgeProfileSet>;

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

export function popcount4(n: number): number {
  return (n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1);
}
