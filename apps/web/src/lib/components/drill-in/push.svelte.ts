// The drill-in's push (ADR 21): a level slides in over the one it leaves, and back out. A route
// change runs the ease-in-out from wherever the slide is; an edge-swipe follows the finger 1:1 and,
// let go, a spring takes over at its speed. A landed slide plays `soft`. Both land at once on the
// still tier. Its users lay the levels out from `p`.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM's events, only read. */
import { spring, tween, VelocityTracker } from "../../animate.ts";
import { haptics } from "../../haptics.ts";
import { released, settle, slideMs } from "./drill.ts";

/** How near the box's left edge a finger starts a swipe back, in px. */
const EDGE = 28;

/** How far a finger moves right before the swipe is taken as one, in px. */
const SLOP = 6;

export interface PushHooks {
  /** The slide now heads for `to`, before its first frame. */
  turn?: (to: 0 | 1) => void;
  /** A finger took the slide over. */
  grab?: () => void;
  /** The slide came to rest at `to`. */
  land?: (to: 0 | 1) => void;
  /** A finger let go past the point of going back: the route goes back. */
  back: () => void;
}

export class Push {
  /** 0 with the level above in place, 1 with the pushed level in place. */
  p = $state(0);

  #target: 0 | 1;
  #hooks: PushHooks;
  #cancel: (() => void) | undefined;
  #tracker = new VelocityTracker();
  #swipe: { id: number; x0: number; p0: number; active: boolean; box: HTMLElement } | undefined;

  constructor(at: 0 | 1, hooks: PushHooks) {
    this.p = at;
    this.#target = at;
    this.#hooks = hooks;
  }

  /** Where the slide heads, or rests. */
  get target(): 0 | 1 {
    return this.#target;
  }

  /** Puts the slide at `to` at once, as where nothing slides. */
  jump(to: 0 | 1): void {
    this.#cancel?.();
    this.#target = to;
    this.p = to;
  }

  /** Slides to `to` from where it is: on the release's spring with its `velocity`, else the ease-in-out. */
  slide(to: 0 | 1, velocity?: number): void {
    this.#cancel?.();

    if (to !== this.#target) {
      this.#target = to;
      this.#hooks.turn?.(to);
    }

    const done = () => {
      this.#cancel = undefined;
      this.#hooks.land?.(to);
      haptics.soft();
    };

    const set = (value: number) => {
      this.p = value;
    };

    this.#cancel =
      velocity === undefined
        ? tween(this.p, to, slideMs(this.p, to), set, done)
        : spring(this.p, to, set, released(velocity), done);
  }

  /**
   * The pointer handlers of the box the levels slide in: a finger near its left edge on a pushed
   * level, while `may` holds, starts a swipe back.
   */
  handlers(may: () => boolean) {
    const up = (e: PointerEvent) => {
      this.#up(e);
    };

    return {
      onpointerdown: (e: PointerEvent & { currentTarget: HTMLElement }) => {
        if (may()) this.#down(e, e.currentTarget);
      },
      onpointermove: (e: PointerEvent) => {
        this.#move(e);
      },
      onpointerup: up,
      onpointercancel: up,
    };
  }

  #down(e: PointerEvent, box: HTMLElement): void {
    if (this.#target !== 1 || e.clientX - box.getBoundingClientRect().left > EDGE) return;

    // The innermost push takes the swipe: a level pushed inside another goes back one level.
    e.stopPropagation();
    this.#swipe = { id: e.pointerId, x0: e.clientX, p0: this.p, active: false, box };
    this.#tracker.reset();
  }

  #move(e: PointerEvent): void {
    const swipe = this.#swipe;

    if (swipe?.id !== e.pointerId) return;

    const dx = e.clientX - swipe.x0;

    if (!swipe.active && dx > SLOP) {
      swipe.active = true;
      this.#cancel?.();
      this.#hooks.grab?.();
      swipe.box.setPointerCapture(e.pointerId);
    }

    if (!swipe.active) return;

    this.p = Math.max(0, Math.min(1, swipe.p0 - dx / swipe.box.offsetWidth));
    this.#tracker.push(this.p);
  }

  #up(e: PointerEvent): void {
    const swipe = this.#swipe;

    if (swipe?.id !== e.pointerId) return;

    this.#swipe = undefined;

    if (!swipe.active) return;

    const velocity = this.#tracker.velocity();
    const to = settle(this.p, velocity);

    this.slide(to, velocity);

    if (to === 0) this.#hooks.back();
  }
}
