// The fold pane tests' fake core: a plant in UTC with a measurement, a counter and a status, and
// the statistics it answers for October 2026.
import { render } from "vitest-browser-svelte";
import { connect, type CatalogDevice, type Statistics, type Transport } from "../api/core.ts";
import ExploreScreen from "./ExploreScreen.svelte";

const SPAN = { first: "2026-01-01T00:00:00Z", last: "2026-11-15T12:00:00Z" };

const DEVICES: readonly CatalogDevice[] = [
  {
    id: 1,
    name: "Deye",
    removed: false,
    series: [
      { series: "pv.power", unit: "W", kind: "measurement", ...SPAN },
      { series: "battery.temperature", unit: "°C", kind: "measurement", ...SPAN },
      { series: "cost.import", unit: "EUR/h", kind: "measurement", ...SPAN },
      { series: "grid.import.energy", unit: "kWh", kind: "counter", ...SPAN },
      { series: "inverter.status", unit: "none", kind: "status", ...SPAN },
    ],
  },
];

const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;

const bounds = (d: number) => ({
  date: day(d),
  start: `${day(d)}T00:00:00Z`,
  end: `${day(d + 1)}T00:00:00Z`,
});

/** Three days of October; the 2nd has no rolled-up history. */
const POINTS: ReadonlyMap<string, Statistics["points"]> = new Map([
  [
    "pv.power",
    [
      { ...bounds(1), mean: 400, min: 0, max: 3000, integral: 9600, hours: 24 },
      { ...bounds(3), mean: 100, min: 0, max: 900, integral: 1200, hours: 12 },
      { ...bounds(4), mean: 250, min: 0, max: 4000, integral: 6000, hours: 24 },
    ],
  ],
  [
    "battery.temperature",
    [{ ...bounds(1), mean: 21.5, min: 18, max: 26, integral: 516, hours: 24 }],
  ],
  ["cost.import", [{ ...bounds(1), mean: 0.1, min: 0, max: 0.5, integral: 2.4, hours: 24 }]],
  [
    "grid.import.energy",
    [
      { ...bounds(1), delta: 12.5 },
      { ...bounds(3), delta: 3 },
    ],
  ],
]);

/** `refused`: the core refuses statistics. `asked`: every statistics read, as its query. */
export const plant = { refused: false, asked: new Array<URLSearchParams>() };

export function reset(): void {
  plant.refused = false;
  plant.asked = [];
}

function transport(): Transport {
  return {
    base: "http://core.test/",
    fetch: (request) => {
      const url = new URL(request.url);
      const read = url.pathname.split("/").at(-1);

      if (read === "timezone") return Promise.resolve(Response.json({ name: "UTC" }));

      if (read === "series") return Promise.resolve(Response.json({ devices: DEVICES }));

      if (read === "capabilities") return Promise.resolve(Response.json({ devices: {} }));

      if (read === "statistics" && !plant.refused) {
        plant.asked.push(url.searchParams);

        const points = POINTS.get(url.searchParams.get("series") ?? "") ?? [];

        return Promise.resolve(Response.json({ period: url.searchParams.get("period"), points }));
      }

      return Promise.resolve(Response.json({ status: 404, code: "not.found" }, { status: 404 }));
    },
  };
}

/** Fold mode on `series` of the device over October 2026, and every route change it makes. */
export async function fold(series: string, query = "range=month&at=2026-10-15") {
  const went: Readonly<Record<string, string | null>>[] = [];

  const screen = await render(ExploreScreen, {
    core: connect(transport()),
    params: new URLSearchParams(`mode=fold&s=1:${series}&${query}`),
    go: (patch: Readonly<Record<string, string | null>>) => {
      went.push(patch);
    },
  });

  return { screen, went };
}
