// The PV, inverter and string sheets (ADR 21 "Sheet content"): the range's energy and its peak
// with time, actual against forecast, and the inverter's temperature where its profile maps one.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { fetched, prepare, restore, show } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

test("a string's overview sets today against its own forecast, read from its inverter", async () => {
  const { screen } = await show("string-1");
  const sheet = screen.getByRole("dialog", { name: "Süd" });
  const overview = sheet.getByRole("tabpanel", { name: "Übersicht" });

  await expect.element(overview.getByRole("term").filter({ hasText: "Prognose" })).toBeVisible();
  await expect.element(overview.getByText("8,0 kWh")).toBeVisible();
  expect(fetched).toContain(
    "/api/v1/devices/1/forecasts pv.string.power[1] 2026-11-12T00:00:00.000Z",
  );
});
