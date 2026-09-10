/**
 * The GEOMETRY of a chunked scoring pass: how a span is cut into overlapping
 * chunks, and which of a chunk's segments may be recorded from it.
 *
 * Pure arithmetic over instants, no reads and no clock, so the boundaries that
 * matter — an empty span, an overlap that would never advance, a segment lying
 * against a cut edge, a segment lying against the span's own real edge — are
 * provable on their own. `./scoring-walk.ts` is the walk that uses this.
 */

import type { DischargeSegment } from "./capacity-estimate";

export interface Window {
  from: number;
  to: number;
}

/**
 * Split `[from, to)` into chunks of at most `chunkMs`, each starting `overlapMs`
 * before the previous one ended. The first starts at `from`, the last ends at
 * `to`, and an empty span is no chunks.
 */
export function planWindows(
  from: number,
  to: number,
  chunkMs: number,
  overlapMs: number,
): Window[] {
  if (overlapMs >= chunkMs) throw new Error("chunk overlap must be shorter than the chunk");
  const windows: Window[] = [];
  let start = from;
  while (start < to) {
    const end = Math.min(start + chunkMs, to);
    windows.push({ from: start, to: end });
    if (end >= to) break;
    start = end - overlapMs;
  }
  return windows;
}

/**
 * The segments of one chunk that are safe to record from it: those not touching
 * a cut edge. The span's own edges are real edges — the data really does start
 * and stop there — so a segment against them is kept.
 */
export function interiorSegments(
  segments: readonly DischargeSegment[],
  window: Window,
  span: Window,
  marginMs: number,
): DischargeSegment[] {
  const cutBelow = window.from > span.from;
  const cutAbove = window.to < span.to;
  return segments.filter(
    (s) =>
      !(cutBelow && s.startMs < window.from + marginMs) &&
      !(cutAbove && s.endMs > window.to - marginMs),
  );
}
