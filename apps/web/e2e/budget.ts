// ADR 21's smoothness budget: no frame over 50 ms, the 95th percentile at most 20 ms.

const LONGEST_MS = 50;
const P95_MS = 20;

export interface Verdict {
  readonly pass: boolean;
  /** ms */
  readonly max: number;
  /** ms, nearest rank. */
  readonly p95: number;
  readonly frames: number;
}

/** Judges a journey by its frame durations in ms; one that drew nothing failed to run. */
export function verdict(frames: readonly number[]): Verdict {
  const sorted = frames.toSorted((a, b) => a - b);
  const max = sorted.at(-1) ?? Number.NaN;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.NaN;

  return { pass: max <= LONGEST_MS && p95 <= P95_MS, max, p95, frames: sorted.length };
}
