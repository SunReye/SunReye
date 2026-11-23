import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { WebHaptics } from "web-haptics";
import { HAPTICS, haptics } from "@sunreye/ui/haptics";
import { LOW_POWER } from "./motion/tier.ts";
import { realTimers } from "./motion/clock.harness.ts";

let vibrate: ReturnType<typeof vi.fn<() => boolean>>;

/** The clock `selection` throttles on; it only moves forward, across tests too. */
let clock = 0;

beforeEach(() => {
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  localStorage.setItem(HAPTICS, "on");
});

afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.removeItem(HAPTICS);
  localStorage.removeItem(LOW_POWER);
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Lets the throttled `selection` fire again. */
function settle(): void {
  clock += 1000;
}

test.each(["selection", "soft", "light", "success", "error", "nudge"] as const)(
  "ADR 21's %s event vibrates",
  (event) => {
    settle();
    haptics[event]();

    expect(vibrate).toHaveBeenCalledOnce();
  },
);

test("nothing but ADR 21's events can be triggered", () => {
  expect(Object.keys(haptics).toSorted()).toEqual([
    "error",
    "light",
    "nudge",
    "selection",
    "soft",
    "success",
  ]);
});

test("the library's own switch never shows, even where it carries the haptics (iOS)", () => {
  const supported = WebHaptics.isSupported;
  // iOS has no Vibration API; the library falls back to clicking its switch.
  Object.defineProperty(WebHaptics, "isSupported", { value: false, configurable: true });

  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });

  try {
    haptics.soft();
    // The library builds its switch on the next frame at the latest.
    vi.advanceTimersToNextFrame();
  } finally {
    realTimers();
    Object.defineProperty(WebHaptics, "isSupported", { value: supported, configurable: true });
  }

  const shown = [...document.body.querySelectorAll("label, input")].filter((element) =>
    element.checkVisibility(),
  );

  expect(shown).toEqual([]);
});

test("the switch turned off stops every event", () => {
  localStorage.setItem(HAPTICS, "off");
  settle();
  haptics.selection();
  haptics.success();
  expect(vibrate).not.toHaveBeenCalled();
});

test("the low-power switch forces haptics off", () => {
  localStorage.setItem(LOW_POWER, "on");
  settle();
  haptics.selection();
  haptics.success();
  expect(vibrate).not.toHaveBeenCalled();
});

test("reduced motion forces haptics off", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  settle();
  haptics.selection();
  haptics.success();
  expect(vibrate).not.toHaveBeenCalled();
});
