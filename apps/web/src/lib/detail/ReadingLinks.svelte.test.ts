import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { BATTERY, INVERTER, PLANT, prepare, restore, served, show } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

test("a reading with stored history opens Explore on its series at the sheet's range", async () => {
  served.stored = { [BATTERY]: ["battery.soc"] };

  const { screen } = await show("battery", "range=week&at=2026-11-02");
  const readings = screen.getByRole("region", { name: "Messwerte" });

  await expect
    .element(readings.getByRole("link", { name: "Ladezustand" }))
    .toHaveAttribute("href", "#/explore?range=week&at=2026-11-02&s=2%3Abattery.soc");
  // The cycle count has no stored history.
  await expect.element(readings.getByText("Zyklen")).toBeVisible();
  expect(readings.getByRole("link", { name: "Zyklen" }).query()).toBeNull();
});

test("a sheet opened without a range links Explore at its day", async () => {
  served.stored = { [BATTERY]: ["battery.soc"] };

  const { screen } = await show("battery");

  await expect
    .element(screen.getByRole("link", { name: "Ladezustand" }))
    .toHaveAttribute("href", "#/explore?range=day&s=2%3Abattery.soc");
});

test("an estimated sibling's value opens Explore, its name still its sheet", async () => {
  served.stored = { [INVERTER]: ["pv.string.power[2]"] };

  const { screen, onopen } = await show("string-1");
  const sheet = screen.getByRole("dialog", { name: "Süd" });

  await expect
    .element(sheet.getByRole("link", { name: "Nord in Erkunden öffnen" }))
    .toHaveAttribute("href", "#/explore?range=day&s=1%3Apv.string.power%5B2%5D");
  await sheet.getByRole("button", { name: "Nord" }).click();

  expect(onopen).toHaveBeenCalledWith("string-2");
});

test("a table's reading opens Explore on its indexed series", async () => {
  served.stored = { [INVERTER]: ["pv.mppt.power[2]"] };

  const { screen } = await show("pv");
  const readings = screen.getByRole("region", { name: "Messwerte" });

  await expect
    .element(
      readings.getByRole("link", {
        name: "Eingang 2 · Leistung in Erkunden öffnen",
      }),
    )
    .toHaveAttribute("href", "#/explore?range=day&s=1%3Apv.mppt.power%5B2%5D");
  expect(readings.getByRole("link").all()).toHaveLength(1);
});

test("a consumer's reading opens Explore on the plant's point", async () => {
  served.stored = { [PLANT]: ["point.power[2]"] };

  const { screen } = await show("house");

  await expect
    .element(screen.getByRole("link", { name: "Wärmepumpe" }))
    .toHaveAttribute("href", `#/explore?range=day&s=${PLANT}%3Apoint.power%5B2%5D`);
});
