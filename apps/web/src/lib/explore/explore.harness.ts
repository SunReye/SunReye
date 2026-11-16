// The Explore screen tests' fake core: a plant in UTC with its series catalog and capabilities.
import { render } from "vitest-browser-svelte";
import { PLANT, WEATHER } from "../api/computed-devices.ts";
import { connect, type CatalogDevice, type Transport } from "../api/core.ts";
import ExploreScreen from "./ExploreScreen.svelte";

const SPAN = { first: "2026-01-01T00:00:00Z", last: "2026-11-15T12:00:00Z" };

const measured = (series: string, unit: string) =>
  ({ series, unit, kind: "measurement", ...SPAN }) as const;

const DEVICES: readonly CatalogDevice[] = [
  {
    id: PLANT,
    name: null,
    removed: false,
    series: [measured("pv.power", "W"), measured("load.power", "W")],
  },
  {
    id: 1,
    name: "Deye",
    removed: false,
    series: [
      measured("pv.power", "W"),
      measured("pv.mppt.power[2]", "W"),
      measured("pv.string.power[1]", "W"),
      measured("extra.fan", "none"),
    ],
  },
  { id: 5, name: "Alter Speicher", removed: true, series: [measured("battery.soc", "%")] },
  { id: WEATHER, name: null, removed: false, series: [measured("weather.ghi", "W/m²")] },
];

/** The catalog cannot be read until `heal`. */
export const plant = { broken: false };

export function reset(): void {
  plant.broken = false;
}

function transport(): Transport {
  return {
    base: "http://core.test/",
    fetch: (request) => {
      const read = new URL(request.url).pathname.split("/").at(-1);

      if (read === "timezone") return Promise.resolve(Response.json({ name: "UTC" }));

      if (read === "series" && !plant.broken)
        return Promise.resolve(Response.json({ devices: DEVICES }));

      if (read === "capabilities")
        return Promise.resolve(
          Response.json({
            devices: {
              "1": { series: [], estimated: ["pv.string.power[1]"], settings: [], writes: false },
            },
          }),
        );

      return Promise.resolve(Response.json({ status: 404, code: "not.found" }, { status: 404 }));
    },
  };
}

/** The screen at `query`, and every route change it makes. */
export async function show(query = "") {
  const went: Readonly<{ patch: Readonly<Record<string, string | null>>; push: boolean }>[] = [];

  const screen = await render(ExploreScreen, {
    core: connect(transport()),
    params: new URLSearchParams(query),
    go: (patch: Readonly<Record<string, string | null>>, push: boolean) => {
      went.push({ patch, push });
    },
  });

  return { screen, went };
}
