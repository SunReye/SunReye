import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { served, setup, show, teardown } from "./detail.harness.ts";

beforeEach(setup);

afterEach(teardown);

const POWER_SHEETS = [
  ["production", "Produktion"],
  ["consumption", "Verbrauch"],
  ["feedIn", "Einspeisung"],
  ["purchase", "Bezug"],
  ["pv", "PV gesamt"],
  ["inverter", "Wechselrichter"],
  ["string-1", "Süd"],
  ["battery", "Batterie"],
  ["grid", "Netz"],
  ["house", "Haus"],
] as const;

test("every power sheet opens with its live graph", async () => {
  const { screen } = await show(POWER_SHEETS[0][0]);

  for (const [id, title] of POWER_SHEETS) {
    // oxlint-disable-next-line no-await-in-loop -- one sheet open at a time.
    await screen.rerender({ detail: id });

    const sheet = screen.getByRole("dialog", { name: title });
    // oxlint-disable-next-line no-await-in-loop -- as above.
    await expect.element(sheet.getByRole("region", { name: "Live-Leistung" })).toBeVisible();
  }
});

test("a sheet without a power has no live graph", async () => {
  const { screen } = await show("price");

  await expect.element(screen.getByRole("dialog", { name: "Spotpreis" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Live-Leistung" }).query()).toBeNull();
});

test("the grid's live graph fills import above zero and export below", async () => {
  served.tick = true;

  const { screen } = await show("grid");
  const live = screen.getByRole("region", { name: "Live-Leistung" });

  await expect.element(live).toBeVisible();
  await expect
    .poll(() =>
      [...live.element().querySelectorAll("linearGradient[id$='-fill'] stop")].map((stop) =>
        stop.getAttribute("stop-color"),
      ),
    )
    .toEqual(["var(--e-import)", "var(--e-import)", "var(--e-export)", "var(--e-export)"]);
});
