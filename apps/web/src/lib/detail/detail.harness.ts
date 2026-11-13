// The detail sheet tests' fake core and dashboard (ADR 21).
import { cdp, page } from "vitest/browser";
import { vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import Dashboard from "../dashboard/Dashboard.svelte";

const PLANT = "4294967294";
const SPOT = "4294967292";
const INVERTER = "1";
export const BATTERY = "2";

/** Midday: the plant's totals, an inverter with two inputs and a battery. */
const LIVE = {
  [PLANT]: { "pv.power": 4200, "load.power": 900, "grid.power": -3300, "battery.power": 0 },
  [SPOT]: { "price.spot": 0.061 },
  [INVERTER]: {
    "pv.power": 4200,
    "inverter.power": 4100,
    "inverter.status": 1,
    "pv.mppt.power[1]": 2500,
    "pv.mppt.power[2]": 1700,
    "pv.string.power[1]": 1500,
    "pv.string.power[2]": 1000,
  },
  [BATTERY]: { "battery.power": 0, "battery.soc": 64, "battery.cycles": 412 },
};

const WIRING = { device: 1, input: 1, azimuth: 0, tilt: 30, loss: 0, moduleType: 1, modules: 10 };

const STRINGS = [
  { id: 1, name: "Süd", optimized: 0, ...WIRING },
  { id: 2, name: "Nord", optimized: 0, ...WIRING },
];

/** What the core streams: the live values, and each stale value's age in seconds. */
export interface Served {
  live: typeof LIVE;
  stale: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined;
  /** A second frame, a second after the snapshot: the plant importing. */
  tick: boolean;
  /** The stream breaks after its snapshot and the core is not heard from again. */
  breaks: boolean;
}

export const served: Served = { live: LIVE, stale: undefined, tick: false, breaks: false };

const IMPORTING = { [PLANT]: { "grid.power": 800 } };

/** One server-sent event of the live stream. */
function event(name: string, data: Readonly<{ devices: object; stale?: object }>) {
  return new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Each statistics request: device, series and its window. */
export const asked: Readonly<{ device: string; series: string; from: string; to: string }>[] = [];

/** String 1 made 12 kWh in the range, string 2 3 kWh: one rollup each. */
function statistics(device: string, series: string | null, from: string): Response {
  const watts = { "pv.string.power[1]": 12_000, "pv.string.power[2]": 3000 }[series ?? ""];
  const at = Date.parse(from) + 10 * 3_600_000;

  if (device !== INVERTER || watts === undefined)
    return Response.json({ points: [], period: "hour" });

  const [start, end] = [new Date(at).toISOString(), new Date(at + 3_600_000).toISOString()];
  const point = { date: from.slice(0, 10), start, end, mean: watts, integral: watts, hours: 1 };

  return Response.json({ points: [point], period: "hour" });
}

function stream(): Response {
  const frame = { devices: served.live, ...(served.stale && { stale: served.stale }) };

  return new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(event("snapshot", frame));

        if (served.breaks) {
          // The reconnect finds no core.
          ROUTES.set("/api/v1/live", () => {
            throw new TypeError("offline");
          });
          setTimeout(() => {
            controller.error(new TypeError("network"));
          }, 50);
        }

        if (served.tick) {
          setTimeout(() => {
            vi.setSystemTime(Date.now() + 1000);
            controller.enqueue(event("change", { devices: IMPORTING }));
          }, 50);
        }
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

const slot = (hour: number, value: number, minute = 0) => ({
  issued: "2026-11-11T13:00:00Z",
  target: `2026-11-12T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
  value,
});

/** Input 1 runs 15 % under its model lately. */
const CORRECTIONS = {
  inputs: [
    {
      device: 1,
      input: 1,
      factors: [{ month: 11, hour: 10, factor: 0.85 }],
      recent: { measured: 85, modelled: 100 },
    },
  ],
};

/** Both strings share input 1, so both are estimated. */
const CAPABILITIES = {
  capabilities: [],
  schema: {},
  transports: [],
  version: "5",
  devices: {
    [INVERTER]: {
      series: [],
      settings: [],
      writes: false,
      estimated: ["pv.string.power[1]", "pv.string.power[2]"],
    },
  },
};

/** Each path but statistics', and what the fake core answers there. */
const ROUTES = new Map<string, () => Response>([
  ["/api/v1/live", stream],
  ["/api/v1/timezone", () => Response.json({ name: "UTC" })],
  [
    "/api/v1/layout",
    () => Response.json({ appliesFrom: "2026-11-01T00:00:00Z", strings: STRINGS, warnings: [] }),
  ],
  ["/api/v1/capabilities", () => Response.json(CAPABILITIES)],
  [
    `/api/v1/devices/${SPOT}/forecasts`,
    () =>
      Response.json({
        points: [slot(0, 0.12), slot(12, 0.125), slot(12, 0.0625, 30), slot(13, -0.01)],
      }),
  ],
  // The inverter expects 2 kW from 10:00 to 14:00: 8 kWh, half of it still to come.
  [
    `/api/v1/devices/${INVERTER}/forecasts`,
    () => Response.json({ points: [10, 11, 12, 13].map((h) => slot(h, 2000)) }),
  ],
  [
    "/api/v1/devices",
    () => Response.json({ status: 403, code: "auth.forbidden" }, { status: 403 }),
  ],
  ["/api/v1/module-types", () => Response.json({ moduleTypes: [{ id: 1, name: "M", pmax: 300 }] })],
  ["/api/v1/corrections", () => Response.json(CORRECTIONS)],
  [
    "/api/v1/costs",
    () => Response.json({ days: [], total: { paid: 0.32, earned: 0.33, saved: 2.1 } }),
  ],
]);

function answer(href: string): Response {
  const { pathname, searchParams: q } = new URL(href);
  const read = /^\/api\/v1\/devices\/(\d+)\/statistics$/u.exec(pathname);

  if (read) {
    const [device, series] = [read[1]!, q.get("series") ?? ""];

    asked.push({ device, series, from: q.get("from") ?? "", to: q.get("to") ?? "" });

    return statistics(device, series, q.get("from") ?? "");
  }

  return (ROUTES.get(pathname) ?? (() => Response.json({ points: [] })))();
}

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => Promise.resolve(answer(request.url)),
};

/** Before each test: the served values, a fixed clock at 12:20, reduced motion, a desktop. */
export async function prepare(): Promise<void> {
  served.live = LIVE;
  served.stale = undefined;
  asked.length = 0;
  served.tick = false;
  served.breaks = false;
  ROUTES.set("/api/v1/live", stream);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T12:20:00Z") });
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await page.viewport(1280, 800);
}

/** After each test. */
export async function restore(): Promise<void> {
  vi.useRealTimers();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
}

/** The dashboard with sheet `detail` open, its hash route's query `route`. */
export async function show(detail: string | null = null, route = "") {
  const onopen = vi.fn<(id: string) => void>();
  const onclose = vi.fn<() => void>();

  const screen = await render(Dashboard, {
    core: connect(transport),
    layout: null,
    admin: false,
    detail,
    onopen,
    onclose,
    params: new URLSearchParams(route),
    go: () => {},
  });

  return { screen, onopen, onclose };
}
