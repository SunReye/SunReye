/**
 * "Is this a finger or a mouse?" — asked once, for the whole chart layer.
 *
 * Two features need the answer and must never disagree about it: the tooltip
 * (which has to clear a fingertip) and the gesture default (locked on touch,
 * brush on a mouse). Two independent reads is how those drift.
 *
 * The reactive singleton lives in ./pointer.svelte.ts beside this; what is
 * testable without a rune scheduler is the READ, including the SSR one. The app
 * runs with `ssr: false`, so module init already happens in the browser and the
 * first paint gets the real answer — but the guard has to hold anyway, because
 * a `false` seeded on the server and flipped on hydration is a visible jump
 * from an unlocked chart to a locked one.
 */

import { describe, expect, test } from "bun:test";
import { COARSE_POINTER_QUERY, coarseFrom } from "./pointer";

describe("the coarse-pointer read", () => {
  test("asks the pointer question, not the hover one", () => {
    // `(hover: none)` is the other candidate and it is not the same question:
    // a stylus hovers and is coarse, a touch-screen laptop with a mouse
    // attached hovers and reports both.
    expect(COARSE_POINTER_QUERY).toBe("(pointer: coarse)");
  });

  test("is true when the platform says coarse", () => {
    const asked: string[] = [];
    const view = {
      matchMedia(query: string) {
        asked.push(query);
        return { matches: query === COARSE_POINTER_QUERY };
      },
    };
    expect(coarseFrom(view)).toBe(true);
    expect(asked).toEqual([COARSE_POINTER_QUERY]);
  });

  test("is false when it says fine", () => {
    expect(coarseFrom({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  test("is false with no window at all", () => {
    // The SSR/prerender pass. FINE is the safe seed: it leaves the desktop
    // brush gesture and the beside-the-cursor tooltip as the pre-hydration
    // state, which is what a machine with no touch input will keep.
    expect(coarseFrom(undefined)).toBe(false);
  });

  test("is false on a browser too old to answer", () => {
    expect(coarseFrom({} as { matchMedia?: (q: string) => { matches: boolean } })).toBe(false);
  });
});
