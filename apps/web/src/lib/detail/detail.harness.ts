// The detail sheet tests' fake core and dashboard (ADR 21).
import { cdp, page } from "vitest/browser";
import { vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import Dashboard from "../dashboard/Dashboard.svelte";

export const PLANT = "4294967294";
const SPOT = "4294967292";
export const INVERTER = "1";
export const BATTERY = "2";

/** Midday: the plant's totals, an inverter with two inputs and a battery. */
const LIVE = {
  [PLANT]: {
    "pv.power": 4200,
    "load.power": 900,
    "grid.power": -3300,
    "battery.power": 0,
    "point.power[1]": 300,
    "point.power[2]": 600,
  },
  [SPOT]: { "price.spot": 0.061 },
  [INVERTER]: {
    "pv.power": 4200,
    "load.power": 900,
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
  /** Per device, the series with stored history (ADR 22). */
  stored: Readonly<Record<string, readonly string[]>>;
  /** When every stored series stored its last point. */
  last: string;
  /** Answers a statistics read before the defaults do; undefined passes it on. */
  rolled: ((read: Asked) => Response | Promise<Response> | undefined) | null;
}

export const served: Served = {
  live: LIVE,
  stale: undefined,
  tick: false,
  breaks: false,
  stored: {},
  last: "2026-11-12T12:00:00Z",
  rolled: null,
};

/** The series catalog: each stored series a measurement since the month began. */
function catalog(): Response {
  const devices = Object.keys(served.stored).map((id) => ({
    id: Number(id),
    name: null,
    removed: false,
    series: (served.stored[id] ?? []).map((series) => ({
      series,
      kind: "measurement",
      first: "2026-11-01T00:00:00Z",
      last: served.last,
    })),
  }));

  return Response.json({ devices });
}

const IMPORTING = { [PLANT]: { "grid.power": 800 } };

/** One server-sent event of the live stream. */
function event(name: string, data: Readonly<{ devices: object; stale?: object }>) {
  return new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** One statistics request: device, series, its window and the period it is cut in. */
export type Asked = Readonly<Record<"device" | "series" | "from" | "to" | "period", string>>;

/** Each statistics request. */
export const asked: Asked[] = [];

/** Each other request, as `/api/v1/devices/4294967295/history weather.code 2026-11-12T00:00:00.000Z`. */
export const fetched: string[] = [];

/** One hourly rollup of `watts` from `at`, in ms since the epoch. */
export function rollup(at: number, watts: number) {
  const [start, end] = [new Date(at).toISOString(), new Date(at + 3_600_000).toISOString()];

  return { date: start.slice(0, 10), start, end, mean: watts, integral: watts, hours: 1 };
}

/** The plant's battery discharged 2 kWh at 08:00 and charged 3 kWh at 10:00. */
function battery(from: string): Response {
  const at = (h: number) => Date.parse(from) + h * 3_600_000;

  return Response.json({ points: [rollup(at(8), -2000), rollup(at(10), 3000)], period: "hour" });
}

/** String 1 made 12 kWh in the range, string 2 3 kWh: one rollup each. */
function statistics(device: string, series: string | null, from: string): Response {
  if (device === PLANT && series === "battery.power") return battery(from);

  const watts = { "pv.string.power[1]": 12_000, "pv.string.power[2]": 3000 }[series ?? ""];
  const at = Date.parse(from) + 10 * 3_600_000;

  if (device !== INVERTER || watts === undefined)
    return Response.json({ points: [], period: "hour" });

  return Response.json({ points: [rollup(at, watts)], period: "hour" });
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

/** The grid connection and a heat pump below it, which a viewer reads too (ADR 9). */
const TOPOLOGY = {
  appliesFrom: "2026-11-01T00:00:00Z",
  points: [
    { id: 1, name: "Netz", parent: null, contested: false, claims: [] },
    { id: 2, name: "Wärmepumpe", parent: 1, contested: false, claims: [] },
  ],
};

/** Each path but statistics', and what the fake core answers there. */
const ROUTES = new Map<string, () => Response>([
  ["/api/v1/topology", () => Response.json(TOPOLOGY)],
  ["/api/v1/live", stream],
  ["/api/v1/series", catalog],
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

function answer(href: string): Response | Promise<Response> {
  const { pathname, searchParams: q } = new URL(href);

  const read = /^\/api\/v1\/devices\/(\d+)\/statistics$/u.exec(pathname);

  if (read) {
    const [device, series] = [read[1]!, q.get("series") ?? ""];
    const [from, to, period] = [q.get("from") ?? "", q.get("to") ?? "", q.get("period") ?? ""];
    const one = { device, series, from, to, period };

    asked.push(one);

    return served.rolled?.(one) ?? statistics(device, series, from);
  }

  fetched.push(`${pathname} ${q.get("series") ?? ""} ${q.get("from") ?? ""}`);

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
  fetched.length = 0;
  served.tick = false;
  served.breaks = false;
  served.stored = {};
  served.rolled = null;
  served.last = "2026-11-12T12:00:00Z";
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
