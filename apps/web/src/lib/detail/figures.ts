// What each dashboard figure's detail sheet leads with (ADR 21). Pure.
import { flowColour } from "../energy-colours.ts";
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
  /** What stands where a figure has no series in history: a chart of today, or the weather by
   * the hour (ADR 23). */
  readonly chart: "pv" | "price" | "weather" | "forecast" | null;
}

const SOLAR = flowColour("solar");
const HOUSE = flowColour("house");
const GRID = [flowColour("import"), flowColour("export")] as const;
const EV: Figure = { colour: flowColour("ev"), node: "ev", chart: null };

const FIGURES: Readonly<Record<Fixed, Figure>> = {
  production: { colour: SOLAR, node: "pv", today: "production", chart: "pv" },
  consumption: { colour: HOUSE, node: "house", today: "consumption", chart: null },
  feedIn: {
    colour: flowColour("export"),
    node: "grid",
    direction: "grid",
    diverging: GRID,
    today: "feedIn",
    chart: null,
  },
  purchase: {
    colour: flowColour("import"),
    node: "grid",
    direction: "grid",
    diverging: GRID,
    today: "purchase",
    chart: null,
  },
  autarky: { colour: flowColour("battery"), node: null, chart: null },
  saved: { colour: SOLAR, node: null, chart: null },
  price: { colour: HOUSE, node: null, chart: "price" },
  forecast: { colour: SOLAR, node: null, chart: "forecast" },
  weather: { colour: SOLAR, node: null, chart: "weather" },
  pv: { colour: SOLAR, node: "pv", chart: "pv" },
  inverter: { colour: SOLAR, node: "inverter", chart: null },
  battery: {
    colour: flowColour("battery"),
    node: "battery",
    direction: "battery",
    diverging: [flowColour("battery"), flowColour("battery")],
    chart: null,
  },
  grid: {
    colour: flowColour("export"),
    node: "grid",
    direction: "grid",
    diverging: GRID,
    chart: null,
  },
  house: { colour: HOUSE, node: "house", chart: null },
  ev: EV,
  generator: { colour: HOUSE, node: "generator", chart: null },
};

/** A figure named by itself rather than by a string or a loadpoint. */
export type Fixed =
  | Today
  | "autarky"
  | "saved"
  | "price"
  | "forecast"
  | "weather"
  | "pv"
  | "inverter"
  | "battery"
  | "grid"
  | "house"
  | "ev"
  | "generator";

/** What a figure id names: a fixed figure, a PV string by its id or a loadpoint by its device. */
export type FigureRef =
  | { readonly kind: "fixed"; readonly id: Fixed }
  | { readonly kind: "string"; readonly id: number }
  | { readonly kind: "ev"; readonly id: number };

/** A detail sheet's figure, as routes and taps carry it. */
export type FigureId = Fixed | `string-${number}` | `ev-${number}`;

export function formatFigure(ref: FigureRef): FigureId {
  return ref.kind === "fixed" ? ref.id : `${ref.kind}-${ref.id}`;
}

const isFixed = (id: string): id is Fixed => Object.hasOwn(FIGURES, id);

const NUMBERED = /^(?<kind>string|ev)-(?<id>\d+)$/u;

/** The figure `id` names; null for none. */
export function parseFigure(id: string): FigureRef | null {
  const numbered = NUMBERED.exec(id)?.groups;

  if (numbered !== undefined)
    return { kind: numbered.kind === "ev" ? "ev" : "string", id: Number(numbered.id) };

  return isFixed(id) ? { kind: "fixed", id } : null;
}

/** The figure `id` names: a fixed one, `string-<id>` or `ev-<device>`; null for none. */
export function figure(id: string): Figure | null {
  const ref = parseFigure(id);

  if (ref === null) return null;

  if (ref.kind === "string") return { colour: SOLAR, node: id, chart: null };

  if (ref.kind === "ev") return { ...EV, node: id };

  return FIGURES[ref.id];
}

/** The title of a fixed figure; a string's and a loadpoint's are their names. */
const TITLES: Readonly<Record<Fixed, () => string>> = {
  production: m.dash_made,
  consumption: m.dash_used,
  feedIn: m.dash_grid_export,
  purchase: m.dash_grid_import,
  autarky: m.detail_autarky,
  saved: m.detail_saved,
  price: m.dash_spot,
  forecast: m.detail_forecast,
  weather: m.dash_weather,
  pv: m.detail_pv,
  inverter: m.detail_inverter,
  battery: m.dash_battery,
  grid: m.detail_grid,
  house: m.dash_house,
  ev: m.dash_ev,
  generator: m.flow_generator,
};

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
  const ref = parseFigure(id);

  if (ref === null) return "";

  if (ref.kind === "fixed") return TITLES[ref.id]();

  if (ref.kind === "ev") return device(ref.id) ?? m.dash_ev();

  return strings.find((s) => s.id === ref.id)?.name ?? m.detail_pv();
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

/** The weather's facts, the sky's word with them, stand in its day tabs (ADR 21). */
function weather(day: Readonly<Day> | undefined): Facts {
  const lead = {
    label: m.detail_now(),
    value: day?.weather.celsius ?? null,
    unit: "°C",
    digits: 0,
  };

  return { lead, stats: [] };
}

function peak(day: Readonly<Day> | undefined, kind: "production" | "consumption"): Fact {
  const watts = day?.today.peaks[kind]?.watts;

  return {
    label: m.detail_peak(),
    value: watts ?? null,
    unit: "W",
    digits: 0,
  };
}

type Read = (day: Readonly<Day> | undefined) => Facts;

const only = (stats: readonly Fact[]): Facts => ({ lead: null, stats });

/** Each figure's facts but the price's, which also reads the live spot price. */
const DAY_FACTS = new Map<string, Read>([
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
