// Ported from v3 (dev 780b4e2, lib/motion/tier.ts) without the motion setting (ADR 21).
/**
 * How much motion this DEVICE can afford — the decision, as plain TS.
 *
 * The dashboard is read on wall tablets (a Fire HD 10 and friends) as often as
 * on a desktop, and those two do not have the same frame budget. Measured on
 * the idle overview at 6× CPU throttle, one frame costs ~15 ms of style, layout,
 * paint and compositing — and ~10 ms of that is the power-flow hero: the comet
 * chains' `blur()` + double `drop-shadow()` filter, the SMIL `<animateMotion>`
 * attributes that invalidate style every frame, and the readouts' glide, which
 * writes ~365 text nodes a second. A machine that can absorb that shows a rich
 * diagram; one that cannot shows a lagging one, then stops answering touches.
 *
 * So motion is a TIER, resolved from two inputs that never collapse into one:
 *
 *   - the OS's `prefers-reduced-motion`, which is an accessibility instruction
 *     and outranks everything;
 *   - what the device has actually been observed to manage.
 *
 * The second is the one that matters for the tablet, because no static signal
 * identifies it: a Fire HD 10 reports eight cores, and `navigator.deviceMemory`
 * is absent on its browser. What it cannot do is hold frames — so that is what
 * is measured. See {@link FrameStrain}.
 *
 * The rune shell that owns the low-power switch, the storage key and the rAF loop is
 * `./tier.svelte.ts`; every decision that can be wrong lives here, where
 * `bun test` reaches it.
 */

/** Where each browser keeps its low-power switch (ADR 21). */
export const LOW_POWER = "sunreye.low-power";

/** What is actually rendered. */
export type MotionTier =
  /** Everything: comet chains with their bloom, gliding readouts, the pulsing hub ring. */
  | "full"
  /** Motion kept, cost dropped: comets without the filter bloom, fewer beads, no ring pulse. */
  | "lite"
  /** No motion at all — reduced motion or the low-power switch: still overlays, snapping readouts. */
  | "still";

/** How many strikes a device can take before it is at the bottom of what strain can reach. */
export const MAX_STRAIN = 1;

/**
 * The tier rendered at each strain level, worst case last. Strain stops at lite: still is the
 * off switches' picture, never the frame watch's (ADR 21).
 */
const TIERS: readonly MotionTier[] = ["full", "lite"];

/** The tier to render: `reduceMotion` wins over whatever the device manages. */
export function resolveTier(reduceMotion: boolean, strain: number): MotionTier {
  if (reduceMotion) return "still";

  return TIERS[clampStrain(strain)]!;
}

/** A strain count from anywhere (storage, a caller) as a usable index. */
export function clampStrain(strain: number): number {
  // NaN first, and by name: `Math.min`/`Math.max` propagate it rather than
  // clamping it, so an unreadable count would resolve a tier from NaN. An
  // infinity, by contrast, is a legitimate "as bad as it gets" and clamps.
  if (Number.isNaN(strain)) return 0;

  return Math.min(MAX_STRAIN, Math.max(0, Math.trunc(strain)));
}

/**
 * Parse a persisted strain count. Anything unparseable is no strain: a device
 * starts optimistic, and one window of frames re-earns the downgrade in
 * seconds. Never the other way round — a corrupt entry must not pin a healthy
 * machine at the bottom tier forever.
 */
export function parseStrain(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;

  return clampStrain(Number(raw));
}

/**
 * A frame slower than this is one the viewer felt. 32 ms is two 60 Hz frames:
 * below it the page is dropping at least every other frame.
 */
export const JANK_FRAME_MS = 32;

/**
 * How much of a window has to be janky before the device is judged over budget.
 * Deliberately high — a scroll, a dialog opening or a chart mounting all drop
 * frames on hardware that is otherwise fine, and a downgrade is visible.
 */
export const STRAIN_RATIO = 0.35;

/** Frames judged together. At 60 Hz that is ~2 s; on a struggling device, more. */
export const STRAIN_WINDOW = 120;

/**
 * A gap longer than this is not a slow frame — it is a tab that was hidden, a
 * device that slept, or a debugger pause. Counting it as jank would downgrade a
 * kiosk every time somebody woke the screen.
 */
export const GAP_CEILING_MS = 2000;

/**
 * Rolling verdict on whether this device is holding its frames.
 *
 * Fed one rAF timestamp per frame; answers `true` exactly once per completed
 * window that was over budget, so a caller can count strikes without
 * de-duplicating. Windows do not overlap: a verdict resets the counters, so a
 * bad window cannot keep firing while the device recovers.
 *
 * Only downgrades are inferred from this. A device that starts holding frames
 * *because* it was downgraded would otherwise upgrade itself back into the
 * state that made it stutter, and oscillate there.
 */
export class FrameStrain {
  #last: number | null = null;
  #frames = 0;
  #janky = 0;
  #windows = 0;

  /**
   * How many windows have closed, strained or not.
   *
   * The watch is not free: a pending `requestAnimationFrame` makes the browser
   * produce frames it would otherwise skip, so a loop that never ended would
   * hold a quiet kiosk at its display rate for the sake of measuring it. The
   * caller watches for a few windows and then stops.
   */
  get windows(): number {
    return this.#windows;
  }

  /** Feed one rAF timestamp. `true` = the window that just closed was over budget. */
  sample(tsMs: number): boolean {
    const last = this.#last;

    // `performance.now()` is monotonic, so a backwards or unreadable timestamp
    // is garbage: it neither counts as a frame NOR moves the anchor. Letting it
    // move the anchor would manufacture a gap out of the jump itself and count
    // that as jank.
    if (!Number.isFinite(tsMs) || (last !== null && tsMs <= last)) return false;

    this.#last = tsMs;

    if (last === null) return false;

    const gap = tsMs - last;

    // Too long to be a frame at all: a hidden tab, a sleeping device, a paused
    // debugger. It re-anchors (above) but says nothing about the device.
    if (gap > GAP_CEILING_MS) return false;

    this.#frames += 1;

    if (gap >= JANK_FRAME_MS) this.#janky += 1;

    if (this.#frames < STRAIN_WINDOW) return false;

    const strained = this.#janky / this.#frames >= STRAIN_RATIO;
    this.#frames = 0;
    this.#janky = 0;
    this.#windows += 1;

    return strained;
  }
}
