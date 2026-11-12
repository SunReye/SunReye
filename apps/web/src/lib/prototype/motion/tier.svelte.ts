/**
 * The motion tier as reactive state: the rune shell over `./tier`.
 * Ported from v3 (dev 780b4e2, lib/motion/tier.svelte.ts) with ADR 21's two changes:
 * there is no motion setting (the frame watch decides), and the low-power switch forces `still`.
 * The measured strain is kept per device, so a slow wall tablet starts lean the next day.
 */
import { MediaQuery } from "svelte/reactivity";
import { clampStrain, FrameStrain, MAX_STRAIN, type MotionTier, parseStrain, resolveTier } from "./tier";

const STRAIN_KEY = "proto.motion-strain";

/** Boot is the least representative moment a page has; the watch starts once it has settled. */
const SETTLE_MS = 4000;

/**
 * Windows judged before the watch stops. Bounded because a pending `requestAnimationFrame` makes
 * the browser produce frames it would otherwise skip, which is what the lean tiers exist to save.
 */
const WATCH_WINDOWS = 3;

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

class MotionStore {
  #strain = $state(parseStrain(read(STRAIN_KEY)));
  #reduce = new MediaQuery("(prefers-reduced-motion: reduce)");
  /** The low-power switch (ADR 21): all of it is instant and nothing moves. */
  #lowPower = $state(false);
  /** Prototype only: pins a tier from the URL (`tier=lite`) so each picture can be looked at. */
  #pinned = $state<MotionTier | null>(null);

  #frames = new FrameStrain();
  #raf: number | null = null;
  #settleTimer: ReturnType<typeof setTimeout> | null = null;
  #leases = 0;

  /** What to render. Everything on the page branches on this and nothing else. */
  get tier(): MotionTier {
    if (this.#lowPower) return "still";
    if (this.#pinned && !this.#reduce.current) return this.#pinned;
    return resolveTier("auto", this.#reduce.current, this.#strain);
  }

  get still(): boolean {
    return this.tier === "still";
  }

  set lowPower(on: boolean) {
    this.#lowPower = on;
    this.#sync();
  }

  set pinned(tier: MotionTier | null) {
    this.#pinned = tier;
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

  #sync(): void {
    const wanted =
      this.#leases > 0 &&
      !this.#lowPower &&
      !this.#pinned &&
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
      if (this.#frames.sample(ts)) {
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
