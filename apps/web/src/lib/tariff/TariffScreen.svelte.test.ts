import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
import { settled } from "../api/core.harness.ts";
import { connect, SPOT, TARIFF } from "../api/core.ts";
import { aside, dragBy, letGo } from "../range/drag.harness.ts";
import { feed } from "../live/stream.harness.ts";
import { NOW, testCore } from "./tariff.harness.ts";
import TariffScreen from "./TariffScreen.svelte";

test("the prices in force show in ct/kWh, the spot price with its attribution", async () => {
  feed()({
    devices: {
      [TARIFF]: { "price.import": 0.3, "price.export": 0.08, "cost.savings.rate": 0.1 },
      [SPOT]: { "price.spot": 0.1234 },
    },
  });

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
      standing: 0.5,
    },
    {
      start: "2026-11-02T00:00:00Z",
      end: "2026-11-03T00:00:00Z",
      paid: 0.3,
      earned: 0,
      saved: 0.15,
      standing: 0.5,
    },
  ],
  total: { paid: 0.3, earned: 0.32, saved: 0.77, standing: 1 },
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
  // The standing charge is a cost of its own.
  await expect.element(screen.getByText("Grundpreis", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("1,00 €")).toBeVisible();
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

test("a finger drags the costs to the earlier month, read only once it is shown", async () => {
  const core = testCore({
    "GET /api/v1/costs": () => Response.json(COSTS),
    "GET /api/v1/timezone": () => Response.json({ name: "UTC" }),
  });

  const went: (string | null | undefined)[] = [];

  const screen = await render(TariffScreen, {
    core: connect(core),
    params: new URLSearchParams("range=month&at=2026-11-01"),
    go: (patch: Readonly<Record<string, string | null>>) => {
      went.push(patch.at);
    },
  });

  await expect.element(screen.getByText("0,45 €")).toBeVisible();

  const costs = () => core.sent.filter((s) => s.route.startsWith("GET /api/v1/costs")).length;

  await settled(costs);

  const before = costs();
  const title = screen.getByRole("heading", { name: "Kosten und Ersparnis" }).element();
  const card = title.closest<HTMLElement>("[data-slot=card]")!;

  await dragBy(title, 240, { hold: true });
  // October stands beside November, drawn loading: nothing is read for it yet.
  expect(aside(card)).toBeGreaterThan(0);
  expect(costs()).toBe(before);

  letGo(title);
  await expect.poll(() => went.at(-1)).toBe("2026-10-01");
  await settled(costs);
  expect(core.sent.at(-1)?.route).toContain("from=2026-10-01");
  expect(costs()).toBe(before + 1);
});
