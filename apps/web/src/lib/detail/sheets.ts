// Every figure's detail sheet (ADR 21): how it looks, what heads it, what its range charts and what
// reads the range below. Adding a sheet is adding a row here. Pure.
import { PLANT } from "../api/core.ts";
import { TARIFF } from "../api/computed-devices.ts";
import type { Day } from "../dashboard/day.ts";
import { flowColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import {
  gridFacts,
  priceFacts,
  productionFacts,
  weatherFacts,
  type Facts,
  type Figure,
  type Fixed,
} from "./figures.ts";
import { EARNED, PAID, type SheetFlow } from "./flow.ts";
import type { Metric, Tab } from "../history/view.ts";
import { AUTARKY, type Head } from "./measure.ts";

/** What a sheet's range tabs chart. */
export interface Analytics {
  readonly device: number;
  readonly series: string;
  /** The series whose hourly energy the heat grid shows; null for none. */
  readonly heat: string | null;
  /** The way the heat reads, where the figure's name does not say it; else null. */
  readonly way: string | null;
  /** The layout's strings are compared. */
  readonly compare: boolean;
  /** The sheet's own string, which the comparison marks; null for any other sheet. */
  readonly string: number | null;
  /** The inverters whose forecasts of `series` add up to what the figure expects; none for most. */
  readonly forecast: readonly number[];
}

/** What reads a sheet's range: its tabs alone, or a panel of its own beside or in place of them. */
export type Panel =
  | { readonly kind: "tabs" | "ev" | "battery" | "autarky" | "savings" }
  | { readonly kind: "flow"; readonly flow: SheetFlow }
  | { readonly kind: "pv"; readonly inverter: boolean };

/** One figure's detail sheet. */
export interface Sheet {
  readonly figure: Figure;
  /** The series its range tabs chart; null for a sheet without one. */
  readonly analytics: Analytics | null;
  /** Its figure over the range; null for a sheet that heads with none. */
  readonly head: Head | null;
  /** What reads its range; null for a sheet of today alone. */
  readonly panel: Panel | null;
  /** What a sheet of today leads with and states, from the day and the spot price in EUR/kWh. */
  readonly facts: ((day?: Readonly<Day>, spot?: number) => Facts) | null;
  /** Where History opens from it: its question, tab and string; null for History's default. */
  readonly history: Onward;
}

/** History's parameters a sheet opens it at. */
export interface Onward {
  readonly metric: Metric | null;
  readonly tab: Tab | null;
  readonly sid: string | null;
}

/** A plant series a sheet charts: the series, its heat and its way; `pv` compares the strings and
 * expects the inverters' forecast. */
export interface Charted {
  readonly series: string;
  readonly heat: string;
  readonly way?: () => string;
  readonly pv?: true;
}

/** A fixed figure's sheet: its title, and its series charted without the layout's strings. */
export interface Row extends Omit<Sheet, "analytics" | "facts" | "history"> {
  readonly title: () => string;
  readonly charted: Charted | null;
  readonly facts?: Sheet["facts"];
  readonly history?: Readonly<Partial<Onward>>;
}

export const SOLAR = flowColour("solar");
const HOUSE = flowColour("house");
const GRID = [flowColour("import"), flowColour("export")] as const;
export const EV: Figure = { colour: flowColour("ev"), node: "ev", chart: null };

/** A grid figure: its live power diverges around zero. */
const grid = (colour: string): Figure => ({
  colour,
  node: "grid",
  direction: "grid",
  diverging: GRID,
  chart: null,
});

/** The plant's `series` charted, heated by `heat`. */
const plant = (series: string, heat = series): Charted => ({ series, heat });

const PV = { series: "pv.power", heat: "pv.power", pv: true } as const;

/** The plant's energy of `series`. */
const energy = (series: string, name?: () => string): Head => ({
  kind: "energy",
  device: PLANT,
  series,
  ...(name && { name }),
});

/** A flow sheet's panel: the flow's peak, and the share PV covered or its euros. */
const flow = (series: string, rest: Omit<SheetFlow, "series">): Panel => ({
  kind: "flow",
  flow: { series, ...rest },
});

const LOAD = flow("load.power", { cover: true, price: false, money: null });

/** A sheet of today alone: no range. */
const today = (title: () => string, look: Figure, facts?: Sheet["facts"]): Row => ({
  title,
  figure: look,
  charted: null,
  head: null,
  panel: null,
  ...(facts && { facts }),
});

export const ROWS: Readonly<Record<Fixed, Row>> = {
  production: {
    title: m.dash_made,
    figure: { colour: SOLAR, node: "pv", chart: "pv" },
    charted: PV,
    head: energy("pv.power"),
    panel: { kind: "tabs" },
    facts: productionFacts,
  },
  pv: {
    title: m.detail_pv,
    figure: { colour: SOLAR, node: "pv", chart: "pv" },
    charted: PV,
    head: energy("pv.power"),
    panel: { kind: "pv", inverter: false },
  },
  inverter: {
    title: m.detail_inverter,
    figure: { colour: SOLAR, node: "inverter", chart: null },
    charted: PV,
    head: energy("pv.power"),
    panel: { kind: "pv", inverter: true },
    history: { metric: "plant", tab: "data" },
  },
  consumption: {
    title: m.dash_used,
    figure: { colour: HOUSE, node: "house", chart: null },
    charted: plant("load.power"),
    head: energy("load.power"),
    panel: LOAD,
  },
  house: {
    title: m.dash_house,
    figure: { colour: HOUSE, node: "house", chart: null },
    charted: plant("load.power"),
    head: energy("load.power"),
    panel: LOAD,
  },
  purchase: {
    title: m.dash_grid_import,
    figure: grid(flowColour("import")),
    charted: plant("grid.power", "grid.import.power"),
    head: energy("grid.import.power"),
    panel: flow("grid.import.power", { cover: false, price: true, money: PAID }),
  },
  feedIn: {
    title: m.dash_grid_export,
    figure: grid(flowColour("export")),
    charted: plant("grid.power", "grid.export.power"),
    head: energy("grid.export.power"),
    panel: flow("grid.export.power", { cover: false, price: false, money: EARNED }),
  },
  grid: {
    title: m.detail_grid,
    figure: grid(flowColour("export")),
    charted: plant("grid.power", "grid.import.power"),
    head: null,
    panel: { kind: "tabs" },
    facts: gridFacts,
  },
  generator: {
    title: m.flow_generator,
    figure: { colour: HOUSE, node: "generator", chart: null },
    charted: plant("generator.power"),
    head: energy("generator.power"),
    panel: flow("generator.power", { cover: false, price: false, money: null }),
  },
  battery: {
    title: m.dash_battery,
    figure: {
      colour: flowColour("battery"),
      node: "battery",
      direction: "battery",
      diverging: [flowColour("battery"), flowColour("battery")],
      chart: null,
    },
    charted: { ...plant("battery.power", "battery.discharge.power"), way: m.side_discharged },
    head: energy("battery.discharge.power", m.side_discharged),
    panel: { kind: "battery" },
    history: { metric: "plant", tab: "battery" },
  },
  ev: {
    title: m.dash_ev,
    figure: EV,
    charted: plant("ev.charge.power"),
    head: energy("ev.charge.power"),
    panel: { kind: "ev" },
  },
  autarky: {
    title: m.detail_autarky,
    figure: { colour: flowColour("battery"), node: null, chart: null },
    charted: null,
    head: AUTARKY,
    panel: { kind: "autarky" },
    history: { metric: "autarky" },
  },
  saved: {
    title: m.detail_saved,
    figure: { colour: SOLAR, node: null, chart: null },
    charted: null,
    head: { kind: "money", device: TARIFF, series: "cost.savings.rate" },
    panel: { kind: "savings" },
    history: { metric: "money" },
  },
  price: {
    ...today(m.dash_spot, { colour: HOUSE, node: null, chart: "price" }, priceFacts),
    history: { metric: "money", tab: "tariff" },
  },
  forecast: {
    ...today(m.detail_forecast, { colour: SOLAR, node: null, chart: "forecast" }),
    history: { tab: "forecast" },
  },
  weather: today(m.dash_weather, { colour: SOLAR, node: null, chart: "weather" }, weatherFacts),
};
