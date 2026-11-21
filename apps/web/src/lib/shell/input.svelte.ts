// Shell by input and width, not device name (ADR 21).
import { MediaQuery } from "svelte/reactivity";

/** Mouse: the hover rail. Touch ≥ 768 px: the rail opened from its logo. Narrower: the bar. */
export type ShellLayout = "rail" | "rail-open" | "bar";

export function layout({ fine, wide }: Readonly<{ fine: boolean; wide: boolean }>): ShellLayout {
  if (fine) return "rail";

  return wide ? "rail-open" : "bar";
}

/** A picker or value editor: anchored to its trigger with a mouse, a bottom drawer on touch at any width. */
export type OverlayKind = "popover" | "drawer";

export function overlayKind({ fine }: Readonly<{ fine: boolean }>): OverlayKind {
  return fine ? "popover" : "drawer";
}

const fine = new MediaQuery("(hover: hover) and (pointer: fine)");
const wide = new MediaQuery("(min-width: 768px)");

export const input = {
  get shell(): ShellLayout {
    return layout({ fine: fine.current, wide: wide.current });
  },
  /** The one drawer-or-popover decision every picker asks (ADR 21). */
  get overlay(): OverlayKind {
    return overlayKind({ fine: fine.current });
  },
};
