import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import "../../app.css";
import { pull } from "../components/drawer.harness.ts";
import { unfaded } from "../scroll-fade.harness.ts";
import { BATTERY, prepare, restore, served, show } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

test("a dashboard figure asks to open its detail", async () => {
  const { screen, onopen } = await show();

  await screen.getByRole("button", { name: /Spotpreis/u }).click();

  expect(onopen).toHaveBeenCalledWith("price");
});

/** Each hour bar's price; `undefined` for a gap. */
function hourPrices(): (string | undefined)[] {
  return [...document.querySelectorAll("[data-hour]")].map((b) =>
    b instanceof HTMLElement ? b.dataset.price : undefined,
  );
}

test("the price sheet charts today's spot prices hourly with their CC BY attribution", async () => {
  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog", { name: "Spotpreis" });

  await expect.element(sheet.getByRole("img", { name: "Spotpreise heute" })).toBeVisible();

  const gap = undefined;

  // One bar per hour, its quarter-hours averaged; an hour without a price is a gap, never 0.

  await expect
    .poll(hourPrices)
    .toEqual([
      "0.12",
      ...Array.from({ length: 11 }, () => gap),
      "0.09375",
      "-0.01",
      ...Array.from({ length: 10 }, () => gap),
    ]);
  // The hour in force at 12:20 is noon's.
  expect(document.querySelector<HTMLElement>("[data-now]")?.dataset.price).toBe("0.09375");
  await expect.element(sheet.getByText("00:00")).toBeVisible();
  await expect
    .element(sheet.getByRole("link", { name: "CC BY 4.0" }))
    .toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
});

test("every sheet ends with History at its range", async () => {
  const { screen } = await show("production");

  await expect
    .element(screen.getByRole("link", { name: /Im Verlauf öffnen · Heute/u }))
    .toHaveAttribute("href", "#/history?range=day");
});

test("History opens at the sheet's figure: its question, tab or string", async () => {
  const { screen } = await show("saved");

  await expect
    .element(screen.getByRole("link", { name: /Im Verlauf öffnen/u }))
    .toHaveAttribute("href", "#/history?range=day&metric=money");
});

test("a device's sheet lists its readings by group", async () => {
  const { screen } = await show("battery");
  const readings = screen.getByRole("region", { name: "Messwerte" });

  await expect.element(readings.getByText("Zyklen")).toBeVisible();
  await expect.element(readings.getByText("Zähler")).toBeVisible();
  // The sheet scrolls inside its glass and fades its edges (ADR 21).
  expect(unfaded()).toEqual([]);
});

test("a string sharing its input is estimated and opens its sibling", async () => {
  const { screen, onopen } = await show("string-1");
  const sheet = screen.getByRole("dialog", { name: "Süd" });

  await expect.element(sheet.getByText(/misst seine 2 Strings gemeinsam/u)).toBeVisible();
  await sheet.getByRole("button", { name: /Nord/u }).click();

  expect(onopen).toHaveBeenCalledWith("string-2");
});

test("an offline device is stated once above its readings", async () => {
  const at = 5 * 60;
  served.stale = { [BATTERY]: { "battery.power": at, "battery.soc": at, "battery.cycles": at } };

  const { screen } = await show("battery");

  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Gerät antwortet nicht · letzte Werte vor 5 min");
});

test("a lost stream is stated above the readings and dims them, like a stopped one", async () => {
  served.breaks = true;

  const { screen } = await show("battery");
  const readings = screen.getByRole("region", { name: "Messwerte" });

  await expect
    .element(readings.getByRole("status"))
    .toHaveTextContent("Angehalten · keine Live-Daten");
});

test("Escape asks to close the sheet", async () => {
  const { screen, onclose } = await show("price");

  await expect.element(screen.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard("{Escape}");

  expect(onclose).toHaveBeenCalledOnce();
});

test("the scrim dims the page without blurring it", async () => {
  const { screen } = await show("price");

  await expect.element(screen.getByRole("dialog")).toBeVisible();

  const scrim = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');

  expect(scrim && getComputedStyle(scrim).backdropFilter).toBe("none");
});

test("a sheet enters in about 350 ms easing out and leaves faster, easing in", async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });

  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog");

  await expect.element(sheet).toBeVisible();

  const entering = getComputedStyle(sheet.element());

  expect(entering.animationDuration).toBe("0.35s");
  expect(entering.animationTimingFunction).toBe("cubic-bezier(0.215, 0.61, 0.355, 1)");

  await screen.rerender({ detail: null });
  await expect.element(sheet).toHaveAttribute("data-state", "closed");

  const leaving = getComputedStyle(sheet.element());

  expect(leaving.animationDuration).toBe("0.15s");
  expect(leaving.animationTimingFunction).toBe("cubic-bezier(0.55, 0.055, 0.675, 0.19)");
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("on a desktop it is a side sheet, on a phone a drawer that a pull down or back closes", async () => {
  const wide = await show("price");

  await expect.element(wide.screen.getByRole("dialog")).toHaveAttribute("data-side", "right");
  await wide.screen.unmount();

  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const phone = await show();

    await phone.screen.rerender({ detail: "price" });

    const sheet = phone.screen.getByRole("dialog", { name: "Spotpreis" });

    await expect.element(sheet).toHaveAttribute("data-vaul-drawer-direction", "bottom");
    await pull(sheet.element(), 300);
    expect(phone.onclose).toHaveBeenCalledOnce();

    // Back drops the hash route's figure.
    await phone.screen.rerender({ detail: null });
    await expect.element(sheet).not.toBeInTheDocument();
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});

test("a viewer's house sheet names its consumers from the topology", async () => {
  const { screen } = await show("house");
  const sheet = screen.getByRole("dialog", { name: "Haus" });

  await expect.element(sheet.getByText("Verbraucher")).toBeVisible();
  await expect.element(sheet.getByText("Wärmepumpe")).toBeVisible();
});

test("the strip's weather cell opens the weather detail", async () => {
  const { screen, onopen } = await show();

  await screen.getByRole("button", { name: /Wetter/u }).click();

  expect(onopen).toHaveBeenCalledWith("weather");
});

test("the weather sheet shows the weather by the hour", async () => {
  const { screen } = await show("weather");
  const sheet = screen.getByRole("dialog", { name: "Wetter" });

  // The fake core stores no weather.
  await expect
    .element(
      sheet.getByRole("region", { name: "Wetter nach Stunden" }).getByText("Keine Wetterdaten"),
    )
    .toBeVisible();
});
