// What each dashboard figure's detail sheet leads with (ADR 21). Pure.
import type { Day } from "../dashboard/day.ts";
import { current } from "../dashboard/now.ts";
import { m } from "../paraglide/messages.js";

/** A day figure: one of today's energies. */
export type Today = "production" | "consumption" | "feedIn" | "purchase";

export interface Figure {
  readonly colour: string;
  /** The node whose live power the sheet shows and whose readings it lists. */
  readonly node: string | null;
  /** A signed power: which words say its direction. */
  readonly direction?: "battery" | "grid";
  /** The live graph fills around zero: the colour above, then below (ADR 21). */
  readonly diverging?: readonly [string, string];
  /** Today's energy the sheet leads with, before the live power. */
  readonly today?: Today;
  readonly chart: "pv" | "price" | null;
}

const SOLAR = "var(--e-solar)";
const HOUSE = "var(--e-house)";
const GRID = ["var(--e-import)", "var(--e-export)"] as const;
const EV: Figure = { colour: "var(--e-ev)", node: "ev", chart: null };

const FIGURES = new Map<string, Figure>([
  ["production", { colour: SOLAR, node: "pv", today: "production", chart: "pv" }],
  ["consumption", { colour: HOUSE, node: "house", today: "consumption", chart: null }],
  [
    "feedIn",
    {
      colour: "var(--e-export)",
      node: "grid",
      direction: "grid",
      diverging: GRID,
      today: "feedIn",
      chart: null,
    },
  ],
  [
    "purchase",
    {
      colour: "var(--e-import)",
      node: "grid",
      direction: "grid",
      diverging: GRID,
      today: "purchase",
      chart: null,
    },
  ],
  ["autarky", { colour: "var(--e-battery)", node: null, chart: null }],
  ["saved", { colour: SOLAR, node: null, chart: null }],
  ["price", { colour: HOUSE, node: null, chart: "price" }],
  ["forecast", { colour: SOLAR, node: null, chart: "pv" }],
  ["weather", { colour: SOLAR, node: null, chart: null }],
  ["pv", { colour: SOLAR, node: "pv", chart: "pv" }],
  ["inverter", { colour: SOLAR, node: "inverter", chart: null }],
  [
    "battery",
    {
      colour: "var(--e-battery)",
      node: "battery",
      direction: "battery",
      diverging: ["var(--e-battery)", "var(--e-battery)"],
      chart: null,
    },
  ],
  [
    "grid",
    { colour: "var(--e-export)", node: "grid", direction: "grid", diverging: GRID, chart: null },
  ],
  ["house", { colour: HOUSE, node: "house", chart: null }],
  ["ev", EV],
  ["generator", { colour: HOUSE, node: "generator", chart: null }],
]);

/** The figure `id` names: a fixed one, `string-<id>` or `ev-<device>`; null for none. */
export function figure(id: string): Figure | null {
  if (/^string-\d+$/u.test(id)) return { colour: SOLAR, node: id, chart: null };

  if (/^ev-\d+$/u.test(id)) return { ...EV, node: id };

  return FIGURES.get(id) ?? null;
}

/** The title of a fixed figure; a string's and a loadpoint's are their names. */
const TITLES = new Map([
  ["production", m.dash_made],
  ["consumption", m.dash_used],
  ["feedIn", m.dash_grid_export],
  ["purchase", m.dash_grid_import],
  ["autarky", m.detail_autarky],
  ["saved", m.detail_saved],
  ["price", m.dash_spot],
  ["forecast", m.detail_forecast],
  ["weather", m.dash_weather],
  ["pv", m.detail_pv],
  ["inverter", m.detail_inverter],
  ["battery", m.dash_battery],
  ["grid", m.detail_grid],
  ["house", m.dash_house],
  ["ev", m.dash_ev],
  ["generator", m.flow_generator],
]);

/**
 * The sheet title of figure `id`: a string's and a loadpoint's are their names.
 * @param strings the layout's strings
 * @param device a device's name, which only the admin may list (ADR 9)
 */
export function titleOf(
  id: string,
  strings: readonly Readonly<{ id: number; name: string }>[],
  device: (id: number) => string | undefined,
): string {
  const string = /^string-(\d+)$/u.exec(id);
  const loadpoint = /^ev-(\d+)$/u.exec(id);

  if (string) return strings.find((s) => s.id === Number(string[1]))?.name ?? m.detail_pv();

  if (loadpoint) return device(Number(loadpoint[1])) ?? m.dash_ev();

  return TITLES.get(id)?.() ?? "";
}

/** One figure: a number in its unit, unknown as null, or words. */
export type Fact =
  | {
      readonly label: string;
      readonly value: number | null;
      readonly unit: string;
      readonly digits: number;
    }
  | { readonly label: string; readonly text: string };

/** What a sheet without a live power leads with, and the day's facts under its chart. */
export interface Facts {
  readonly lead: Fact | null;
  readonly stats: readonly Fact[];
}

const unit =
  (u: string, digits: number) =>
  (label: string, value: number | null): Fact => ({ label, value, unit: u, digits });

const kwh = unit("kWh", 1);
const eur = unit("€", 2);
const pct = unit("%", 0);
const ct = unit("ct/kWh", 1);

/** Rounds away float noise from a EUR → ct conversion. */
const cents = (eurPerKwh: number) => Math.round(eurPerKwh * 1e6) / 1e4;

const mean = (all: readonly number[]) => all.reduce((a, b) => a + b, 0) / all.length;

function price(day?: Readonly<Day>, spot?: number): Facts {
  const prices = day?.prices.map((p) => p.value) ?? [];
  const now = spot ?? (day === undefined ? null : current(day.prices, day.now));
  const of = (value: number) => (prices.length === 0 ? null : cents(value));

  return {
    lead: ct(m.detail_in_force(), now === null ? null : cents(now)),
    stats: [
      ct(m.detail_min(), of(Math.min(...prices))),
      ct(m.detail_max(), of(Math.max(...prices))),
      ct(m.detail_mean(), of(mean(prices))),
    ],
  };
}

const SKIES = {
  sunny: m.dash_sky_sunny,
  partly: m.dash_sky_partly,
  cloudy: m.dash_sky_cloudy,
  night: m.dash_sky_night,
};

function weather(day: Readonly<Day> | undefined): Facts {
  const sky = day?.weather.sky;

  const lead = {
    label: m.detail_now(),
    value: day?.weather.celsius ?? null,
    unit: "°C",
    digits: 0,
  };

  return { lead, stats: sky ? [{ label: m.dash_weather(), text: SKIES[sky]() }] : [] };
}

function peak(day: Readonly<Day> | undefined, kind: "production" | "consumption"): Fact {
  const watts = day?.today.peaks[kind]?.watts;

  return {
    label: m.detail_peak(),
    value: watts === undefined ? null : watts / 1000,
    unit: "kW",
    digits: 1,
  };
}

type Read = (day: Readonly<Day> | undefined) => Facts;

const only = (stats: readonly Fact[]): Facts => ({ lead: null, stats });

/** Each figure's facts but the price's, which also reads the live spot price. */
const DAY_FACTS = new Map<string, Read>([
  [
    "forecast",
    (day) => ({
      lead: kwh(m.detail_left(), day?.pv.remaining ?? null),
      stats: [kwh(m.detail_total(), day?.pv.total ?? null)],
    }),
  ],
  ["weather", weather],
  ["saved", (day) => ({ lead: eur(m.detail_today(), day?.money?.saved ?? null), stats: [] })],
  [
    "autarky",
    (day) => ({
      lead: pct(m.dash_autarky(), day?.today.autarky ?? null),
      stats: [pct(m.dash_self_use(), day?.today.selfUse ?? null)],
    }),
  ],
  [
    "production",
    (day) => only([peak(day, "production"), kwh(m.dash_forecast(), day?.pv.total ?? null)]),
  ],
  ["consumption", (day) => only([peak(day, "consumption")])],
  ["feedIn", (day) => only([eur(m.detail_earned(), day?.money?.earned ?? null)])],
  ["purchase", (day) => only([eur(m.detail_paid(), day?.money?.paid ?? null)])],
  ["pv", (day) => only([kwh(m.dash_today(), day?.today.production ?? null)])],
  ["house", (day) => only([kwh(m.dash_today(), day?.today.consumption ?? null)])],
  [
    "grid",
    (day) =>
      only([
        kwh(m.dash_grid_import(), day?.today.purchase ?? null),
        kwh(m.dash_grid_export(), day?.today.feedIn ?? null),
      ]),
  ],
]);

/** The facts of figure `id` from today and the spot price streaming now, in EUR/kWh. */
export function facts(id: string, day?: Readonly<Day>, spot?: number): Facts {
  if (id === "price") return price(day, spot);

  return DAY_FACTS.get(id)?.(day) ?? only([]);
}
