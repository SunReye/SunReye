/**
 * The motion tier as reactive state — the rune shell over `./tier`.
 *
 * Deliberately thin, for the same reason `plant-ceiling.svelte.ts` is: every
 * decision that can be wrong (who outranks whom, what a slow frame is, what a
 * corrupt stored value means) is plain TS next door, where `bun test` reaches
 * it. What lives here is a `$state`, a `localStorage` key, a media query and one
 * `requestAnimationFrame` loop.
 *
 * The setting is stored per DEVICE, not on the server: the wall tablet in the
 * hallway and the laptop in the office read the same plant and do not have the
 * same frame budget, and an instance-wide preference would make one of them
 * wrong. That is also why the measured strain is stored — a tablet that had to
 * be downgraded yesterday should start lean today rather than stutter through
 * another window of frames first.
 */

import { MediaQuery } from "svelte/reactivity";
import {
  clampStrain,
  FrameStrain,
  MAX_STRAIN,
  type MotionSetting,
  type MotionTier,
  parseStrain,
  resolveTier,
} from "./tier";

const SETTING_KEY = "sunreye.motion";
const STRAIN_KEY = "sunreye.motion-strain";

/**
 * How long after the lease the frame watch starts.
 *
 * Boot is the least representative moment a page has: the manifest lands, the
 * backfill lands, the diagram measures itself and every readout mounts. Judging
 * the device on that would downgrade hardware that is perfectly fine once the
 * page is standing.
 */
const SETTLE_MS = 4000;

/**
 * How many windows the watch judges before it gives up and stops.
 *
 * Bounded on purpose, and this is the subtle part: a pending
 * `requestAnimationFrame` makes the browser produce frames it would otherwise
 * skip. An endless watch would therefore hold a kiosk showing a still diagram
 * at its display rate — measured, the `still` tier idles at 1.1 frames a second
 * against ~59 with a loop pending — and spend the very frames the tier exists
 * to save. Three windows is ~6 s of watching after the page settles, which is
 * where a device short of frames declares itself; a downgrade starts a fresh
 * count, so a device can still fall the whole ladder in one visit.
 */
const WATCH_WINDOWS = 3;

/** Storage can be absent (SSR) or refused (private mode, embedded webview). */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A device that cannot persist it still honours it for this session.
  }
}

/** A stored setting, or `auto` for anything this build does not recognise. */
function readSetting(): MotionSetting {
  const raw = read(SETTING_KEY);
  return raw === "full" || raw === "lite" || raw === "still" ? raw : "auto";
}

class MotionStore {
  #setting = $state<MotionSetting>(readSetting());
  #strain = $state(parseStrain(read(STRAIN_KEY)));
  // Tracked, so flipping the OS preference repaints without a reload.
  #reduce = new MediaQuery("(prefers-reduced-motion: reduce)");

  #frames = new FrameStrain();
  #raf: number | null = null;
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  #leases = 0;

  /** What to render. Everything on the page branches on this and nothing else. */
  get tier(): MotionTier {
    return resolveTier(this.#setting, this.#reduce.current, this.#strain);
  }

  /** Nothing may move at all — the `prefers-reduced-motion` picture. */
  get still(): boolean {
    return this.tier === "still";
  }

  /** Motion is allowed, but not the expensive kind (filters, comet chains). */
  get lite(): boolean {
    return this.tier === "lite";
  }

  /** What the viewer picked, which is not what is rendered — see {@link tier}. */
  get setting(): MotionSetting {
    return this.#setting;
  }

  set setting(next: MotionSetting) {
    this.#setting = next;
    write(SETTING_KEY, next);
    // Leaving `auto` stops the watch; returning to it re-measures from zero, so
    // a device that was downgraded by a one-off storm gets a second opinion.
    if (next === "auto") this.#resetStrain();
    this.#sync();
  }

  /** Whether `auto` has measured this device down a tier. Shown in settings. */
  get measuredStrain(): number {
    return this.#strain;
  }

  /**
   * Watch this device's frames while the app shell is mounted; the disposer
   * stops the loop. Refcounted, so a second caller costs nothing.
   *
   * `requestAnimationFrame` is the right clock and the cheap one: the callback
   * reads no layout and allocates nothing, and the browser stops calling it
   * entirely while the tab is hidden — which is also why a wake-up cannot be
   * mistaken for jank (`GAP_CEILING_MS` in `./tier`).
   */
  watch(): () => void {
    this.#leases += 1;
    this.#sync();
    let released = false;
    return () => {
      // A Svelte cleanup can run twice; a second decrement would stop the watch
      // out from under a shell that is still mounted.
      if (released) return;
      released = true;
      this.#leases -= 1;
      this.#sync();
    };
  }

  /** Start or stop the loop to match what is currently worth measuring. */
  #sync(): void {
    const wanted =
      this.#leases > 0 &&
      this.#setting === "auto" &&
      this.#strain < MAX_STRAIN &&
      !this.#reduce.current &&
      typeof requestAnimationFrame === "function";
    if (wanted) this.#start();
    else this.#stop();
  }

  #start(): void {
    if (this.#raf !== null || this.#settleTimer !== null) return;
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = null;
      this.#frames = new FrameStrain();
      this.#tick();
    }, SETTLE_MS);
  }

  #tick(): void {
    this.#raf = requestAnimationFrame((ts) => {
      this.#raf = null;
      const strained = this.#frames.sample(ts);
      if (strained) {
        // A fresh window count: the next tier gets judged on its own merits.
        this.#frames = new FrameStrain();
        this.#downgrade();
        return;
      }
      if (this.#frames.windows >= WATCH_WINDOWS) return;
      if (this.#leases > 0 && this.#strain < MAX_STRAIN) this.#tick();
    });
  }

  #downgrade(): void {
    this.#strain = clampStrain(this.#strain + 1);
    write(STRAIN_KEY, String(this.#strain));
    // Re-arm through `#start`'s settle delay: the tier change itself rebuilds
    // part of the hero, and that rebuild is not evidence about the device.
    this.#sync();
    this.#start();
  }

  #resetStrain(): void {
    this.#strain = 0;
    write(STRAIN_KEY, "0");
  }

  #stop(): void {
    if (this.#settleTimer !== null) {
      clearTimeout(this.#settleTimer);
      this.#settleTimer = null;
    }
    if (this.#raf !== null) {
      cancelAnimationFrame(this.#raf);
      this.#raf = null;
    }
  }
}

export const motion = new MotionStore();
