// The drill-in's push (ADR 21): a level slides in over the one it leaves, and back out. A route
// change runs the ease-in-out from wherever the slide is; an edge-swipe follows the finger 1:1 and,
// let go, a spring takes over at its speed. A landed slide plays `soft`. Both land at once on the
// still tier. Its users lay the levels out from `p`.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM's events, only read. */
import { getContext, hasContext, onDestroy, setContext } from "svelte";
import { createAttachmentKey } from "svelte/attachments";
import { spring, tween, VelocityTracker } from "../../animate.ts";
import { haptics } from "@sunreye/ui/haptics";
import { released, settle, slideMs } from "./drill.ts";

/** How near the box's left edge a finger starts a swipe back, in px. */
const EDGE = 28;

/** How far a finger moves right before the swipe is taken as one, in px. */
const SLOP = 6;

/** The push around a component, for a push inside it to nest under. */
const OUTER = Symbol("push");

/** Pointer events a push has acted on: the pushes around it leave them alone. */
const consumed = new WeakSet<Event>();

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
  /** The pushes inside this one's levels. */
  #inner = new Set<Push>();
  #box: HTMLElement | undefined;
  #may: () => boolean = () => false;
  /** The push a finger down on this box started a swipe of: this one or one inside it. */
  #taken: Push | undefined;

  constructor(at: 0 | 1, hooks: PushHooks) {
    this.p = at;
    this.#target = at;
    this.#hooks = hooks;
  }

  /**
   * How a layer stands at the slide's point: the level left behind shifts left and dims, the one
   * pushed slides in from the right.
   */
  layer(which: "under" | "over"): { readonly x: string; readonly opacity: number } {
    return which === "under"
      ? { x: `translateX(${-30 * this.p}%)`, opacity: 1 - 0.6 * this.p }
      : { x: `translateX(${(1 - this.p) * 100}%)`, opacity: 1 };
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
   * Nests this push under the one around the calling component, during its setup: a swipe that
   * starts on the outer box, as in its padding, goes back on the innermost pushed level.
   */
  nest(): void {
    const outer = hasContext(OUTER) ? getContext<Push>(OUTER) : undefined;

    setContext(OUTER, this);

    if (outer === undefined) return;

    outer.#inner.add(this);
    onDestroy(() => {
      outer.#inner.delete(this);
    });
  }

  /**
   * The pointer handlers of the box the levels slide in, and its attachment: a finger near its left
   * edge on a pushed level, while `may` holds, starts a swipe back.
   */
  handlers(may: () => boolean) {
    this.#may = may;

    const up = (e: PointerEvent) => {
      if (!consumed.has(e) && (this.#taken ?? this).#up(e)) consumed.add(e);
    };

    return {
      [createAttachmentKey()]: (box: HTMLElement) => {
        this.#box = box;

        return () => {
          this.#box = undefined;
        };
      },
      onpointerdown: (e: PointerEvent) => {
        if (consumed.has(e)) return;

        this.#taken = this.#press(e);

        if (this.#taken !== undefined) consumed.add(e);
      },
      onpointermove: (e: PointerEvent) => {
        if (!consumed.has(e) && (this.#taken ?? this).#move(e)) consumed.add(e);
      },
      onpointerup: up,
      onpointercancel: up,
    };
  }

  /** The innermost push a finger down starts a swipe of, if any. */
  #press(e: PointerEvent): Push | undefined {
    for (const inner of this.#inner) {
      const taken = inner.#press(e);

      if (taken !== undefined) return taken;
    }

    const box = this.#box;

    if (box === undefined || this.#target !== 1 || !this.#may()) return undefined;

    const { left, width } = box.getBoundingClientRect();

    // A push off screen, or a finger away from its edge.
    if (width === 0 || e.clientX - left > EDGE) return undefined;

    this.#swipe = { id: e.pointerId, x0: e.clientX, p0: this.p, active: false, box };
    this.#tracker.reset();

    return this;
  }

  /** Whether the finger moved this push's swipe. */
  #move(e: PointerEvent): boolean {
    const swipe = this.#swipe;

    if (swipe?.id !== e.pointerId) return false;

    const dx = e.clientX - swipe.x0;

    if (!swipe.active && dx > SLOP) {
      swipe.active = true;
      this.#cancel?.();
      this.#hooks.grab?.();
      swipe.box.setPointerCapture(e.pointerId);
    }

    if (swipe.active) {
      this.p = Math.max(0, Math.min(1, swipe.p0 - dx / swipe.box.offsetWidth));
      this.#tracker.push(this.p);
    }

    return true;
  }

  /** Whether the finger let go of this push's swipe. */
  #up(e: PointerEvent): boolean {
    const swipe = this.#swipe;

    if (swipe?.id !== e.pointerId) return false;

    this.#swipe = undefined;

    if (!swipe.active) return true;

    const velocity = this.#tracker.velocity();
    const to = settle(this.p, velocity);

    this.slide(to, velocity);

    if (to === 0) this.#hooks.back();

    return true;
  }
}
