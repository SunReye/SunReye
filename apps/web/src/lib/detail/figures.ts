// The figures a detail sheet opens on, and what a sheet of today's day states (ADR 21). Pure.
import type { Day } from "../dashboard/day.ts";
import { current } from "../dashboard/now.ts";
import { m } from "../paraglide/messages.js";

export interface Figure {
  readonly colour: string;
  /** The node whose live power the sheet shows and whose readings it lists. */
  readonly node: string | null;
  /** A signed power: which words say its direction. */
  readonly direction?: "battery" | "grid";
  /** The live graph fills around zero: the colour above, then below (ADR 21). */
  readonly diverging?: readonly [string, string];
  /** What stands where a figure has no series in history: a chart of today, or the weather by
   * the hour (ADR 23). */
  readonly chart: "pv" | "price" | "weather" | "forecast" | null;
}

const FIXED = [
  "production",
  "consumption",
  "feedIn",
  "purchase",
  "autarky",
  "saved",
  "price",
  "forecast",
  "weather",
  "pv",
  "inverter",
  "battery",
  "grid",
  "house",
  "ev",
  "generator",
] as const;

/** A figure named by itself rather than by a string or a loadpoint. */
export type Fixed = (typeof FIXED)[number];

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

const FIXED_IDS: ReadonlySet<string> = new Set(FIXED);

const isFixed = (id: string): id is Fixed => FIXED_IDS.has(id);

const NUMBERED = /^(?<kind>string|ev)-(?<id>\d+)$/u;

/** The figure `id` names; null for none. */
export function parseFigure(id: string): FigureRef | null {
  const numbered = NUMBERED.exec(id)?.groups;

  if (numbered !== undefined)
    return { kind: numbered.kind === "ev" ? "ev" : "string", id: Number(numbered.id) };

  return isFixed(id) ? { kind: "fixed", id } : null;
}

/** One figure: a number in its unit, unknown as null, or words. */
export type Fact =
  | {
      readonly label: string;
      readonly value: number | null;
      readonly unit: string;
      readonly digits: number;
      /** When it was, under the value: an hour or a day. */
      readonly note?: string;
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

const ct = unit("ct/kWh", 1);

/** Rounds away float noise from a EUR → ct conversion. */
const cents = (eurPerKwh: number) => Math.round(eurPerKwh * 1e6) / 1e4;

const mean = (all: readonly number[]) => all.reduce((a, b) => a + b, 0) / all.length;

/** The price leads with the slot in force, the live spot price where it streams, and states the
 * day's spread. */
export function priceFacts(day?: Readonly<Day>, spot?: number): Facts {
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
export function weatherFacts(day?: Readonly<Day>): Facts {
  const lead = {
    label: m.detail_now(),
    value: day?.weather.celsius ?? null,
    unit: "°C",
    digits: 0,
  };

  return { lead, stats: [] };
}
