// The statistics screen tests' fake core: a plant in UTC with yesterday and the day before
// recorded, and every read the screen makes (ADR 9, 12).
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { iso } from "../range/calendar.ts";
import StatisticsScreen from "./StatisticsScreen.svelte";

const PLANT = "4294967294";
const H = 3_600_000;
const DAY = 24 * H;

/** Today, as a day number in UTC. */
export const TODAY = Math.floor(Date.now() / DAY);
export const YESTERDAY = iso(TODAY - 1);

const at = (day: number, h: number) => new Date((day * 24 + h) * H).toISOString();

const span = (day: number, h0: number, h1: number, mean: number) => ({
  start: at(day, h0),
  end: at(day, h1),
  mean,
});

/**
 * Yesterday 10–12 h: 3 kW sun, a 1 kW house, 2 kW out; 12–13 h unread; then 1 kW bought.
 * The day before: 2 kW sun 10–12 h only.
 */
function series() {
  const y = TODAY - 1;

  return {
    "pv.power": [span(y - 1, 10, 12, 2000), span(y, 10, 12, 3000)],
    "load.power": [span(y - 1, 0, 24, 500), span(y, 10, 12, 1000), span(y, 13, 24, 1000)],
    "grid.power": [span(y - 1, 0, 24, 500), span(y, 10, 12, -2000), span(y, 13, 24, 1000)],
  };
}

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
  /** Series the plant device publishes beside its powers. */
  battery: boolean;
  /** Days since recording began. */
  age: number;
  strings: number;
  /** Every read fails until `heal`. */
  broken: boolean;
  /** History waits for this. */
  gate: Promise<void> | null;
}

export const plant: Plant = { battery: false, age: 400, strings: 2, broken: false, gate: null };

export const asked: Readonly<{ series: string; from: number; to: number }>[] = [];

/** The plant's timezone was answered, so the range no longer moves under the screen. */
export const zone = { read: false };

export function reset(): void {
  Object.assign(plant, { battery: false, age: 400, strings: 2, broken: false, gate: null });
  asked.length = 0;
  zone.read = false;
}

/** Reads a request's query parameter. */
type Query = (name: string) => string | null;

function history(q: Query): Response {
  const name = q("series") ?? "";

  const [from, to] = [Date.parse(q("from")!), Date.parse(q("to")!)];

  asked.push({ series: name, from, to });

  const points = (new Map(Object.entries(series())).get(name) ?? []).filter(
    (p: Readonly<{ start: string; end: string }>) =>
      Date.parse(p.end) > from && Date.parse(p.start) < to,
  );

  return Response.json({ tier: "hour", points });
}

function costs(q: Query): Response {
  const [from, to] = [Date.parse(q("from")!), Date.parse(q("to")!)];

  const y = TODAY - 1;

  const day = {
    date: YESTERDAY,
    start: at(y, 0),
    end: at(y + 1, 0),
    paid: 3.3,
    earned: 0.32,
    saved: 1.2,
  };

  const days = Date.parse(day.start) >= from && Date.parse(day.start) < to ? [day] : [];

  const sum = (k: "paid" | "earned" | "saved") =>
    days.reduce((a, d: Readonly<typeof day>) => a + d[k], 0);

  return Response.json({
    days,
    total: { paid: sum("paid"), earned: sum("earned"), saved: sum("saved") },
  });
}

function statistics(q: Query): Response {
  const first = TODAY - plant.age;
  const point = { date: iso(first), start: at(first, 0), end: at(first + 1, 0) };

  return Response.json({ period: q("period"), points: [point] });
}

const READS = new Map<string, (q: Query) => Response>(
  Object.entries({
    timezone: () => {
      zone.read = true;

      return Response.json({ name: "UTC" });
    },
    history,
    costs,
    statistics,
    forecasts: () => Response.json({ points: [] }),
    capabilities: () =>
      Response.json({
        devices: {
          [PLANT]: {
            series: [
              "pv.power",
              "load.power",
              "grid.power",
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
    payback: () => Response.json({ investment: 12_000, remaining: 9000, savings: 3000 }),
    tariff: () =>
      Response.json({
        appliesFrom: at(TODAY - 100, 0),
        import: { price: 0.32, bands: [] },
        export: { price: 0.08, bands: [] },
      }),
  }),
);

function transport(): Transport {
  return {
    base: "http://core.test/",
    fetch: async (request) => {
      const url = new URL(request.url);
      const read = READS.get(url.pathname.split("/").at(-1) ?? "");

      if (plant.broken && url.pathname.endsWith("/history")) throw new TypeError("network");

      if (plant.gate && url.pathname.endsWith("/history")) await plant.gate;

      return read
        ? read((name) => url.searchParams.get(name))
        : Response.json({ problem: { code: "request.route" } }, { status: 404 });
    },
  };
}

/** The screen at `query`, and every route change it makes. */
export async function show(query: string) {
  const went: Readonly<{ patch: Readonly<Record<string, string | null>>; push: boolean }>[] = [];

  const screen = await render(StatisticsScreen, {
    core: connect(transport()),
    params: new URLSearchParams(query),
    go: (patch: Readonly<Record<string, string | null>>, push: boolean) => {
      went.push({ patch, push });
    },
  });

  return { screen, went };
}
