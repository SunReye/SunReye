import { tick } from "svelte";
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import "../../app.css";
import { held, press } from "../components/drawer.harness.ts";
import { prepare, restore, show } from "./detail.harness.ts";
import { settle } from "../motion/clock.harness.ts";

// Inside a sheet a finger reads a chart after a hold, so the drawer does not follow it (ADR 21
// "Sheet content"); a full screen reads at once (range/BandReading.svelte.test.ts).

beforeEach(prepare);

afterEach(restore);

/** The production sheet's band chart, which a finger reads. */
const plot = () => document.querySelector<HTMLElement>("[role=dialog] [data-scrub]")!;

/** A finger's event over the day's `hour`, `dy` px below the plot's middle. */
function finger(type: string, hour: number, dy = 0): void {
  const box = plot().getBoundingClientRect();

  plot().dispatchEvent(
    new PointerEvent(type, {
      pointerType: "touch",
      pointerId: 7,
      clientX: box.left + (box.width * (hour + 0.5)) / 24,
      clientY: box.top + box.height / 2 + dy,
      buttons: 1,
      bubbles: true,
    }),
  );
}

test("in a sheet, a finger reads the band chart once held and follows; lifted, the sum returns", async () => {
  const { screen } = await show("production");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });
  const hour = sheet.getByText(/^10:00–11:00 Uhr/u);

  await expect.element(sheet.getByText("8,0 kWh").first()).toBeVisible();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 10);
  await tick();
  expect(hour.query()).toBeNull();

  vi.advanceTimersByTime(1000);
  await tick();
  expect(hour.query()).not.toBeNull();

  finger("pointermove", 9);
  await tick();
  expect(sheet.getByText(/^9:00–10:00 Uhr/u).query()).not.toBeNull();

  finger("pointerup", 9);
  await tick();
  expect(sheet.getByText(/^9:00–10:00 Uhr/u).query()).toBeNull();
});

test("in a sheet, a finger passing over the band chart reads nothing", async () => {
  const { screen } = await show("production");
  const sheet = screen.getByRole("dialog", { name: "Produktion" });

  await expect.element(sheet.getByText("8,0 kWh").first()).toBeVisible();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  finger("pointerdown", 10);
  finger("pointermove", 4);
  vi.advanceTimersByTime(1000);
  await tick();

  expect(sheet.getByText(/^10:00–11:00 Uhr/u).query()).toBeNull();
  expect(sheet.getByText(/^4:00–5:00 Uhr/u).query()).toBeNull();
});

/** The production sheet in a phone's drawer, a pull off its chart proving the drawer follows. */
async function phoneDrawer() {
  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });
  onTestFinished(async () => {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  });

  const { screen, onclose } = await show();

  await screen.rerender({ detail: "production" });

  const sheet = screen.getByRole("dialog", { name: "Produktion" });
  const drawer = sheet.element();

  if (!(drawer instanceof HTMLElement)) throw new TypeError("no drawer");

  await expect.element(sheet.getByText("8,0 kWh").first()).toBeVisible();

  held(await press(drawer, 60));
  await settle(() => !drawer.style.transform.includes("60px"));

  // A synthetic pointer has no capture to take.
  plot().setPointerCapture = () => {};

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  return { sheet, drawer, rest: drawer.style.transform, onclose };
}

// Last: touch emulation cannot be undone (pointer stays `none`).
test("in a phone's drawer, a quick sideways drag on the band chart neither reads nor moves it", async () => {
  const { sheet, drawer, rest } = await phoneDrawer();

  finger("pointerdown", 4);
  finger("pointermove", 8, 2);
  finger("pointermove", 12, 4);
  finger("pointerup", 12, 4);
  vi.advanceTimersByTime(1000);
  await tick();

  expect(sheet.getByText(/^\d+:00–\d+:00 Uhr/u).query()).toBeNull();
  expect(drawer.style.transform).toBe(rest);
});

test("in a phone's drawer, a finger held on the band chart reads it and the drawer stays", async () => {
  const { sheet, drawer, rest, onclose } = await phoneDrawer();

  // A resting finger drifts a little before it holds.
  finger("pointerdown", 10);
  finger("pointermove", 10, 3);
  vi.advanceTimersByTime(1000);
  await tick();
  expect(sheet.getByText(/^10:00–11:00 Uhr/u).query()).not.toBeNull();

  finger("pointermove", 10, 80);
  await tick();
  expect(drawer.style.transform).toBe(rest);

  finger("pointerup", 10, 80);
  await tick();
  expect(drawer.style.transform).toBe(rest);
  expect(onclose).not.toHaveBeenCalled();
});
