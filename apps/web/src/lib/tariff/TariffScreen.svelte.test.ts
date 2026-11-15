import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
import { connect } from "../api/core.ts";
import { NOW, testCore } from "./tariff.harness.ts";
import TariffScreen from "./TariffScreen.svelte";

test("the prices in force show in ct/kWh, the spot price with its attribution", async () => {
  const screen = await render(TariffScreen, { core: connect(testCore({})), ...NOW });

  await expect
    .element(screen.getByRole("definition").filter({ hasText: "30,00 ct/kWh" }))
    .toBeVisible();
  await expect.element(screen.getByText("8,00 ct/kWh")).toBeVisible();
  await expect.element(screen.getByText("12,34 ct/kWh")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "CC BY 4.0" }))
    .toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
});

const COSTS = {
  days: [
    {
      start: "2026-11-01T00:00:00Z",
      end: "2026-11-02T00:00:00Z",
      paid: 0,
      earned: 0.32,
      saved: 0.62,
    },
    {
      start: "2026-11-02T00:00:00Z",
      end: "2026-11-03T00:00:00Z",
      paid: 0.3,
      earned: 0,
      saved: 0.15,
    },
  ],
  total: { paid: 0.3, earned: 0.32, saved: 0.77 },
};

test("the range's savings and costs read in the chart's legend, as the core totals them", async () => {
  const core = testCore({
    "GET /api/v1/costs": () => Response.json(COSTS),
    "GET /api/v1/timezone": () => Response.json({ name: "UTC" }),
  });

  const route = { params: new URLSearchParams("range=month&at=2026-11-01"), go: () => {} };

  const screen = await render(TariffScreen, { core: connect(core), ...route });

  // Avoided import is what was saved beyond the feed-in pay.
  await expect.element(screen.getByText("0,45 €")).toBeVisible();
  await expect.element(screen.getByText("0,32 €")).toBeVisible();
  await expect.element(screen.getByText("0,30 €")).toBeVisible();
  await expect
    .poll(() => core.sent.map((s) => s.route))
    .toContain(
      "GET /api/v1/costs?from=2026-11-01T00%3A00%3A00.000Z&to=2026-12-01T00%3A00%3A00.000Z",
    );
});

test("money over time and payback live in History, which the screen links to", async () => {
  const screen = await render(TariffScreen, { core: connect(testCore({})), ...NOW });

  await expect
    .element(screen.getByRole("link", { name: "Im Verlauf ansehen" }))
    .toHaveAttribute("href", "#/history?metric=money");
  await expect.element(screen.getByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
});
