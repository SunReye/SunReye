/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// What the backdrop's tests share: a noon core, the plant's PV fed by hand and a beat stepped by hand.
import { PLANT, type Live } from "../api/core.ts";
import { stream } from "../live/stream.svelte.ts";
import { motion } from "../../../../../../packages/builder/src/motion/tier.svelte.ts";

export const root = document.documentElement;

export const TINTS = ["dawn", "noon", "dusk", "night"] as const;

export const noon = { sunTint: () => Promise.resolve({ tint: "noon" as const }) };

/** A light's drift at rest, as the browser writes it back. */
export const RESTING = "translate(0vmax, 0vmax) scale(1)";

let unfollow: (() => void) | undefined;

/** After each test: no tint, light theme, full tier, no stream. */
export function teardown(): void {
  delete root.dataset["tod"];
  root.classList.remove("dark");
  motion.lowPower = false;
  unfollow?.();
  unfollow = undefined;
}

const nothing = (): void => {};

/** A fake core's live stream, with the plant's PV power fed by hand. */
export function plantStream(): (watts: number) => void {
  let tell: (live: Live) => void = nothing;

  unfollow = stream.follow({
    live: (listener) => {
      tell = listener;

      return nothing;
    },
  });

  return (watts) => {
    tell({ devices: { [PLANT]: { "pv.power": watts } } });
  };
}

export function lights(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>("[data-light]")];
}

/** A beat stepped by hand; `listening` while the backdrop follows it. */
export function handBeat() {
  let step: ((seconds: number) => void) | undefined;

  return {
    beat: (next: (seconds: number) => void) => {
      step = next;

      return () => {
        step = undefined;
      };
    },
    at: (seconds: number) => step?.(seconds),
    get listening() {
      return step !== undefined;
    },
  };
}

/** Each light's drift from its place. */
export const drifts = (container: Element): string[] =>
  lights(container).map((light) => light.querySelector<HTMLElement>(":scope > *")!.style.transform);

const BOX = ["left", "top", "width", "height"] as const;

/** Where each light sits on the screen, in whole pixels. */
export const boxes = (container: Element): number[][] =>
  lights(container).map((light) => {
    const box = light.getBoundingClientRect();

    return BOX.map((side) => Math.round(box[side]));
  });

/**
 * A phone's address bar, by hand: it resizes the box that fixed layers fill and leaves the large
 * viewport alone. No headless browser has the bar, so `container` stands in for that box.
 */
export function addressBar(container: HTMLElement): (height: number) => void {
  // A transform makes the container the containing block of its fixed descendants.
  container.style.cssText = "position: fixed; inset: 0 0 auto; transform: translate(0);";

  return (height) => {
    container.style.height = `${height}px`;
  };
}
