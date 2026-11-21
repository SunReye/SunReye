// The statistics screen tests' fake core: a plant in UTC with yesterday and the day before
// recorded, and every read the screen makes (ADR 9, 12).
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { eachSeries } from "../api/core.harness.ts";
import { iso } from "../range/calendar.ts";
import StatisticsScreen from "./StatisticsScreen.svelte";
import { at, rollups, series, TODAY } from "./statistics.series.ts";

const H = 3_600_000;
const DAY = 24 * H;

export { TODAY } from "./statistics.series.ts";

export const YESTERDAY = iso(TODAY - 1);

const WIRING = {
  device: 1,
  azimuth: 0,
  tilt: 30,
  loss: 0,
  moduleType: 1,
  modules: 10,
  optimized: 0,
};

export interface Plant {
  /** The inverter publishes a battery's power beside its own. */
  battery: boolean;
  /** Days since recording began. */
  age: number;
  strings: number;
  /** Every read fails until `heal`. */
  broken: boolean;
  /** The code the core refuses every statistics read with; null while it answers. */
  refused: string | null;
  /** History waits for this. */
  gate: Promise<void> | null;
  /** The core has measured the battery's capacity. */
  measured: boolean;
  /** Three months of savings set a pace. */
  paced: boolean;
}

const PLANT_DEFAULTS: Plant = {
  battery: false,
  age: 400,
  strings: 2,
  broken: false,
  refused: null,
  gate: null,
  measured: true,
  paced: true,
};

export const plant: Plant = { ...PLANT_DEFAULTS };

/** This year, by UTC. */
export const YEAR = new Date(TODAY * DAY).getUTCFullYear();

export const asked: Readonly<{ series: string; from: number; to: number }>[] = [];

/** The plant's timezone was answered, so the range no longer moves under the screen. */
export const zone = { read: false };

export function reset(): void {
  Object.assign(plant, PLANT_DEFAULTS);
  asked.length = 0;
  zone.read = false;
}

/** Reads a request's query parameter. */
type Query = (name: string) => string | null;

function history(q: Query, href: string): Response {
  const [from, to] = [Date.parse(q("from")!), Date.parse(q("to")!)];

  return eachSeries(href, (name) => {
    asked.push({ series: name, from, to });

    const points = (new Map(Object.entries(series())).get(name) ?? []).filter(
      (p: Readonly<{ start: string; end: string }>) =>
        Date.parse(p.end) > from && Date.parse(p.start) < to,
    );

    return { tier: "hour", points };
  });
}

/** A plant-local day's bounds, as the core states them. */
const dayAt = (d: number) => ({ date: iso(d), start: at(d, 0), end: at(d + 1, 0) });

function costs(q: Query): Response {
  const [from, to] = [Date.parse(q("from")!), Date.parse(q("to")!)];

  const y = TODAY - 1;

  const day = {
    ...dayAt(y),
    paid: 3.3,
    earned: 0.32,
    saved: 1.2,
    standing: 0,
  };

  const days = Date.parse(day.start) >= from && Date.parse(day.start) < to ? [day] : [];

  const sum = (k: "paid" | "earned" | "saved") =>
    days.reduce((a, d: Readonly<typeof day>) => a + d[k], 0);

  return Response.json({
    days,
    total: { paid: sum("paid"), earned: sum("earned"), saved: sum("saved"), standing: 0 },
  });
}

/** 3000 € of 12 000 € saved at 1200 € a year: paid back in November 2033. */
function payback(): Response {
  return Response.json({
    investment: 12_000,
    remaining: 9000,
    savings: 3000,
    pace: plant.paced ? 1200 : null,
    reached: plant.paced ? "2033-11-15" : null,
    months: [
      { date: iso(TODAY - 60), saved: 2800 },
      { date: iso(TODAY - 30), saved: 2900 },
      { date: iso(TODAY), saved: 3000 },
    ],
  });
}

const figures = (production: number, saved: number) => ({
  production,
  consumption: 5000,
  selfSupply: 3000,
  saved,
});

/** This year to date against the same dates last year, and last year whole. */
function records(): Response {
  return Response.json({
    years: [
      { year: YEAR, running: true, figures: figures(4200, 800), before: figures(3500, 700) },
      { year: YEAR - 1, running: false, figures: figures(6000, 1100), before: null },
    ],
    bestDay: { date: iso(TODAY - 100), value: 61.2 },
    bestMonth: { date: `${YEAR - 1}-06-01`, value: 1040 },
    bestSaving: { date: iso(TODAY - 90), value: 9.8 },
  });
}

/** Six discharges a month apart, losing capacity, against a 10 kWh nameplate. */
function capacity(): Response {
  const kwh = [10, 9.9, 9.8, 9.7, 9.6, 9.5];

  return Response.json({
    measurements: plant.measured
      ? kwh.map((v, i) => ({ end: at(TODAY - 150 + i * 30, 20), kwh: v }))
      : [],
    now: plant.measured ? 9.7 : null,
    first: plant.measured ? 9.8 : null,
    perYear: plant.measured ? -0.04 : null,
    nameplate: 10,
    discharged: 1234,
    cycles: 123.4,
    since: at(TODAY - 300, 0),
  });
}

function statistics(q: Query, href: string): Response {
  const [from, to] = [Date.parse(q("from")!), Date.parse(q("to")!)];
  const period = q("period") ?? "";

  return eachSeries(href, (name) => {
    const recorded = period === "day" || period === "hour" ? rollups(name, period, from, to) : [];

    asked.push({ series: name, from, to });

    return { period, points: recorded.length > 0 ? recorded : [dayAt(TODAY - plant.age)] };
  });
}

const READS = new Map<string, (q: Query, href: string) => Response>(
  Object.entries({
    timezone: () => {
      zone.read = true;

      return Response.json({ name: "UTC" });
    },
    history,
    costs,
    statistics,
    forecasts: (_, href) => eachSeries(href, () => ({ points: [] })),
    capabilities: () =>
      Response.json({
        devices: {
          // The core lists registered devices only, never the plant.
          "1": {
            series: [
              "pv.power",
              "load.power",
              "grid.import.power",
              ...(plant.battery ? ["battery.power"] : []),
            ],
            estimated: [],
            settings: [],
            writes: false,
          },
        },
      }),
    layout: () =>
      Response.json({
        strings: Array.from({ length: plant.strings }, (_, i) => ({
          id: i + 1,
          name: `String ${i + 1}`,
          input: i + 1,
          ...WIRING,
        })),
      }),
    "module-types": () => Response.json({ moduleTypes: [{ id: 1, pmax: 400 }] }),
    corrections: () => Response.json({ inputs: [] }),
    payback,
    records,
    capacity,
    tariff: () =>
      Response.json({
        appliesFrom: at(TODAY - 100, 0),
        import: { price: 0.32, bands: [] },
        export: { price: 0.08, bands: [] },
      }),
  }),
);

/** A core that answers from the synthetic plant and records the path and query of each request in `urls`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- it collects into `urls`.
function transport(urls: string[]): Transport {
  return {
    base: "http://core.test/",
    fetch: async (request) => {
      const url = new URL(request.url);

      urls.push(`${url.pathname}${url.search}`);
      const read = READS.get(url.pathname.split("/").at(-1) ?? "");

      const plantRead = /\/(history|statistics)$/u.test(url.pathname);

      if (plant.broken && plantRead) throw new TypeError("network");

      if (plant.refused !== null && url.pathname.endsWith("/statistics"))
        return Response.json({ status: 422, code: plant.refused }, { status: 422 });

      if (plant.gate && plantRead) await plant.gate;

      return read
        ? read((name) => url.searchParams.get(name), request.url)
        : Response.json({ problem: { code: "request.route" } }, { status: 404 });
    },
  };
}

/** The screen at `query`, every route change it makes, and every URL it asks its core. */
export async function show(query: string) {
  const went: Readonly<{ patch: Readonly<Record<string, string | null>>; push: boolean }>[] = [];
  const urls: string[] = [];

  const screen = await render(StatisticsScreen, {
    core: connect(transport(urls)),
    params: new URLSearchParams(query),
    go: (patch: Readonly<Record<string, string | null>>, push: boolean) => {
      went.push({ patch, push });
    },
  });

  return { screen, went, urls };
}
