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
  STRAINED_AT,
  strainLeft,
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
  #strain = $state(0);
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
  /** Loops that draw on their own: beside one the idle watch does not run (ADR 21). */
  #loops = 0;
  /** Scenes being prepared: nothing is evidence until their first frame is drawn (ADR 21). */
  #holds = 0;
  /** A strain measured over a scene drawn richly takes a level off its 3D quality first (ADR 20). */
  readonly #quality: QualityStore;
  readonly #now: () => number;
  /** Forgets both strains as their seven days end, on a page that never reloads. */
  #fresh: ReturnType<typeof setTimeout> | null = null;

  /** `now` dates a strain: it lasts seven days. */
  constructor(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- its steps are taken.
    quality: QualityStore = sceneQuality,
    now: () => number = () => Date.now(),
  ) {
    this.#quality = quality;
    this.#now = now;

    const left = strainLeft(read(STRAINED_AT), now());

    if (left > 0) {
      this.#strain = parseStrain(read(STRAIN_KEY));
      this.#lasts(left);
    }
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

  /** What forces still whatever the setting, if anything: the low-power switch, then reduced motion. */
  get held(): "low-power" | "reduced" | null {
    if (this.#lowPower) return "low-power";

    return this.#reduce.current ? "reduced" : null;
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

  /** Whether strain has stepped anything down: the tier, or Auto's 3D quality. */
  get stepped(): boolean {
    return this.#strain > 0 || this.#quality.stepped;
  }

  /** Neu messen: forgets both strains, so the device is on full, Auto draws from its start and
   * the watch starts over. */
  remeasure(): void {
    if (this.#fresh !== null) clearTimeout(this.#fresh);

    this.#fresh = null;
    this.#strain = 0;
    forget(STRAIN_KEY);
    forget(STRAINED_AT);
    this.#quality.remeasure();
    this.#sync();
  }

  /** Watch this device's frames while the shell is mounted; the disposer stops the loop. */
  watch(): () => void {
    this.#leases += 1;

    return this.#leased(() => {
      this.#leases -= 1;
    });
  }

  /** Whether a loop draws on its own now. Asked, never rendered: plain, so a loop that starts in
   * an effect tracks nothing. */
  get looping(): boolean {
    return this.#loops > 0;
  }

  /**
   * A loop draws on its own until the release (ADR 23 "Motion"): its frames, told with `frame`,
   * are the evidence, and the idle watch, which would judge them by its own stricter measure,
   * does not run beside it. It starts over, through the settle delay, once the last loop stops.
   */
  loop(): () => void {
    this.#loops += 1;
    this.#idle();

    return this.#leased(() => {
      this.#loops -= 1;
    });
  }

  /** A scene is being prepared until the release, its first frame drawn: compiling it is no
   * evidence, so the watch waits and settles from then. */
  hold(): () => void {
    this.#holds += 1;

    return this.#leased(() => {
      this.#holds -= 1;
    });
  }

  /**
   * A frame the display gave a loop that draws on its own (ADR 23 "Motion"): judged by the
   * loop's rate, for as long as it runs. The watch stops after a few windows; a loop that
   * starts an hour later is what strains the device then.
   */
  frame(ts: number): void {
    // Settling is no evidence, and the still tier has nothing to give.
    if (this.#settleTimer !== null || this.#holds > 0 || this.still || !this.#gives()) return;

    if (this.#looped.sample(ts)) this.#strained();
  }

  /** Syncs now, and once more after `release`, which runs once. */
  #leased(release: () => void): () => void {
    this.#sync();
    let released = false;

    return () => {
      if (released) return;

      released = true;
      release();
      this.#sync();
    };
  }

  #sync(): void {
    const free = this.#holds === 0 && !this.#lowPower && !this.#reduce.current;
    const wanted = this.#leases > 0 && free && this.#gives();

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

      if (this.#loops === 0) this.#tick();
    }, SETTLE_MS);
  }

  /** Ends the idle watch's frames; a settle delay that runs goes on. */
  #idle(): void {
    if (this.#raf !== null) cancelAnimationFrame(this.#raf);

    this.#raf = null;
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

    // Dated by this strain, whichever it lowered: both last seven days from the last one.
    write(STRAINED_AT, String(this.#now()));
    this.#lasts(strainLeft(String(this.#now()), this.#now()));

    // Through the settle delay again: the tier change rebuilds part of the hero, which is not evidence.
    this.#sync();
  }

  /** Both strains are forgotten `ms` from now, as Neu messen does. */
  #lasts(ms: number): void {
    if (this.#fresh !== null) clearTimeout(this.#fresh);

    this.#fresh = setTimeout(() => {
      this.remeasure();
    }, ms);
  }

  #stop(): void {
    if (this.#settleTimer !== null) {
      clearTimeout(this.#settleTimer);
      this.#settleTimer = null;
    }

    this.#idle();
  }
}

export const motion = new MotionStore();
