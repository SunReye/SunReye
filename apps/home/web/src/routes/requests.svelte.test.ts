// How many requests a screen makes as it opens, against a fake core: a redundant read shows here.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../lib/api/core.ts";
import {
  eachSeries,
  fakeClock,
  json,
  problem,
  restoreClock,
  sceneMayMount,
  settled,
  tally,
  type Schema,
} from "./requests.harness.ts";
import { coreContext } from "../lib/shell/core.ts";
import App from "./shell.harness.svelte";
import History from "./history/+page.svelte";
import Home from "./+page.svelte";
import Dashboard from "../lib/dashboard/Dashboard.svelte";
import "../app.css";

const PLANT = "4294967294";
const SPOT = "4294967292";
const WEATHER = "4294967295";

const INVERTER = { id: 1, name: "Wechselrichter", profile: "deye-sg05lp3", connection: 1, unit: 1 };

const STRING = {
  id: 1,
  name: "Süd",
  optimized: 0,
  device: 1,
  input: 1,
  azimuth: 0,
  tilt: 30,
  loss: 0,
  moduleType: 1,
  modules: 10,
};

/** A 10 m × 8 m gable house with one string on its inverter. */
const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [STRING],
  warnings: [],
  scene: {
    north: 0,
    blocks: [
      { x: 0, z: 0, width: 10, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
    ],
    obstacles: [],
  },
} satisfies Schema<"Layout">;

const ANSWERS = new Map<string, () => Response>([
  ["/api/v1/session", () => new Response(null, { status: 204 })],
  ["/api/v1/devices", () => json("DeviceList", { devices: [INVERTER] })],
  ["/api/v1/layout", () => json("Layout", LAYOUT)],
  ["/api/v1/timezone", () => json("Zone", { name: "UTC" })],
  [
    "/api/v1/capabilities",
    () =>
      json("Support", {
        version: "5.0.0",
        schema: { min: 1, max: 1 },
        capabilities: [],
        transports: [],
        devices: {},
      }),
  ],
  ["/api/v1/module-types", () => json("ModuleTypes", { moduleTypes: [] })],
  ["/api/v1/location", () => json("Location", { latitude: 52.5, longitude: 13.4 })],
  ["/api/v1/series", () => json("SeriesCatalog", { devices: [] })],
  ["/api/v1/topology", () => json("Topology", { appliesFrom: "2026-11-01T00:00:00Z", points: [] })],
  [
    "/api/v1/live",
    () =>
      new Response(
        new ReadableStream({
          start: (controller) => {
            controller.enqueue(
              new TextEncoder().encode(`event: snapshot\ndata: {"devices":{}}\n\n`),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  ],
]);

/** The weather device's forecast: a drizzle all day. */
const SKY = [{ issued: "2026-11-12T00:00:00Z", target: "2026-11-12T00:00:00Z", value: 51 }];

function answer(href: string): Response {
  const { pathname } = new URL(href, "http://core.test/");
  const known = ANSWERS.get(pathname);

  if (known) return known();

  if (pathname.endsWith(`/devices/${WEATHER}/forecasts`))
    return eachSeries(href, (series) => ({ points: series === "weather.code" ? SKY : [] }));

  if (/\/(?:history|forecasts|statistics)$/u.test(pathname))
    return eachSeries(href, () => ({ points: [] }));

  return problem(404, "not.found");
}

/** Every API request the page made, in order. */
const urls: string[] = [];

const fake = (request: Request) => {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/api/")) return null;

  urls.push(request.url);

  return Promise.resolve(answer(request.url));
};

afterEach(() => {
  restoreClock();
});

beforeEach(async () => {
  fakeClock();
  urls.length = 0;
  await page.viewport(1280, 900);
});

test("the dashboard opens on one read of each thing it shows", async () => {
  const pass = globalThis.fetch.bind(globalThis);

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- fetch's own parameters are mutable.
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const request = new Request(
      input instanceof Request ? input : new URL(String(input), location.href),
      init,
    );

    return fake(request) ?? pass(input, init);
  });

  const screen = await render(App);

  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();

  const reads = {
    session: 1,
    devices: 1,
    layout: 1,
    timezone: 1,
    capabilities: 1,
    "module-types": 1,
    location: 1,
    "sun-tint": 1,
    live: 1,
    costs: 1,
    // The plant's day: its two powers in one read, its six energies in another (ADR 9).
    [`devices/${PLANT}/history`]: 1,
    [`devices/${PLANT}/statistics`]: 1,
    // The inverter's PV forecast and the spot prices.
    "devices/1/forecasts": 1,
    [`devices/${SPOT}/forecasts`]: 1,
    // The weather now, once for the scene's sky and the day alike, every role in one read a source.
    [`devices/${WEATHER}/history`]: 1,
    [`devices/${WEATHER}/forecasts`]: 1,
  };

  await sceneMayMount();
  await settled(() => urls.length);

  expect(tally(urls)).toEqual(reads);
});

test("History opened from the dashboard reads nothing the dashboard already read", async () => {
  const context = coreContext(
    connect({
      base: `${location.origin}/`,
      fetch: (request) => fake(request) ?? Promise.resolve(answer("")),
    }),
  );

  const dashboard = await render(Home, { context });

  await expect.element(dashboard.getByRole("group", { name: "Heute" })).toBeVisible();
  await sceneMayMount();
  await settled(() => urls.length);
  expect(tally(urls)).toMatchObject({ capabilities: 1, "module-types": 1 });
  await dashboard.unmount();
  urls.length = 0;

  const screen = await render(History, { context });

  await expect.element(screen.getByRole("heading", { name: "Verlauf" })).toBeVisible();
  await settled(() => urls.length);

  // The range's figures alone: the layout, capabilities and module types are known already.
  expect(tally(urls)).toEqual({
    records: 1,
    payback: 1,
    corrections: 1,
    costs: 2,
    [`devices/${PLANT}/history`]: 2,
    // The flows by day and by hour, each one read of every flow.
    [`devices/${PLANT}/statistics`]: 2,
  });
});

test("a dashboard minute reads only today's energies and money", async () => {
  fakeClock(["setInterval", "clearInterval", "Date"], Date.parse("2026-11-12T10:01:30Z"));

  const core = connect({
    base: `${location.origin}/`,
    fetch: (request) => fake(request) ?? Promise.resolve(answer("")),
  });

  const screen = await render(Dashboard, { core, layout: null, admin: true });

  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();
  await settled(() => urls.length);
  urls.length = 0;

  vi.advanceTimersByTime(60_000);
  await settled(() => urls.length);

  expect(tally(urls)).toEqual({ [`devices/${PLANT}/statistics`]: 1, costs: 1 });
});
