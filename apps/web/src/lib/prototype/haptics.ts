// PROTOTYPE: the one haptics module (ADR 21). Only these events vibrate.
import { WebHaptics } from "web-haptics";

let engine: WebHaptics | undefined;
let lastSelection = 0;

function reduced(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fire(preset: string): void {
  if (typeof window === "undefined" || reduced()) return;
  engine ??= new WebHaptics();
  void engine.trigger(preset);
}

export const haptics = {
  /** Toggle, segment, tab change, or a wheel crossing a step; at most ~30/s. */
  selection(): void {
    const now = performance.now();
    if (now - lastSelection < 33) return;
    lastSelection = now;
    fire("selection");
  },
  soft: () => fire("soft"),
  light: () => fire("light"),
  success: () => fire("success"),
  error: () => fire("error"),
  nudge: () => fire("nudge"),
};
