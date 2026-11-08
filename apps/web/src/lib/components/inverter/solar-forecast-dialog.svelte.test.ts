import createClient from "openapi-fetch";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import type { paths } from "$lib/core-api.gen";

// The dialog's measured-day figures come from the core's REST surface. A real openapi-fetch
// client with a fake `fetch` stands in for the core, so what is asserted is the request the
// dialog made (path and query) and what it drew from the answer.

type Hit = { path: string; query: Record<string, string> };
const hits: Hit[] = [];
let answer: (hit: Hit) => Response = () => json([]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

vi.mock("$env/dynamic/public", () => ({ env: {} }));
vi.mock("$lib/source.svelte", () => ({ source: { query: { source: "plant" } } }));
const store = { allMetrics: [] as { key: string; role?: string }[] };
vi.mock("$lib/inverter/store.svelte", () => ({ inverter: store }));
vi.mock("$lib/core-api", () => ({
  core: createClient<paths>({
    baseUrl: "http://core.test",
    fetch: async (request) => {
      const url = new URL(request.url);
      const hit = { path: url.pathname, query: Object.fromEntries(url.searchParams) };
      hits.push(hit);
      return answer(hit);
    },
  }),
}));

const { default: Fixture } = await import("./solar-forecast-dialog.fixture.svelte");

/** Local clock time today as an instant, whatever zone the browser runs in. */
const today = (hours: number, minutes = 0) => new Date(2026, 10, 7, hours, minutes).toISOString();

beforeEach(() => {
  hits.length = 0;
  answer = () => json([]);
  store.allMetrics = [];
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 7, 12, 30) });
});
afterEach(() => vi.useRealTimers());

async function openDialog() {
  render(Fixture);
  await page.getByRole("button", { name: "Forecast" }).click();
}

test("with a PV power metric, today's minute rollups come from the core and are integrated", async () => {
  store.allMetrics = [{ key: "pv_power", role: "pv.total.power" }];
  answer = () =>
    json([
      { time: today(10, 0), avg: 3000, min: 2900, max: 3500 },
      { time: today(10, 1), avg: 3000, min: 2900, max: 3600 },
    ]);

  await openDialog();

  // 3 kW over the 10:00 slot at a 60 minute step is 3 kWh, out of 13 elapsed slots.
  await expect.element(page.getByText(/^3 kWh/)).toBeVisible();
  const rollup = hits.find((h) => h.path === "/api/history/rollup");
  expect(rollup?.query).toMatchObject({
    metric: "pv_power",
    bucket: "minute",
    limit: "1600",
    source: "plant",
    from: today(0),
    to: today(12, 30),
  });
  expect(hits.some((h) => h.path === "/api/energy/series")).toBe(false);
});

test("without a PV power metric, today's hourly energy comes from the core", async () => {
  answer = () =>
    json([
      { bucket: "2026-11-07T10", productionKwh: 2 },
      { bucket: "2026-11-07T11", productionKwh: 1 },
    ]);

  await openDialog();

  await expect.element(page.getByText(/^3 kWh/)).toBeVisible();
  const series = hits.find((h) => h.path === "/api/energy/series");
  expect(series?.query).toMatchObject({
    bucket: "hour",
    source: "plant",
    from: today(0),
    to: today(12, 30),
  });
  expect(hits.some((h) => h.path === "/api/history/rollup")).toBe(false);
});

test("a core that refuses the read leaves the Actual tile at zero instead of throwing", async () => {
  store.allMetrics = [{ key: "pv_power", role: "pv.total.power" }];
  answer = () => json({ error: "nope" }, 500);

  await openDialog();

  await vi.waitFor(() => expect(hits.some((h) => h.path === "/api/history/rollup")).toBe(true));
  await expect.element(page.getByText(/^0 kWh/)).toBeVisible();
});

// An unreachable core makes `fetch` itself reject (no response at all), which is a different
// failure from a 500: openapi-fetch rethrows it, so only the dialog's own catch keeps it quiet.
// The tile reads 0 either way, so the proof is that no rejection escapes the dialog.
test.each([
  ["rollup", [{ key: "pv_power", role: "pv.total.power" }], "/api/history/rollup"],
  ["hourly energy", [], "/api/energy/series"],
])(
  "an unreachable core on the %s read leaves the Actual tile at zero",
  async (_name, metrics, path) => {
    store.allMetrics = metrics;
    answer = () => {
      throw new TypeError("Failed to fetch");
    };
    const escaped: unknown[] = [];
    const onRejection = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      escaped.push(e.reason);
    };
    window.addEventListener("unhandledrejection", onRejection);

    try {
      await openDialog();
      await vi.waitFor(() => expect(hits.some((h) => h.path === path)).toBe(true));
      await expect.element(page.getByText(/^0 kWh/)).toBeVisible();
    } finally {
      window.removeEventListener("unhandledrejection", onRejection);
    }
    expect(escaped).toEqual([]);
  },
);

test("an empty payload from the core leaves the Actual tile at zero", async () => {
  store.allMetrics = [{ key: "pv_power", role: "pv.total.power" }];
  answer = () => json([]);

  await openDialog();

  await vi.waitFor(() => expect(hits.some((h) => h.path === "/api/history/rollup")).toBe(true));
  await expect.element(page.getByText(/^0 kWh/)).toBeVisible();
});
