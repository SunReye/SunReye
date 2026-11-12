// The one haptics module (ADR 21). Only these events vibrate.
import { WebHaptics } from "web-haptics";
import { LOW_POWER } from "./live/dashboard.ts";

/** Where each browser keeps its haptics switch: "on", "off", or unset for the default. */
export const HAPTICS = "sunreye.haptics";

export interface HapticsMeans {
  readonly stored: string | null;
  readonly touch: boolean;
  readonly lowPower: boolean;
  readonly reducedMotion: boolean;
}

/** On by default for touch; low power and reduced motion force it off. */
export function hapticsOn({ stored, touch, lowPower, reducedMotion }: HapticsMeans): boolean {
  if (lowPower || reducedMotion) return false;

  return stored === null ? touch : stored === "on";
}

function matches(query: string): boolean {
  return matchMedia(query).matches;
}

// Read on every event: the switches can change without a reload.
function on(): boolean {
  return hapticsOn({
    stored: localStorage.getItem(HAPTICS),
    touch: matches("(pointer: coarse)"),
    lowPower: localStorage.getItem(LOW_POWER) === "on",
    reducedMotion: matches("(prefers-reduced-motion: reduce)"),
  });
}

let engine: WebHaptics | undefined;
let lastSelection = Number.NEGATIVE_INFINITY;

function fire(preset: string): void {
  if (typeof window === "undefined" || !on()) return;
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
  /** Sheet snap, drill-in commit, rail pin. */
  soft(): void {
    fire("soft");
  },
  /** Press on a primary action. */
  light(): void {
    fire("light");
  },
  /** Write confirmed by read-back. */
  success(): void {
    fire("success");
  },
  /** Refusal, mismatch, failed sign-in. */
  error(): void {
    fire("error");
  },
  /** A value editor opens. */
  nudge(): void {
    fire("nudge");
  },
};
