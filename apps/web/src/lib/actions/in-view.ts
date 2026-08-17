import type { Action } from "svelte/action";

/**
 * The history grid's mount/unmount hysteresis.
 *
 * One margin for both edges means a card that mounts at 200px unmounts at 200px,
 * so a half-screen nudge past a card's edge tears its chart down and the nudge
 * back rebuilds it — ~270ms of LayerChart construction for a gesture that never
 * left the card. Splitting them arms the card early and lets go of it late.
 *
 * `retain` is bounded on purpose. A LayerChart instance measures ~1.7MB of heap:
 * ±1500px holds 12-15 charts (~25MB) on the tablet this exists for, where
 * retaining all 63 cards would be ~100MB — on the device that IS the complaint.
 */
export const RETENTION_BAND = { mount: "250px", retain: "1500px" } as const;

export type InViewParams =
  | {
      onEnter?: () => void;
      onLeave?: () => void;
      /** Margin at which the node counts as arriving. */
      rootMargin?: string;
      /** Wider margin at which it counts as gone. Omit for one symmetric edge. */
      retainMargin?: string;
    }
  | undefined;

/**
 * Fire `onEnter` when the node scrolls into view, and `onLeave` when it scrolls
 * back out — the history grid uses this to lazily mount charts (and unmount
 * off-screen live charts to stop their per-frame Tween) so 100+ entities don't
 * all fetch/animate at once.
 *
 * With `retainMargin` the two edges get their own observer: the narrow one owns
 * arrival, the wide one owns departure, and the gap between them is the
 * retention band above. Without it, one observer owns both — the original
 * behaviour, which callers outside the history grid still use.
 */
export const inView: Action<HTMLElement, InViewParams> = (node, params) => {
  let opts = params;

  const watch = (rootMargin: string, fire: (intersecting: boolean) => void) => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) fire(entry.isIntersecting);
      },
      { rootMargin },
    );
    observer.observe(node);
    return observer;
  };

  const enter = () => opts?.onEnter?.();
  const leave = () => opts?.onLeave?.();
  const retainMargin = params?.retainMargin;

  const observers = retainMargin
    ? [
        watch(params?.rootMargin ?? RETENTION_BAND.mount, (hit) => hit && enter()),
        watch(retainMargin, (hit) => !hit && leave()),
      ]
    : [watch(params?.rootMargin ?? "200px", (hit) => (hit ? enter() : leave()))];

  return {
    update(next) {
      opts = next;
    },
    destroy() {
      for (const observer of observers) observer.disconnect();
    },
  };
};
