// The Explore screen tests' fake core: a plant in UTC with its series catalog.
import { createRawSnippet, mount, unmount } from "svelte";
import { render } from "vitest-browser-svelte";
import { PLANT, WEATHER } from "../api/computed-devices.ts";
import {
  connect,
  type CatalogDevice,
  type History,
  type Statistics,
  type Transport,
} from "../api/core.ts";
import Shell from "../shell/Shell.svelte";
import ExploreScreen from "./ExploreScreen.svelte";

const SPAN = { first: "2026-01-01T00:00:00Z", last: "2026-11-15T12:00:00Z" };

const measured = (series: string, unit: string, estimated = false) =>
  ({ series, unit, kind: "measurement", estimated, ...SPAN }) as const;

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
      measured("pv.string.power[1]", "W", true),
      measured("extra.fan", "none"),
      measured("grid.voltage", "V"),
      { series: "pv.energy.total", unit: "kWh", kind: "counter", estimated: false, ...SPAN },
      { series: "inverter.status", unit: null, kind: "status", estimated: false, ...SPAN },
    ],
  },
  { id: 5, name: "Alter Speicher", removed: true, series: [measured("battery.soc", "%")] },
  { id: WEATHER, name: null, removed: false, series: [measured("weather.ghi", "W/m²")] },
];

/** A series read as the core was asked for it. */
interface Asked {
  readonly read: "history" | "statistics";
  readonly device: number;
  readonly series: string;
  readonly from: number;
  readonly to: number;
  readonly period: string | null;
}

const iso = (t: number) => new Date(t).toISOString();

/** 100 over the first half of the span, 300 over the second. */
function halves({ from, to }: Asked): History {
  const mid = (from + to) / 2;

  return {
    tier: "raw",
    points: [
      { start: iso(from), end: iso(mid), mean: 100 },
      { start: iso(mid), end: iso(to), mean: 300 },
    ],
  };
}

const HOUR = 3_600_000;

/** Every hour or day of the span: a mean of 200 between 150 and 250, a delta of 2. */
function figures({ from, to, period }: Asked): Statistics {
  const step = period === "hour" ? HOUR : 24 * HOUR;
  const points = [];

  for (let t = from; t < to; t += step)
    points.push({
      date: iso(t).slice(0, 10),
      start: iso(t),
      end: iso(t + step),
      mean: 200,
      min: 150,
      max: 250,
      delta: 2,
    });

  return { period: period === "hour" ? "hour" : "day", points };
}

/**
 * `broken`: the core refuses the catalog. `offline`: no request reaches it. `history` and
 * `statistics` answer the series reads, and `asked` lists them.
 */
export const plant = {
  broken: false,
  offline: false,
  history: halves,
  statistics: figures,
  asked: new Array<Asked>(),
};

export function reset(): void {
  plant.broken = false;
  plant.offline = false;
  plant.history = halves;
  plant.statistics = figures;
  plant.asked = [];
}

/** A device's history or statistics read, as its address asks for it. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
function askedOf(url: URL): Asked | null {
  const [, device, read] = /devices\/(\d+)\/(history|statistics)$/u.exec(url.pathname) ?? [];
  const q = url.searchParams;

  if (read !== "history" && read !== "statistics") return null;

  return {
    read,
    device: Number(device),
    series: q.get("series") ?? "",
    from: Date.parse(q.get("from") ?? ""),
    to: Date.parse(q.get("to") ?? ""),
    period: q.get("period"),
  };
}

function transport(): Transport {
  return {
    base: "http://core.test/",
    fetch: (request) => {
      const read = new URL(request.url).pathname.split("/").at(-1);

      if (plant.offline && read !== "timezone") return Promise.reject(new TypeError("network"));

      if (read === "timezone") return Promise.resolve(Response.json({ name: "UTC" }));

      if (read === "series" && !plant.broken)
        return Promise.resolve(Response.json({ devices: DEVICES }));

      const asked = askedOf(new URL(request.url));

      if (asked) {
        plant.asked.push(asked);

        return Promise.resolve(Response.json(plant[asked.read](asked)));
      }

      return Promise.resolve(Response.json({ status: 404, code: "not.found" }, { status: 404 }));
    },
  };
}

type Patch = Readonly<Record<string, string | null>>;

/**
 * The screen at `query`, every route change it makes, and its history: each entry's query, the
 * last the one shown, as the router would keep them.
 */
export async function show(query = "") {
  const went: Readonly<{ patch: Patch; push: boolean }>[] = [];
  const entries = [new URLSearchParams(query)];

  const screen = await render(ExploreScreen, {
    core: connect(transport()),
    params: entries[0]!,
    go: (patch: Patch, push: boolean) => {
      went.push({ patch, push });

      const next = new URLSearchParams(entries.at(-1));

      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }

      if (push) entries.push(next);
      else entries[entries.length - 1] = next;

      void screen.rerender({ params: next });
    },
    back: () => {
      entries.pop();

      void screen.rerender({ params: entries.at(-1) ?? new URLSearchParams() });
    },
  });

  return { screen, went, entries };
}

/** The screen inside the shell's bar or rail, as the app lays it out. */
export function showIn(shell: "bar" | "rail") {
  const children = createRawSnippet(() => ({
    render: () => "<div></div>",
    setup: (target) => {
      const screen = mount(ExploreScreen, {
        target,
        props: {
          core: connect(transport()),
          params: new URLSearchParams(),
          go: () => {},
          back: () => {},
        },
      });

      return () => void unmount(screen);
    },
  }));

  return render(Shell, {
    shell,
    current: "/explore",
    admin: false,
    goto: () => Promise.resolve(),
    children,
  });
}
