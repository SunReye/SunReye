import { tick } from "svelte";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "../../app.css";
import { prepare, restore, show } from "./detail.harness.ts";

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
