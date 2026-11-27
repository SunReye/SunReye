// The detail sheet tests' fake core and dashboard (ADR 21).
import { cdp, page } from "vitest/browser";
import { vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "../api/core.ts";
import { eachAnswer, json, type Schema } from "../api/core.harness.ts";
import { turn } from "../api/settled.harness.ts";
import { merge } from "../api/frames.ts";
import Dashboard from "../dashboard/Dashboard.svelte";
import { feed } from "../live/stream.harness.ts";
import {
  capabilities,
  CORRECTIONS,
  INVERTER,
  INVERTER_PLAN,
  NO_COSTS,
  PLANT,
  SPOT_PRICES,
  statistics,
  TOPOLOGY,
} from "./detail.fixtures.ts";

export { INVERTER, PLANT, rollup } from "./detail.fixtures.ts";

const SPOT = "4294967292";
export const TARIFF = "4294967293";
export const BATTERY = "2";

/** Midday: the plant's totals, an inverter with two inputs and a battery. */
export const LIVE = {
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
  live: Readonly<Record<string, Readonly<Record<string, number>>>>;
  stale: Readonly<Record<string, Readonly<Record<string, number>>>> | undefined;
  /** A second frame, a second after the snapshot: the plant importing. */
  tick: boolean;
  /** The stream breaks after its snapshot and the core is not heard from again. */
  breaks: boolean;
  /** The core refuses the stream outright. */
  refuses: boolean;
  /** Per device, the series with stored history (ADR 22). */
  stored: Readonly<Record<string, readonly string[]>>;
  /** When every stored series stored its last point. */
  last: string;
  /** Answers a statistics read before the defaults do; undefined passes it on. */
  rolled: ((read: Asked) => Response | Promise<Response> | undefined) | null;
  /** Answers a costs read from `from` to before `to`, RFC 3339; null for none. */
  costs: ((from: string, to: string) => Response | Promise<Response>) | null;
  /** The payback the admin reads (ADR 12); null for a refusal. */
  payback: Schema<"Payback"> | null;
  /** The series the inverter's profile publishes. */
  publishes: readonly string[];
  /** Answers the inverter's forecasts in place of its plan; null for the plan. */
  forecasts: (() => Response | Promise<Response>) | null;
  /** Answers the module types in place of the one served; null for it. */
  types: (() => Response) | null;
}

export const served: Served = {
  live: LIVE,
  stale: undefined,
  tick: false,
  breaks: false,
  refuses: false,
  stored: {},
  last: "2026-11-12T12:00:00Z",
  rolled: null,
  costs: null,
  payback: null,
  publishes: [],
  forecasts: null,
  types: null,
};

/** The series catalog: each stored series a measurement since the month began. */
function catalog(): Response {
  const devices = Object.keys(served.stored).map((id): Schema<"CatalogDevice"> => ({
    id: Number(id),
    name: null,
    removed: false,
    series: (served.stored[id] ?? []).map((series) => ({
      series,
      kind: "measurement",
      estimated: false,
      first: "2026-11-01T00:00:00Z",
      last: served.last,
    })),
  }));

  return json("SeriesCatalog", { devices });
}

const IMPORTING = { [PLANT]: { "grid.power": 800 } };

/** One statistics request: device, series, its window and the period it is cut in. */
export type Asked = Readonly<Record<"device" | "series" | "from" | "to" | "period", string>>;

/** Each series of each statistics request. */
export const asked: Asked[] = [];

/** Each other request, a range read's once a series, as
 * `/api/v1/devices/4294967295/history weather.code 2026-11-12T00:00:00.000Z`. */
export const fetched: string[] = [];

/** Each request's path, once a request. */
export const requested: string[] = [];

/** Runs `then` once the page has taken its turn: after what it was sent before. */
async function later(then: () => void): Promise<void> {
  await turn();
  then();
}

/** Feeds the stream the served frame, folded as the core's stream folds it (ADR 9). */
function streamed(): void {
  const send = feed();

  if (served.refuses) {
    send({ problem: "auth.forbidden" });

    return;
  }

  const frame = { devices: served.live, ...(served.stale && { stale: served.stale }) };
  const first = merge(undefined, frame, Date.now());

  send(first);

  // The stream breaks; the reconnect finds no core.
  if (served.breaks)
    void later(() => {
      send({ ...first, lost: Date.now() });
    });

  if (served.tick)
    void later(() => {
      vi.setSystemTime(Date.now() + 1000);
      send(merge(first, { devices: IMPORTING }, Date.now()));
    });
}

const plan = () => Response.json(INVERTER_PLAN);

const MODULE_TYPES = { moduleTypes: [{ id: 1, name: "M", pmax: 300 }] };

/** Each path but statistics', and what the fake core answers there to query `q`. */
const ROUTES = new Map<string, (q: Readonly<URLSearchParams>) => Response | Promise<Response>>([
  ["/api/v1/topology", () => json("Topology", TOPOLOGY)],
  ["/api/v1/series", catalog],
  ["/api/v1/timezone", () => json("Zone", { name: "UTC" })],
  [
    "/api/v1/layout",
    () => json("Layout", { appliesFrom: "2026-11-01T00:00:00Z", strings: STRINGS, warnings: [] }),
  ],
  ["/api/v1/capabilities", () => json("Support", capabilities(served.publishes))],
  [`/api/v1/devices/${SPOT}/forecasts`, () => Response.json(SPOT_PRICES)],
  [`/api/v1/devices/${INVERTER}/forecasts`, () => served.forecasts?.() ?? plan()],
  [
    "/api/v1/devices",
    () => Response.json({ status: 403, code: "auth.forbidden" }, { status: 403 }),
  ],
  ["/api/v1/module-types", () => served.types?.() ?? Response.json(MODULE_TYPES)],
  ["/api/v1/corrections", () => json("CorrectionList", CORRECTIONS)],
  [
    "/api/v1/costs",
    (q) => served.costs?.(q.get("from") ?? "", q.get("to") ?? "") ?? json("CostDays", NO_COSTS),
  ],
  [
    "/api/v1/payback",
    () =>
      served.payback === null
        ? Response.json({ status: 403, code: "auth.forbidden" }, { status: 403 })
        : json("Payback", served.payback),
  ],
]);

/** A statistics request's device, series, window and period, read from its URL. */
function askedOf(device: string, series: string, q: Readonly<URLSearchParams>): Asked {
  const field = (name: string) => q.get(name) ?? "";

  return { device, series, from: field("from"), to: field("to"), period: field("period") };
}

function answer(href: string): Response | Promise<Response> {
  const { pathname, searchParams: q } = new URL(href);
  const series = q.getAll("series");

  requested.push(pathname);

  const read = /^\/api\/v1\/devices\/(\d+)\/statistics$/u.exec(pathname);

  if (read)
    return eachAnswer(series, (name) => {
      const one = askedOf(read[1]!, name, q);

      asked.push(one);

      return served.rolled?.(one) ?? statistics(one.device, one.series, one.from);
    });

  const route = ROUTES.get(pathname) ?? (() => Response.json({ points: [] }));

  if (!/\/(?:history|forecasts)$/u.test(pathname)) {
    fetched.push(`${pathname}  ${q.get("from") ?? ""}`);

    return route(q);
  }

  return eachAnswer(series, (name) => {
    fetched.push(`${pathname} ${name} ${q.get("from") ?? ""}`);

    return route(q);
  });
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
  requested.length = 0;
  served.tick = false;
  served.breaks = false;
  served.refuses = false;
  served.stored = {};
  served.rolled = null;
  served.costs = null;
  served.payback = null;
  served.publishes = [];
  served.forecasts = null;
  served.types = null;
  served.last = "2026-11-12T12:00:00Z";
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

/** The dashboard with sheet `detail` open, its hash route's query `route`, to a viewer or the admin. */
export async function show(detail: string | null = null, route = "", admin = false) {
  const onopen = vi.fn<(id: string) => void>();
  const onclose = vi.fn<() => void>();

  streamed();

  const screen = await render(Dashboard, {
    core: connect(transport),
    layout: null,
    admin,
    detail,
    onopen,
    onclose,
    params: new URLSearchParams(route),
    go: () => {},
  });

  return { screen, onopen, onclose };
}
