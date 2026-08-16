// Geometry shared by the two gliding live charts (live-area, custom-live-chart).
//
// Both render a FIXED window anchored to the newest sample, so `data`/`xDomain`
// change only when a sample lands (~1 Hz) — that bounds LayerChart's scale, spline
// and tooltip-index work to sample cadence instead of every animation frame. The
// per-frame motion is a transform on the marks group only (see `glideOffset`).

/** Intervals of off-screen buffer kept past the window's left edge. */
const BUFFER_INTERVALS = 6;

/**
 * The step the glide snaps to, in CSS px.
 *
 * A quarter pixel: fine enough that the motion still reads as continuous (the
 * window is ~2 minutes across ~250-500 CSS px, i.e. ~0.05 CSS px per 60Hz frame,
 * so this advances roughly every fifth frame — ~11 writes/second instead of 60),
 * coarse enough that four frames in five write nothing at all. Going finer buys
 * no visible smoothness and gives the saving straight back: below ~0.1 px the
 * frame skip collapses toward 60 writes/second per chart.
 */
const QUANTUM_CSS_PX = 0.25;

/** Absurd devicePixelRatios are treated as this, so a bogus value cannot shrink
 *  the quantum toward zero and silently restore a write on every frame. */
const MAX_DPR = 4;

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
 *
 * Module-private: the UNSNAPPED offset is a fresh float every frame, and handing
 * it to a component is the 60-writes-per-second regression this module exists to
 * stop. {@link glideTransform} is the only way out of here.
 */
function glideOffset(
  xScale: (t: number) => number,
  newest: number | undefined,
  cursor: number,
  interval: number,
): number {
  if (newest === undefined) return 0;
  return xScale(newest) - xScale(cursor - interval);
}

/**
 * Smallest offset step worth writing, in CSS px.
 *
 * The trade is explicit: a sub-perceptual amount of positional precision (at
 * most half a quantum, an eighth of a CSS pixel) in exchange for a large
 * reduction in style invalidation, paint and raster work — four frames in five
 * write nothing at all.
 *
 * It is NOT the case that a sub-pixel move "rasterises to the pixels already on
 * screen". Antialiased vector edges change coverage continuously, so a sub-pixel
 * translate is visible; snapping to a WHOLE pixel was measured in a real browser
 * as a 1px stutter roughly every 450ms. Hence a quarter-pixel step, not a
 * device-pixel one.
 *
 * `dpr` only guards the floor: the step never goes finer than one device pixel,
 * and an absent, bogus or absurd ratio falls back to the 1x step rather than
 * dividing by zero or producing a sub-nanometre quantum.
 */
export function pixelQuantum(dpr: number | undefined): number {
  const ratio = typeof dpr === "number" && Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const devicePixel = 1 / Math.min(Math.max(ratio, 1), MAX_DPR);
  return Math.min(QUANTUM_CSS_PX, devicePixel);
}

/**
 * Snap an offset onto the glide's step grid.
 *
 * A pure snap of the EXACT offset, never an accumulation of steps, so the error
 * stays at or below half a quantum and the glide cannot drift away from its own
 * data over a long session.
 *
 * Module-private for the same reason as {@link glideOffset}: it is a step of the
 * transform, not a value a component has any business assembling itself.
 */
function snapToPixelGrid(offset: number, quantum: number): number {
  if (!Number.isFinite(offset)) return 0;
  if (!(quantum > 0)) return offset;
  return Math.round(offset / quantum) * quantum;
}

/**
 * The value for the marks group's SVG `transform` attribute.
 *
 * Returns a STRING on purpose: Svelte's derived equality is `!==`, so on the
 * four frames in five where the snapped offset is unchanged the string is
 * identical, the derived does not propagate, and no DOM write, style
 * invalidation, paint or raster happens at all. The saving comes from the
 * skipped frames, not from the kind of transform — a CSS `translate3d` on this
 * group was tried and reverted: it cannot be compositor-promoted inside the
 * ChartClipPath under the container's mask, so it only added transform-box and
 * user-unit-vs-px risk for no measurable benefit.
 *
 * Bare user units, no `px`: the SVG attribute grammar rejects CSS lengths.
 */
export function glideTransform(
  xScale: (t: number) => number,
  newest: number | undefined,
  cursor: number,
  interval: number,
  quantum: number,
): string {
  const offset = snapToPixelGrid(glideOffset(xScale, newest, cursor, interval), quantum);
  // `+ 0` normalizes -0, which would otherwise reach the DOM as "-0".
  return `translate(${offset + 0},0)`;
}
