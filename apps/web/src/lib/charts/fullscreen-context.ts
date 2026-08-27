/**
 * How a plot deep inside a card reaches the card's own full-screen state.
 *
 * The control used to live in the section header, one icon in a cluster with the
 * collapse caret — close enough that a thumb aiming for one hit the other. It
 * sits in the plot's bottom-right corner now, diagonally opposite the zoom reset
 * in the top-right, which is as far apart as two corners of the same box get.
 *
 * That move is what needs this file. The state belongs to the CARD (`Section`
 * owns the {@link FullscreenBox} and is the box that expands), while the control
 * now renders inside the plot — several components down, past whichever chart
 * wrapper the page happens to use. Threading a prop through all of them would
 * mean every chart component in the app carrying a `screen` it does not use, and
 * the next chart added would silently ship without the control.
 *
 * Context instead: the card publishes, `plot-frame.svelte` consumes, and nothing
 * in between has to know. `charts/fullscreen-coverage.test.ts` still detects the
 * offer at the `<Section fullscreen>` end, so the sweep that keeps every chart
 * expandable is unaffected.
 */

import { getContext, setContext } from "svelte";
import type { FullscreenBox } from "./fullscreen.svelte";

/**
 * The card's box, behind a getter.
 *
 * Not the box itself: `Section` resolves it as `provided ?? own`, a `$derived`,
 * and `setContext` runs once at init — so publishing the value would freeze
 * whichever box existed on the first render and a card that later receives its
 * caller's own box would keep handing the plot the abandoned one. A getter is
 * read at the point of use, inside the consumer's own reactive scope.
 */
export type FullscreenSource = {
  readonly box: FullscreenBox;
  /**
   * Claim the right to draw this card's corner control, once.
   *
   * A card is not always one plot. The energy-split card is two — consumption
   * and production, side by side from `lg` — and both are plot frames, so both
   * would draw a ⤢ that expands THE CARD. Two identical controls whose effect is
   * neither one's own plot is worse than the mispress this whole move set out to
   * fix: a button in a plot's corner reads as "expand this plot", and a reader
   * who presses the second one has no way to learn why there were two.
   *
   * So the first frame to ask gets it — first in init order, which is DOM order,
   * which is the top-left plot. The others draw nothing and the card keeps one
   * way to expand. Enforced here rather than by a prop on each multi-plot card,
   * because the next card to hold two plots would otherwise ship the bug again
   * and nothing would say so.
   *
   * Returns a live getter, not a boolean: the claim is released when the holding
   * frame is destroyed (a lazy-mounted chart scrolling out of view), and the next
   * frame to ask has to be able to pick it up.
   */
  claimCorner(token: symbol): () => boolean;
  /** Give the claim back on destroy, so a remount can re-claim it. */
  releaseCorner(token: symbol): void;
};

/** Symbol rather than a string: two features keying the same context by a
 *  guessable name is a collision nobody debugs twice. */
const FULLSCREEN_KEY = Symbol("sunreye.fullscreen-box");

/** Publish the card's box. Call during component init, from the card. */
export function provideFullscreen(source: FullscreenSource): void {
  setContext(FULLSCREEN_KEY, source);
}

/**
 * The nearest enclosing card's box, or null.
 *
 * Null is a normal answer, not a failure: plots also live in dialogs and in the
 * forecast-correction panel, which have no section card and carry their own
 * frame (`layout/chart-fullscreen.svelte`). A plot frame with no box simply
 * draws no corner control.
 */
export function useFullscreen(): FullscreenSource | null {
  return getContext<FullscreenSource | undefined>(FULLSCREEN_KEY) ?? null;
}
