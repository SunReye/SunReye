/**
 * Switching which device the dashboard shows.
 *
 * The thing worth proving in a browser rather than a unit test is the part that
 * is only true of a running document: that the readings on screen *stop* being
 * the previous machine's the moment the selection changes. Every id the live
 * layer keys by is a bare role name with no device in it, so a value carried
 * across a switch would be answered as the new device's — and answered fresh,
 * because its timestamp is recent. A number that is wrong and looks current is
 * the failure `lib/live/ownership.ts` exists to prevent, and no unit test of
 * either store catches it, because the bug lives in the seam between them.
 *
 * The two fixture devices deliberately share a profile: two inverters of one
 * model is the case where the metric keys are identical, so nothing downstream
 * can tell one plant's numbers from the other's by inspection.
 */

import { expect, test } from "@playwright/test";
import { mockBackend, MANIFEST } from "./support/api-mock";
import { powerFlowReadouts } from "./support/open-page";

const DEVICES = [
  { id: MANIFEST.id, label: "Roof array", deviceClass: "inverter", enabled: true, isDefault: true },
  { id: "barn", label: "Barn array", deviceClass: "inverter", enabled: true, isDefault: false },
];

/** The switcher in the app header. */
const switcher = (page: import("@playwright/test").Page) =>
  page.getByRole("combobox", { name: "Device" });

test("a plant with one device shows no switcher", async ({ page }) => {
  // Every install today. A picker with one entry is furniture, and it would
  // spend a tap target in a header whose height is load-bearing.
  const backend = await mockBackend(page);
  await page.goto("/#/");
  await backend.waitForLive();

  await expect(switcher(page)).toHaveCount(0);
});

test("a plant with two devices offers both, and starts on the default", async ({ page }) => {
  const backend = await mockBackend(page, { devices: DEVICES });
  await page.goto("/#/");
  await backend.waitForLive();

  await expect(switcher(page)).toHaveValue(MANIFEST.id);
  await expect(switcher(page).locator("option")).toHaveText(["Roof array", "Barn array"]);
});

test("choosing a device subscribes the live feed to it", async ({ page }) => {
  const backend = await mockBackend(page, { devices: DEVICES });
  await page.goto("/#/");
  await backend.waitForLive();
  expect(backend.liveDeviceId).toBeNull();

  await switcher(page).selectOption("barn");

  await expect.poll(() => backend.liveDeviceId).toBe("barn");
});

test("the previous device's readings do not survive the switch", async ({ page }) => {
  // The one that matters, and the reason this is a browser spec: between the
  // switch and the new device's first frame the panel must say it does not
  // know. An absent reading renders as an em dash (`formatReading`), so the
  // blanking is directly observable — and a value carried across would not be
  // marked stale either, because its timestamp is seconds old.
  const backend = await mockBackend(page, { devices: DEVICES });
  await page.goto("/#/");
  await backend.waitForLive();
  await backend.pushMetrics();
  const readouts = powerFlowReadouts(page);
  await expect(readouts.filter({ hasText: "—" })).toHaveCount(0);

  await switcher(page).selectOption("barn");

  await expect(readouts.filter({ hasText: "—" })).not.toHaveCount(0);
});

test("the device switched to paints its own readings", async ({ page }) => {
  // The blanking is only correct if it is temporary: the new device's first
  // frame has to fill the panel back in.
  const backend = await mockBackend(page, { devices: DEVICES });
  await page.goto("/#/");
  await backend.waitForLive();
  await switcher(page).selectOption("barn");
  await expect.poll(() => backend.liveDeviceId).toBe("barn");

  await backend.pushMetrics();

  await expect(powerFlowReadouts(page).filter({ hasText: "—" })).toHaveCount(0);
});

test("switching back returns to the first device", async ({ page }) => {
  const backend = await mockBackend(page, { devices: DEVICES });
  await page.goto("/#/");
  await backend.waitForLive();
  await switcher(page).selectOption("barn");
  await expect.poll(() => backend.liveDeviceId).toBe("barn");

  await switcher(page).selectOption(MANIFEST.id);

  await expect.poll(() => backend.liveDeviceId).toBe(MANIFEST.id);
});
