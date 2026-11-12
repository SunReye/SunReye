import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import "../../app.css";
import { BATTERY, served, setup, show, teardown } from "./detail.harness.ts";

beforeEach(setup);

afterEach(teardown);

test("a dashboard figure asks to open its detail", async () => {
  const { screen, onopen } = await show();

  await screen.getByRole("button", { name: /Spotpreis/u }).click();

  expect(onopen).toHaveBeenCalledWith("price");
});

test("the price sheet charts today's spot prices with their CC BY attribution", async () => {
  const { screen } = await show("price");
  const sheet = screen.getByRole("dialog", { name: "Spotpreis" });

  await expect.element(sheet.getByRole("img", { name: "Spotpreise heute" })).toBeVisible();
  await expect
    .poll(() =>
      [...document.querySelectorAll("[data-price]")].map((b) =>
        b instanceof HTMLElement ? b.dataset.price : null,
      ),
    )
    .toEqual(["0.12", "0.061", "-0.01"]);
  // The slot in force at 12:20 is noon's.
  expect(document.querySelector<HTMLElement>("[data-now]")?.dataset.price).toBe("0.061");
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

test("a device's sheet lists its readings by group", async () => {
  const { screen } = await show("battery");
  const readings = screen.getByRole("region", { name: "Messwerte" });

  await expect.element(readings.getByText("Zyklen")).toBeVisible();
  await expect.element(readings.getByText("Zähler")).toBeVisible();
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
test("on a desktop it is a side sheet, on a phone a bottom sheet", async () => {
  const wide = await show("price");

  await expect.element(wide.screen.getByRole("dialog")).toHaveAttribute("data-side", "right");
  await wide.screen.unmount();

  await page.viewport(390, 844);
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    const phone = await show("price");

    await expect.element(phone.screen.getByRole("dialog")).toHaveAttribute("data-side", "bottom");
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
