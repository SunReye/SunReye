// The forecast screen's test core and readers, shared by its component tests.
import { page } from "vitest/browser";
import type { Transport } from "../api/core.ts";

const WIRING = { moduleType: 1, modules: 16, optimized: 0, tilt: 35, loss: 2 };

/** The owner's layout: south and north in parallel on device 1's input 1, garage alone on device 2. */
const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [
    { ...WIRING, id: 4, name: "south", device: 1, input: 1, azimuth: 0 },
    { ...WIRING, id: 5, name: "north", device: 1, input: 1, azimuth: 180 },
    { ...WIRING, id: 7, name: "east", device: 1, input: 2, azimuth: -90 },
    { ...WIRING, id: 6, name: "garage", device: 2, input: 1, azimuth: 0 },
  ],
};

/** South and north share their input, so the core estimates them. */
const CAPABILITIES = {
  version: "5.0.0",
  schema: { min: 1, max: 1 },
  capabilities: [],
  transports: [],
  devices: {
    "1": {
      estimated: ["pv.string.power[4]", "pv.string.power[5]"],
      series: [],
      settings: [],
      writes: false,
    },
    "2": { estimated: [], series: [], settings: [], writes: false },
  },
};

const H = 3_600_000;
export const DAY = 24 * H;

/** A day rollup of `kwh` measured over all of it. */
const rolled = (start: number, kwh: number) => ({
  date: new Date(start).toISOString().slice(0, 10),
  start: new Date(start).toISOString(),
  end: new Date(start + DAY).toISOString(),
  integral: kwh * 1000,
  mean: (kwh * 1000) / 24,
  hours: 24,
});

export interface Plant {
  /** Day rollups by their UTC midnight. */
  readonly days: readonly (readonly [number, number])[];
  /** Day rollups for a series by name, in place of `days`. */
  readonly series?: Readonly<Record<string, readonly (readonly [number, number])[]>>;
  /** The forecast's power, held on every hour of [from, to). */
  readonly forecast: { readonly from: number; readonly to: number; readonly watts: number };
}

/** The plant's day rollups of the asked series over [from, to). */
function statistics(plant: Readonly<Plant>, series: string, from: number, to: number) {
  const days = plant.series?.[series] ?? plant.days;

  const points = days
    .filter(([start]) => start >= from && start < to)
    .map(([start, kwh]) => rolled(start, kwh));

  return { period: "day", points };
}

/** The plant's hourly forecast over [from, to). */
function forecasts(plant: Readonly<Plant>, from: number, to: number) {
  const issued = new Date(plant.forecast.from - DAY).toISOString();
  const points = [];

  for (let t = Math.max(from, plant.forecast.from); t < Math.min(to, plant.forecast.to); t += H)
    points.push({ target: new Date(t).toISOString(), issued, value: plant.forecast.watts });

  return { points };
}

/** What the core answers that does not depend on the plant. */
const FIXED = {
  layout: LAYOUT,
  capabilities: CAPABILITIES,
  timezone: { name: "UTC" },
} as const;

const fixed = (name: string): name is keyof typeof FIXED => Object.hasOwn(FIXED, name);

/** A test core: the layout, the capabilities, the plant's day rollups and its hourly forecast. */
export function testCore(plant: Plant): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);
      const last = url.pathname.split("/").at(-1) ?? "";

      if (fixed(last)) return Promise.resolve(Response.json(FIXED[last]));

      const series = url.searchParams.get("series") ?? "";

      asked.push(`${url.pathname} ${series}`);

      const from = Date.parse(url.searchParams.get("from") ?? "");
      const to = Date.parse(url.searchParams.get("to") ?? "");

      return Promise.resolve(
        Response.json(
          last === "statistics" ? statistics(plant, series, from, to) : forecasts(plant, from, to),
        ),
      );
    },
  };
}

/** Week 45 of 2026: Monday to Wednesday measured, Thursday forecast but unmeasured. */
export const MONDAY = Date.UTC(2026, 10, 2);

export const WEEK: Plant = {
  days: [
    [MONDAY, 10],
    [MONDAY + DAY, 12],
    [MONDAY + 2 * DAY, 8],
  ],
  // 500 W around the clock: 12 kWh a day.
  forecast: { from: MONDAY, to: MONDAY + 4 * DAY, watts: 500 },
};

export const PAST_WEEK = { params: new URLSearchParams("range=week&at=2026-11-02"), go: () => {} };

export const card = (device: number) =>
  page.getByRole("region", { name: device === 1 ? "Wechselrichter 1" : "Wechselrichter 2" });

/** The figure the legend gives a term, as it shows. */
export function legendValue(device: number, term: string): string | undefined {
  const dd = card(device)
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`, "u") })
    .element().nextElementSibling;

  return dd instanceof HTMLElement ? dd.innerText.trim() : undefined;
}
