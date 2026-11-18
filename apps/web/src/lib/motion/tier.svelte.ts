/**
 * The motion tier as reactive state: the rune shell over `./tier`.
 * Ported from v3 (dev 780b4e2, lib/motion/tier.svelte.ts) with ADR 21's changes: the motion
 * setting offers no still, and the low-power switch forces `still`.
 * The measured strain is kept per device, so a slow wall tablet starts lean the next day.
 */
import { forget, read, write } from "../kept.ts";
import { MediaQuery } from "svelte/reactivity";
import { quality as sceneQuality, type QualityStore } from "../scene/quality.svelte.ts";
import {
  clampStrain,
  FrameStrain,
  LOOP_JANK_FRAME_MS,
  LOW_POWER,
  MAX_STRAIN,
  MOTION_SETTING,
  type MotionSetting,
  type MotionTier,
  parseMotionSetting,
  parseStrain,
  resolveTier,
} from "./tier.ts";

const STRAIN_KEY = "sunreye.motion-strain";

/** Boot is the least representative moment a page has; the watch starts once it has settled. */
const SETTLE_MS = 4000;

/**
 * Windows judged before the watch stops. Bounded because a pending `requestAnimationFrame` makes
 * the browser produce frames it would otherwise skip, which is what the lean tiers exist to save.
 */
const WATCH_WINDOWS = 3;

export class MotionStore {
  #strain = $state(parseStrain(read(STRAIN_KEY)));
  #reduce = new MediaQuery("(prefers-reduced-motion: reduce)");
  /** The low-power switch (ADR 21): all of it is instant and nothing moves. */
  #lowPower = $state(read(LOW_POWER) === "on");
  #setting = $state(parseMotionSetting(read(MOTION_SETTING)));

  #frames = new FrameStrain();
  /** The frames of a loop that draws on its own, judged by its own rate. */
  #looped = new FrameStrain(LOOP_JANK_FRAME_MS);
  #raf: number | null = null;
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  #leases = 0;
  /** A strain measured over a scene drawn richly takes a level off its 3D quality first (ADR 20). */
  readonly #quality: QualityStore;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- its steps are taken.
  constructor(quality: QualityStore = sceneQuality) {
    this.#quality = quality;
  }

  /** What to render. Everything on the page branches on this and nothing else. */
  get tier(): MotionTier {
    if (this.#lowPower) return "still";

    return resolveTier(this.#reduce.current, this.#strain, this.#setting);
  }

  /** The tier the frame watch has measured for this device, whatever is rendered. */
  get measured(): MotionTier {
    return resolveTier(false, this.#strain);
  }

  get still(): boolean {
    return this.tier === "still";
  }

  get lowPower(): boolean {
    return this.#lowPower;
  }

  /** Kept per browser. */
  set lowPower(on: boolean) {
    this.#lowPower = on;
    write(LOW_POWER, on ? "on" : "off");
    this.#sync();
  }

  get setting(): MotionSetting {
    return this.#setting;
  }

  /** Kept per browser. A chosen tier holds: strain no longer lowers it. */
  set setting(next: MotionSetting) {
    this.#setting = next;
    write(MOTION_SETTING, next);
    this.#sync();
  }

  /** Neu messen: forgets the measured strain, so the device is on full and the watch starts over. */
  remeasure(): void {
    this.#strain = 0;
    forget(STRAIN_KEY);
    this.#sync();
  }

  /** Watch this device's frames while the shell is mounted; the disposer stops the loop. */
  watch(): () => void {
    this.#leases += 1;
    this.#sync();
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.#leases -= 1;
      this.#sync();
    };
  }

  /**
   * A frame the display gave a loop that draws on its own (ADR 23 "Motion"): judged by the
   * loop's rate, for as long as it runs. The watch stops after a few windows; a loop that
   * starts an hour later is what strains the device then.
   */
  frame(ts: number): void {
    // Settling is no evidence, and the still tier has nothing to give.
    if (this.#settleTimer !== null || this.still || !this.#gives()) return;

    if (this.#looped.sample(ts)) this.#strained();
  }

  #sync(): void {
    const wanted = this.#leases > 0 && !this.#lowPower && !this.#reduce.current && this.#gives();

    if (wanted) this.#start();
    else this.#stop();
  }

  /** Whether a strain could still lower anything: the tier on Automatisch, or the scene's drawing. */
  #gives(): boolean {
    const tierGives = this.#setting === "auto" && this.#strain < MAX_STRAIN;

    return tierGives || this.#quality.relieves(this.tier);
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

      if (this.#frames.sample(ts)) {
        this.#strained();

        return;
      }

      if (this.#frames.windows >= WATCH_WINDOWS) return;

      if (this.#leases > 0 && this.#gives()) this.#tick();
    });
  }

  #strained(): void {
    // A fresh window count: the next tier gets judged on its own merits.
    this.#frames = new FrameStrain();
    this.#looped = new FrameStrain(LOOP_JANK_FRAME_MS);
    this.#downgrade();
  }

  #downgrade(): void {
    if (!this.#quality.relieve(this.tier)) {
      this.#strain = clampStrain(this.#strain + 1);
      write(STRAIN_KEY, String(this.#strain));
    }

    // Through the settle delay again: the tier change rebuilds part of the hero, which is not evidence.
    this.#sync();
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
