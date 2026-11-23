// Ported from v3 (dev 780b4e2, lib/motion/tier.ts); the motion setting offers no still (ADR 21).
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
 * So motion is a TIER, resolved from inputs that never collapse into one:
 *
 *   - the OS's `prefers-reduced-motion`, which is an accessibility instruction
 *     and outranks everything;
 *   - what the device has actually been observed to manage, unless the
 *     browser's motion setting chose a tier.
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

export { LOW_POWER } from "@sunreye/ui/low-power";

/** What is actually rendered. */
export type MotionTier =
  /** Everything: comet chains with their bloom, gliding readouts, the pulsing hub ring. */
  | "full"
  /** Motion kept, cost dropped: comets without the filter bloom, fewer beads, no ring pulse. */
  | "lite"
  /** No motion at all — reduced motion or the low-power switch: still overlays, snapping readouts. */
  | "still";

/** Where each browser keeps its motion setting (ADR 21): "auto", "full" or "lite"; unset reads as "auto". */
export const MOTION_SETTING = "sunreye.motion";

/** What the motion setting offers: Automatisch, where the frame watch decides, or a tier that holds.
 * Still is the off switches' alone. */
export const MOTION_SETTINGS = ["auto", "full", "lite"] as const;

export type MotionSetting = (typeof MOTION_SETTINGS)[number];

/** A kept setting; anything unreadable is Automatisch. */
export function parseMotionSetting(raw: string | null): MotionSetting {
  return MOTION_SETTINGS.find((setting) => setting === raw) ?? "auto";
}

/** How many strikes a device can take before it is at the bottom of what strain can reach. */
export const MAX_STRAIN = 1;

/**
 * The tier rendered at each strain level, worst case last. Strain stops at lite: still is the
 * off switches' picture, never the frame watch's (ADR 21).
 */
const TIERS: readonly MotionTier[] = ["full", "lite"];

/** The tier to render: `reduceMotion` wins over a chosen tier, which wins over the strain. */
export function resolveTier(
  reduceMotion: boolean,
  strain: number,
  setting: MotionSetting = "auto",
): MotionTier {
  if (reduceMotion) return "still";

  if (setting !== "auto") return setting;

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

/** Where each browser keeps the strain its motion tier was measured at. */
export const MOTION_STRAIN = "sunreye.motion-strain";

/** Where each browser keeps when its last strain was measured, the tier's or the 3D quality's:
 * milliseconds since the epoch. The motion store alone writes it. */
export const STRAINED_AT = "sunreye.strained-at";

/** A strain lasts seven days (ADR 21): one slow stretch must not hold a device down for good. */
export const STRAIN_LASTS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Milliseconds the strain dated `raw` still lasts at `now`; 0 once it is to be forgotten. A
 * strain without a readable date is from before strains were dated, and counts as that old.
 * Never more than the seven days: a clock set back since leaves a date after `now`, and a wait
 * past the 2^31 ms a timer holds would end at once.
 */
export function strainLeft(raw: string | null | undefined, now: number): number {
  const at = raw === null || raw === undefined ? Number.NaN : Number(raw);

  if (!Number.isFinite(at)) return 0;

  return Math.min(STRAIN_LASTS_MS, Math.max(0, at + STRAIN_LASTS_MS - now));
}

/**
 * A frame slower than this is one the viewer felt. 32 ms is two 60 Hz frames:
 * below it the page is dropping at least every other frame.
 */
export const JANK_FRAME_MS = 32;

/**
 * The same for the weather loop (ADR 23 "Motion"), which draws 30 times a second by design: a
 * draw that misses one frame of a 60 Hz display still holds the loop's rate. Felt is a gap that
 * misses the loop's own 30th of a second, by half as much again.
 */
export const LOOP_JANK_FRAME_MS = 48;

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
  readonly #jankMs: number;

  /** `jankMs`: a frame at least this long was felt. */
  constructor(jankMs: number = JANK_FRAME_MS) {
    this.#jankMs = jankMs;
  }

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

    if (gap >= this.#jankMs) this.#janky += 1;

    if (this.#frames < STRAIN_WINDOW) return false;

    const strained = this.#janky / this.#frames >= STRAIN_RATIO;
    this.#frames = 0;
    this.#janky = 0;
    this.#windows += 1;

    return strained;
  }
}
