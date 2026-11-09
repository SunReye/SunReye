import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import ForecastScreen from "./ForecastScreen.svelte";

const WIRING = { moduleType: 1, modules: 16, optimized: 0, tilt: 35, loss: 2 };

/** The owner's layout: south and north in parallel on device 1's input 1, garage alone on device 2. */
const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [
    { ...WIRING, id: 4, name: "south", device: 1, input: 1, azimuth: 0 },
    { ...WIRING, id: 5, name: "north", device: 1, input: 1, azimuth: 180 },
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
    "1": { estimated: ["pv.string.power[4]", "pv.string.power[5]"], settings: [], writes: false },
    "2": { estimated: [], settings: [], writes: false },
  },
};

/** A test core: the layout, the capabilities and one forecast point per series. */
function testCore(): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);

      if (url.pathname.endsWith("/layout")) return Promise.resolve(Response.json(LAYOUT));

      if (url.pathname.endsWith("/capabilities"))
        return Promise.resolve(Response.json(CAPABILITIES));

      asked.push(`${url.pathname} ${url.searchParams.get("series") ?? ""}`);
      const point = { target: "2026-11-09T11:00:00Z", issued: "2026-11-09T10:00:00Z", value: 900 };

      return Promise.resolve(Response.json({ points: [point] }));
    },
  };
}

test("the forecast screen reads each inverter's, MPPT input's and string's forecast", async () => {
  const transport = testCore();

  await render(ForecastScreen, { core: connect(transport) });

  await expect
    .poll(() => transport.asked.toSorted())
    .toEqual([
      "/api/v1/devices/1/forecasts pv.mppt.power[1]",
      "/api/v1/devices/1/forecasts pv.power",
      "/api/v1/devices/1/forecasts pv.string.power[4]",
      "/api/v1/devices/1/forecasts pv.string.power[5]",
      "/api/v1/devices/2/forecasts pv.mppt.power[1]",
      "/api/v1/devices/2/forecasts pv.power",
      "/api/v1/devices/2/forecasts pv.string.power[6]",
    ]);
});

test("the forecast screen marks estimated strings", async () => {
  const screen = await render(ForecastScreen, { core: connect(testCore()) });

  await expect.element(screen.getByText("south (geschätzt)")).toBeVisible();
  await expect.element(screen.getByText("north (geschätzt)")).toBeVisible();
  await expect.element(screen.getByText("garage", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("MPPT 1").first()).toBeVisible();
});
