import { expect, test } from "bun:test";
import { connect } from "../api/core.ts";
import { eachSeries } from "../api/core.harness.ts";
import { readDay } from "../dashboard/day.ts";
import { sumOf } from "./flows.ts";
import { readPlant } from "./plant-read.ts";

const H = 3_600_000;
const MIDNIGHT = Date.parse("2026-11-03T00:00:00Z");
const NOW = MIDNIGHT + 15 * H;

/** Today's rollups in Wh, each series apart, and a curve that disagrees with every one. */
const ROLLED = new Map(
  Object.entries({
    "pv.power": 12_300,
    "load.power": 9_100,
    "grid.import.power": 2_400,
    "grid.export.power": 5_600,
    "self.consumption.power": 6_700,
    "self.supply.power": 6_700,
    "battery.charge.power": 300,
    "battery.discharge.power": 1_100,
    "ev.charge.power": 1_900,
  }),
);

/** Today's rollup of a series, when the read's [from, to) holds its start. */
function rollup(series: string, from: number, to: number) {
  const day = {
    date: "2026-11-03",
    start: new Date(MIDNIGHT).toISOString(),
    end: new Date(MIDNIGHT + 24 * H).toISOString(),
    integral: ROLLED.get(series),
  };

  return {
    period: "day",
    points: MIDNIGHT >= from && MIDNIGHT < to && ROLLED.has(series) ? [day] : [],
  };
}

const CURVE = {
  tier: "raw",
  points: [
    { start: new Date(MIDNIGHT).toISOString(), end: new Date(NOW).toISOString(), mean: 333 },
  ],
};

const ROUTES = new Map(
  Object.entries({
    timezone: () => Response.json({ name: "UTC" }),
    statistics: (href: string) => {
      const q = new URL(href).searchParams;
      const [from, to] = [Date.parse(q.get("from") ?? ""), Date.parse(q.get("to") ?? "")];

      return eachSeries(href, (series) => rollup(series, from, to));
    },
    history: (href: string) => eachSeries(href, () => CURVE),
    forecasts: (href: string) => eachSeries(href, () => ({ points: [] })),
    layout: () => Response.json({ strings: [] }),
  }),
);

function fake() {
  return connect({
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const route = ROUTES.get(url.pathname.split("/").at(-1) ?? "");

      return route
        ? Promise.resolve(route(request.url))
        : Promise.resolve(
            Response.json(
              { code: "tariff.none", status: 404 },
              { status: 404, headers: { "content-type": "application/problem+json" } },
            ),
          );
    },
  });
}

test("History's today reads the core's rollups, as the dashboard does", async () => {
  const core = fake();
  const day = await readDay(core, new Date(NOW));
  const s = sumOf(await readPlant(core, MIDNIGHT, NOW), MIDNIGHT, NOW);

  expect(s).toMatchObject({
    production: 12.3,
    consumption: 9.1,
    purchase: 2.4,
    feedIn: 5.6,
    selfUsed: 6.7,
    selfCovered: 6.7,
    charge: 0.3,
    discharge: 1.1,
    ev: 1.9,
  });
  expect(s).toMatchObject({
    production: day.today.production,
    consumption: day.today.consumption,
    purchase: day.today.purchase,
    feedIn: day.today.feedIn,
    autarky: day.today.autarky,
    selfUse: day.today.selfUse,
  });
});
