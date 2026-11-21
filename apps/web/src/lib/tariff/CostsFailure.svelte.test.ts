import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
import { connect } from "../api/core.ts";
import { problemText } from "../i18n/problems.ts";
import { testCore } from "./tariff.harness.ts";
import TariffScreen from "./TariffScreen.svelte";

// A costs read that fails, refused or lost, says so in place of the chart with a retry; a refusal
// says the core's reason too (ADR 21).

const MONTH = { params: new URLSearchParams("range=month&at=2026-11-01"), go: () => {} };

const COSTS = {
  days: [
    {
      start: "2026-11-02T00:00:00Z",
      end: "2026-11-03T00:00:00Z",
      paid: 0.3,
      earned: 0,
      saved: 0.15,
      standing: 0.5,
    },
  ],
  total: { paid: 0.3, earned: 0, saved: 0.15, standing: 0.5 },
};

/** The core's costs: refused with `code`, lost, or answered, as `costs` says at each read. */
function core(costs: () => "refused" | "lost" | "answered") {
  return testCore({
    "GET /api/v1/timezone": () => Response.json({ name: "UTC" }),
    "GET /api/v1/costs": () => {
      const now = costs();

      if (now === "lost") throw new TypeError("network");

      return now === "refused"
        ? Response.json({ status: 500, code: "internal" }, { status: 500 })
        : Response.json(COSTS);
    },
  });
}

test("refused costs say the core's reason in place of the chart, and a retry reads them", async () => {
  let costs: "refused" | "answered" = "refused";

  const screen = await render(TariffScreen, { core: connect(core(() => costs)), ...MONTH });
  const failed = screen.getByRole("alert");

  await expect
    .element(failed.getByText("Dieser Zeitraum konnte nicht gelesen werden."))
    .toBeVisible();
  await expect.element(failed.getByText(problemText("internal"))).toBeVisible();

  costs = "answered";
  await failed.getByRole("button", { name: "Erneut laden" }).click();
  await expect.element(screen.getByText("0,15 €")).toBeVisible();
});

test("costs a lost core did not answer say so with no reason, and a retry reads them", async () => {
  let costs: "lost" | "answered" = "lost";

  const screen = await render(TariffScreen, { core: connect(core(() => costs)), ...MONTH });
  const failed = screen.getByRole("alert");

  await expect
    .element(failed.getByText("Dieser Zeitraum konnte nicht gelesen werden."))
    .toBeVisible();
  expect(failed.getByText(problemText("internal")).query()).toBeNull();

  costs = "answered";
  await failed.getByRole("button", { name: "Erneut laden" }).click();
  await expect.element(screen.getByText("0,15 €")).toBeVisible();
});
