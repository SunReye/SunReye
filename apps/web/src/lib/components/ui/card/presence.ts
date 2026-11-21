/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A card that appears or leaves opens or closes its height (ADR 21 "One behaviour, one component").
import type { TransitionConfig } from "svelte/transition";
import { easeInOut } from "../../../motion/ease.ts";
import { tokenMs } from "../../../motion/token.ts";
import { undrawn } from "./undrawn.ts";

const px = (value: string) => Number.parseFloat(value) || 0;

type Layout = Pick<CSSStyleDeclaration, "display" | "flexDirection" | "rowGap">;

/** Whether children laid out so stand side by side, or in a grid's tracks: in no one column. */
const sideBySide = ({ display, flexDirection }: Layout) =>
  display.endsWith("grid") || (display.endsWith("flex") && !flexDirection.startsWith("column"));

/**
 * The gap `node`'s column keeps after it. None where it stands in no column: a grid's gap cannot
 * close, as a track is never smaller than nothing, and across columns the cards reflow.
 */
function columnGap(node: HTMLElement): number | undefined {
  const parent = node.parentElement;

  if (parent === null) return 0;

  const style = getComputedStyle(parent);

  if (sideBySide(style)) return undefined;

  return style.display.endsWith("flex") ? px(style.rowGap) : 0;
}

/**
 * A transition, both ways: `node` opens from no height to its own on the move token and ADR 21's
 * ease-in-out, and closes back. Closed, it takes no room at all: its bottom margin takes back its
 * margins and its column's gap, so what stands below starts and ends where it stands without it.
 * The cards inside fade through `--card-presence`, which the kit's card reads: a fade on `node`
 * would cut their glass off from what lies behind it.
 *
 * It has no length on the still tier, in a grid or a row, where nothing could glide, and in a
 * screen not drawn yet: a card whose data is there as its screen arrives stands at once.
 */
export function presence(node: HTMLElement): TransitionConfig {
  const gap = columnGap(node);
  const duration = gap === undefined || undrawn(node) ? 0 : tokenMs(node, "--motion-move");

  if (gap === undefined || duration === 0) return { duration: 0 };

  const style = getComputedStyle(node);
  const height = node.offsetHeight;
  const below = px(style.marginBottom);
  const room = px(style.marginTop) + below + gap;

  return {
    duration,
    easing: easeInOut,
    // Clipped down only: the cards' shadows show at the sides.
    css: (t, u) =>
      `height: ${height * t}px; margin-bottom: ${below - room * u}px; overflow-y: clip; --card-presence: ${t}`,
  };
}
