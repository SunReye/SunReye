// The detail sheet's component tests share one fake core: a plant at midday, its stream and day.
import { vi } from "vitest";
import { cdp, page } from "vitest/browser";
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
}

export const served: Served = { live: LIVE, stale: undefined, tick: false };

const IMPORTING = { [PLANT]: { "grid.power": 800 } };

/** One server-sent event of the live stream. */
function event(name: string, data: Readonly<{ devices: object; stale?: object }>) {
  return new TextEncoder().encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
}

function stream(): Response {
  const frame = { devices: served.live, ...(served.stale && { stale: served.stale }) };

  return new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(event("snapshot", frame));

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

const slot = (hour: number, value: number) => ({
  issued: "2026-11-11T13:00:00Z",
  target: `2026-11-12T${String(hour).padStart(2, "0")}:00:00Z`,
  value,
});

function answer(href: string): Response {
  const { pathname } = new URL(href);

  switch (pathname) {
    case "/api/v1/live":
      return stream();
    case "/api/v1/timezone":
      return Response.json({ name: "UTC" });
    case "/api/v1/layout":
      return Response.json({ appliesFrom: "2026-11-01T00:00:00Z", strings: STRINGS, warnings: [] });
    case "/api/v1/capabilities":
      return Response.json({
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
      });
    case `/api/v1/devices/${SPOT}/forecasts`:
      return Response.json({ points: [slot(0, 0.12), slot(12, 0.061), slot(13, -0.01)] });
    case "/api/v1/devices":
      return Response.json({ status: 403, code: "auth.forbidden" }, { status: 403 });
    case "/api/v1/costs":
      return Response.json({ days: [], total: { paid: 0.32, earned: 0.33, saved: 2.1 } });
    default:
      return Response.json({ points: [] });
  }
}

const transport: Transport = {
  base: "http://core.test/",
  fetch: (request) => Promise.resolve(answer(request.url)),
};

/** Midday at 12:20, reduced motion, a desktop viewport. */
export async function setup() {
  served.live = LIVE;
  served.stale = undefined;
  served.tick = false;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T12:20:00Z") });
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await page.viewport(1280, 800);
}

export async function teardown() {
  vi.useRealTimers();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
}

export async function show(detail: string | null = null) {
  const onopen = vi.fn<(id: string) => void>();
  const onclose = vi.fn<() => void>();

  const screen = await render(Dashboard, {
    core: connect(transport),
    layout: null,
    admin: false,
    detail,
    onopen,
    onclose,
  });

  return { screen, onopen, onclose };
}
