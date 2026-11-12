// PROTOTYPE: shell by input and width, not device name (ADR 21).
import { MediaQuery } from "svelte/reactivity";

const fine = new MediaQuery("(hover: hover) and (pointer: fine)");
const wide = new MediaQuery("(min-width: 768px)");
const desktop = new MediaQuery("(min-width: 1024px)");

export const input = {
  get mouse() {
    return fine.current;
  },
  get wide() {
    return wide.current;
  },
  /** Landscape tablet and desktop: the non-scrolling master layout. */
  get desktop() {
    return desktop.current;
  },
  get shell(): "rail" | "rail-open" | "bar" {
    if (fine.current) return "rail";
    return wide.current ? "rail-open" : "bar";
  },
};
