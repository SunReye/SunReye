// Reducing a series to what the box it is drawn in can actually resolve.
//
// A /history card is about 450 CSS px wide and receives ~1876 rollup rows for a
// preset range. Of the 278ms a card mount cost when this was measured, ~270ms
// was d3 turning those rows into path data — not the fetch (35ms), not
// JSON.parse (3ms), not the date mapping (4.7ms). Every row past roughly one
// per device pixel buys a sub-pixel wobble nobody can see.
//
// Why LTTB (largest-triangle-three-buckets) and not "every nth row": a stride
// sampler drops the one-sample spike that is the reason somebody opened a
// battery-power chart. LTTB splits the series into as many buckets as the cap
// allows and keeps, from each, the row spanning the largest triangle with the
// row already kept and the next bucket's centre of mass — an outlier is the
// widest triangle in its bucket, so an outlier is what survives.

/** How to read a plottable x/y out of whatever row shape a chart holds. */
export interface PointAccess<T> {
  x: (point: T) => number;
  y: (point: T) => number;
}

/**
 * Rows a plot keeps however narrow it is measured. A card mid-collapse can
 * report a handful of pixels for a frame, and a cap of three there would throw
 * the series away permanently for any caller memoising the result.
 */
const MIN_BUDGET = 64;

/**
 * Rows worth drawing into a plot of `plotWidth` CSS px — about one per device
 * pixel, which is already more than a 1.5px stroke can separate.
 *
 * An unmeasured width (`0`, from `bind:clientWidth` before the element is in
 * the document) imposes NO cap: reducing against a guessed width would draw the
 * wrong series and then redraw it, which is the cost this module exists to
 * remove.
 */
export function pointBudget(plotWidth: number, devicePixelRatio = 1): number {
  if (!Number.isFinite(plotWidth) || plotWidth <= 0) return Number.POSITIVE_INFINITY;
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(MIN_BUDGET, Math.round(plotWidth * dpr));
}

/**
 * `points`, reduced to at most `maxPoints` rows, first and last kept and
 * visual extremes preserved.
 *
 * A cap it cannot honour — below 2, or not a number — is ignored rather than
 * obeyed: two rows is the minimum that draws a line, and blanking a chart is a
 * worse answer than drawing every row we were given.
 */
export function downsample<T>(
  points: readonly T[],
  maxPoints: number,
  access: PointAccess<T>,
): T[] {
  const cap = Math.floor(maxPoints);
  if (!Number.isFinite(cap) || cap < 2) return [...points];
  if (points.length <= cap) return [...points];
  if (cap === 2) return [points[0], points[points.length - 1]];
  return largestTriangleThreeBuckets(points, cap, access);
}

function largestTriangleThreeBuckets<T>(
  points: readonly T[],
  cap: number,
  access: PointAccess<T>,
): T[] {
  const last = points.length - 1;
  // The interior rows, spread over the buckets the cap leaves once both
  // endpoints are reserved. Strictly greater than 1 because `points` is longer
  // than the cap, so no bucket can come out empty.
  const bucketSize = (last - 1) / (cap - 2);
  const edge = (bucket: number) => Math.min(Math.floor(bucket * bucketSize) + 1, last);

  const kept: T[] = [points[0]];
  let previous = points[0];
  for (let bucket = 0; bucket < cap - 2; bucket++) {
    const next = centre(points, edge(bucket + 1), edge(bucket + 2), access);
    previous = widestOf(points, edge(bucket), edge(bucket + 1), previous, next, access);
    kept.push(previous);
  }
  kept.push(points[last]);
  return kept;
}

/** A point in plot space — a real row, or a bucket's centre of mass. */
type Plotted = { x: number; y: number };

/**
 * The mean of `points[from…to)`, skipping values that are not finite: a rollup
 * gap arrives as `null` and maps to `NaN`, and one of those would otherwise
 * poison every triangle measured against this bucket.
 */
function centre<T>(
  points: readonly T[],
  from: number,
  to: number,
  access: PointAccess<T>,
): Plotted {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = from; i < Math.min(to, points.length); i++) {
    const [x, y] = [access.x(points[i]), access.y(points[i])];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sumX += x;
    sumY += y;
    count++;
  }
  const fallback = points[Math.min(from, points.length - 1)];
  return count === 0
    ? { x: access.x(fallback), y: access.y(fallback) }
    : { x: sumX / count, y: sumY / count };
}

/**
 * The row in `points[from…to)` spanning the largest triangle with `previous`
 * and `next`. Ties — and a whole bucket of degenerate zero-area triangles, as
 * a series of identical timestamps produces — keep the earliest row, so the
 * result stays in order and never repeats one.
 */
function widestOf<T>(
  points: readonly T[],
  from: number,
  to: number,
  previous: T,
  next: Plotted,
  access: PointAccess<T>,
): T {
  const anchor = { x: access.x(previous), y: access.y(previous) };
  let best = points[from];
  let bestArea = -1;
  for (let i = from; i < to; i++) {
    const area = triangleArea(anchor, { x: access.x(points[i]), y: access.y(points[i]) }, next);
    if (area > bestArea) {
      bestArea = area;
      best = points[i];
    }
  }
  return best;
}

/** Twice the triangle's area — the factor of 2 cancels in every comparison. */
function triangleArea(a: Plotted, b: Plotted, c: Plotted): number {
  return Math.abs((a.x - c.x) * (b.y - a.y) - (a.x - b.x) * (c.y - a.y));
}
