// Geometry shared by the two gliding live charts (live-area, custom-live-chart).
//
// Both render a FIXED window anchored to the newest sample, so `data`/`xDomain`
// change only when a sample lands (~1 Hz) — that bounds LayerChart's scale, spline
// and tooltip-index work to sample cadence instead of every animation frame. The
// per-frame motion is a transform on the marks group only (see `glideOffset`).

/** Intervals of off-screen buffer kept past the window's left edge. */
const BUFFER_INTERVALS = 6;

/**
 * Spacing between the two newest samples, clamped to [250ms, 5s]. Measured from the
 * data (not wall clock) so it is correct for any feed. The 5s ceiling is deliberate:
 * past that the chart should step rather than crawl a cursor across the window.
 * Falls back to 1s until two samples exist.
 */
export function sampleInterval(newest: number | undefined, previous: number | undefined): number {
  if (newest === undefined || previous === undefined) return 1000;
  return Math.min(Math.max(newest - previous, 250), 5000);
}

/**
 * Left edge of the render buffer — the visible window plus a few intervals of slack,
 * so the continuous glide never reveals empty space. `ChartClipPath` around the
 * marks hides everything outside the window itself.
 */
export function bufferStart(newest: number, windowMs: number, interval: number): number {
  return newest - windowMs - BUFFER_INTERVALS * interval;
}

/**
 * Pixel offset that scrolls the marks group so its visible right edge tracks the
 * interpolated `cursor` instead of snapping per sample. `xScale` maps time→pixel for
 * the fixed domain, so this resolves to a compositor-friendly transform on a single
 * `<g>` — no path, scale or tooltip-index recompute. The newest sample trails one
 * interval off-screen to the right and glides in under the feathered edge.
 */
export function glideOffset(
  xScale: (t: number) => number,
  newest: number | undefined,
  cursor: number,
  interval: number,
): number {
  if (newest === undefined) return 0;
  return xScale(newest) - xScale(cursor - interval);
}
