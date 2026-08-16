/**
 * Keeping chart-space marks honest under a narrowed band domain.
 *
 * Marks that position themselves by looking a band up in `context.xScale` — the
 * price track's negative-window shading and its "now" rule — get `undefined`
 * for a band outside the domain, which `bandSpan` reads as x = 0. The mark does
 * not disappear; it moves to the left edge and lies, turning "the evening was
 * free" into "the morning was free".
 *
 * Inert on layerchart 2.2.0, deliberately. `_computeTransformDomain`
 * (chart.svelte.js) returns the base domain unchanged unless its first value is
 * a number or a Date, so a band scale — whose domain is a string array — is
 * never narrowed: band charts zoom by widening the *range* instead, and every
 * band stays in the domain at an off-viewport x the chart clips for us. These
 * helpers are therefore a no-op today (`visible === all`), kept because the
 * failure they prevent is silent and the library's band-zoom strategy is an
 * implementation detail we do not control.
 */

/** Where the visible domain sits in the full band list, or null if nowhere. */
// fallow-ignore-next-line unused-export -- the window rule, tested directly; clipRunsToDomain consumes it and would hide the empty/missing-band cases behind its own filtering
export function visibleBandRange(
  all: readonly string[],
  visible: readonly string[],
): [number, number] | null {
  if (all.length === 0 || visible.length === 0) return null;
  const first = all.indexOf(visible[0]);
  const last = all.indexOf(visible[visible.length - 1]);
  // A domain can outlive the rows it was built from for a frame after a
  // refetch; positions that no longer exist are not a window to clip against.
  if (first < 0 || last < 0) return null;
  return first <= last ? [first, last] : [last, first];
}

/** A stretch of consecutive bands, named by its edges. */
export type BandRun = { first: string; last: string };

/**
 * `runs` reduced to the part of each that the visible domain still draws. A run
 * entirely outside is dropped; one that straddles an edge is clipped to it. The
 * rest of the run's fields ride along, because callers key their `{#each}` on
 * them.
 */
export function clipRunsToDomain<T extends BandRun>(
  runs: readonly T[],
  all: readonly string[],
  visible: readonly string[],
): T[] {
  const window = visibleBandRange(all, visible);
  if (window === null) return [];
  const [low, high] = window;
  const clipped: T[] = [];
  for (const run of runs) {
    const first = all.indexOf(run.first);
    const last = all.indexOf(run.last);
    if (first < 0 || last < 0) continue;
    if (last < low || first > high) continue;
    clipped.push({ ...run, first: all[Math.max(first, low)], last: all[Math.min(last, high)] });
  }
  return clipped;
}

/** Is this single band one the (possibly zoomed) domain still draws? */
export function isBandVisible(
  value: string | null | undefined,
  visible: readonly string[],
): boolean {
  return value != null && visible.includes(value);
}
