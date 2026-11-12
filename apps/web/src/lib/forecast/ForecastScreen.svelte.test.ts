import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
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
    "1": {
      estimated: ["pv.string.power[4]", "pv.string.power[5]"],
      series: [],
      settings: [],
      writes: false,
    },
    "2": { estimated: [], series: [], settings: [], writes: false },
  },
};

/** A test core: the layout, the capabilities, two forecast hours of 900 W per series, nothing measured. */
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

      if (url.pathname.endsWith("/timezone"))
        return Promise.resolve(Response.json({ name: "UTC" }));

      asked.push(`${url.pathname} ${url.searchParams.get("series") ?? ""}`);

      if (url.pathname.endsWith("/history")) {
        return Promise.resolve(Response.json({ tier: "hour", points: [] }));
      }

      const issued = "2026-11-09T10:00:00Z";

      const points = [
        { target: "2026-11-09T11:00:00Z", issued, value: 900 },
        { target: "2026-11-09T12:00:00Z", issued, value: 900 },
      ];

      return Promise.resolve(Response.json({ points }));
    },
  };
}

/** The screen on 2026-11-09. */
const DAY = { params: new URLSearchParams("range=day&at=2026-11-09"), go: () => {} };

test("each inverter's chart reads its total's forecast and measurement over the range", async () => {
  const transport = testCore();

  const screen = await render(ForecastScreen, { core: connect(transport), ...DAY });

  await expect
    .poll(() => [...new Set(transport.asked)].toSorted())
    .toEqual([
      "/api/v1/devices/1/forecasts pv.power",
      "/api/v1/devices/1/history pv.power",
      "/api/v1/devices/2/forecasts pv.power",
      "/api/v1/devices/2/history pv.power",
    ]);
  await expect.element(screen.getByText("1,8 kWh").first()).toBeVisible();

  await screen.getByRole("radio", { name: "south (geschätzt)" }).click();

  await expect
    .poll(() => transport.asked)
    .toContain("/api/v1/devices/1/forecasts pv.string.power[4]");
});

test("the forecast screen marks estimated strings", async () => {
  const screen = await render(ForecastScreen, { core: connect(testCore()), ...DAY });

  await expect.element(screen.getByText("south (geschätzt)")).toBeVisible();
  await expect.element(screen.getByText("north (geschätzt)")).toBeVisible();
  await expect.element(screen.getByText("garage", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("MPPT 1").first()).toBeVisible();
});
