import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp } from "vitest/browser";
import { WebHaptics } from "web-haptics";
import { HAPTICS, haptics } from "./haptics.ts";
import { LOW_POWER } from "./live/dashboard.ts";

let vibrate: ReturnType<typeof vi.fn<() => boolean>>;

beforeEach(() => {
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  localStorage.setItem(HAPTICS, "on");
});

afterEach(async () => {
  localStorage.removeItem(HAPTICS);
  localStorage.removeItem(LOW_POWER);
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

/** Lets the throttled `selection` fire again. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 40);
  });
}

test.each(["selection", "soft", "light", "success", "error", "nudge"] as const)(
  "ADR 21's %s event vibrates",
  async (event) => {
    await settle();
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

test("the library's own switch never shows, even where it carries the haptics (iOS)", async () => {
  const supported = WebHaptics.isSupported;
  // iOS has no Vibration API; the library falls back to clicking its switch.
  Object.defineProperty(WebHaptics, "isSupported", { value: false, configurable: true });

  try {
    haptics.soft();
    await settle();
  } finally {
    Object.defineProperty(WebHaptics, "isSupported", { value: supported, configurable: true });
  }

  const shown = [...document.body.querySelectorAll("label, input")].filter((element) =>
    element.checkVisibility(),
  );

  expect(shown).toEqual([]);
});

test("the switch turned off stops every event", async () => {
  localStorage.setItem(HAPTICS, "off");
  await settle();
  haptics.selection();
  haptics.success();
  expect(vibrate).not.toHaveBeenCalled();
});

test("the low-power switch forces haptics off", async () => {
  localStorage.setItem(LOW_POWER, "on");
  await settle();
  haptics.selection();
  haptics.success();
  expect(vibrate).not.toHaveBeenCalled();
});

test("reduced motion forces haptics off", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await settle();
  haptics.selection();
  haptics.success();
  expect(vibrate).not.toHaveBeenCalled();
});
