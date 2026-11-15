// Shell by input and width, not device name (ADR 21).
import { MediaQuery } from "svelte/reactivity";

/** Mouse: the hover rail. Touch ≥ 768 px: the rail opened from its logo. Narrower: the bar. */
export type ShellLayout = "rail" | "rail-open" | "bar";

export function layout({ fine, wide }: Readonly<{ fine: boolean; wide: boolean }>): ShellLayout {
  if (fine) return "rail";

  return wide ? "rail-open" : "bar";
}

const fine = new MediaQuery("(hover: hover) and (pointer: fine)");
const wide = new MediaQuery("(min-width: 768px)");

export const input = {
  get shell(): ShellLayout {
    return layout({ fine: fine.current, wide: wide.current });
  },
};
