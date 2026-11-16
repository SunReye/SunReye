// The breakdown beside the chart: what the range's flows were, per question. Pure.
import { flowColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import { kwh, money, num } from "../range/format.ts";
import type { Sum } from "./flows.ts";
import type { Money } from "./stats.svelte.ts";
import type { Metric } from "./view.ts";
import { change, delta } from "./words.ts";

export interface Row {
  readonly label: string;
  readonly value: number | null;
  readonly format: (v: number) => string;
  readonly sub: string;
  readonly colour: string;
  readonly indent: boolean;
  /** Against the baseline, as "+12 %"; empty without one. */
  readonly change: string;
}

export interface BreakdownInput {
  readonly sum: Sum;
  readonly money: Money | null;
  /** The baseline's flows and money; null without readings to compare with. */
  readonly base: { readonly sum: Sum; readonly money: Money | null } | null;
  /** The days of the range with readings. */
  readonly days: number;
  /** The layout's peak power and string count. */
  readonly kwp: number;
  readonly strings: number;
  /** In ms. */
  readonly elapsed: number;
}

const pct = (v: number | null) => (v === null ? "–" : `${num(v)} %`);
const share = (v: number) => `${num(v)} %`;
const signed = (sign: string) => (v: number) => `${sign}${money(v)}`;

const row = (
  label: string,
  value: number | null,
  format: (v: number) => string,
  sub = "",
  colour = "",
  indent = false,
): Row => ({ label, value, format, sub, colour, indent, change: "" });

/** In kWh or EUR: below it a baseline carries no change. */
const NEXT_TO_NOTHING = 0.05;

/** The row with its change from `was`; a share changes in percentage points. */
function against(r: Row, was: number | null | undefined, points = false): Row {
  if (r.value === null || was === null || was === undefined) return r;

  // From next to nothing, a change says nothing: 0,02 kWh to 0,04 kWh is no "+100 %".
  if (!points && Math.abs(was) < NEXT_TO_NOTHING) return r;

  const c = points ? (r.value - was) / 100 : change(r.value, was);

  return c === null ? r : { ...r, change: delta(c, points) };
}

/** A flow's mean per recorded day, once the range has several. */
const daily = (t: BreakdownInput, v: number) =>
  t.days > 1 ? m.stats_per_day({ energy: kwh(v / t.days) }) : "";

function battery(s: Sum): Row[] {
  if (s.discharge <= 0.05) return [];

  return [
    row(
      m.stats_battery_charged(),
      s.charge,
      kwh,
      m.stats_discharged({ energy: kwh(s.discharge) }),
      flowColour("battery"),
    ),
  ];
}

function cash(t: BreakdownInput): Row[] {
  const s = t.sum;
  const c = t.money ?? { paid: 0, earned: 0, saved: 0, standing: 0 };

  return [
    row(
      m.stats_bill_without(),
      // Owed with or without the plant, so the standing charge is in both bills.
      t.money ? c.saved + c.paid - c.earned + c.standing : null,
      money,
      m.stats_house_load({ energy: kwh(s.consumption) }),
    ),
    against(
      row(
        m.stats_import_cost(),
        t.money ? c.paid : null,
        signed("− "),
        kwh(s.purchase),
        flowColour("import"),
      ),
      t.base?.money?.paid,
    ),
    row(
      m.tariff_standing(),
      t.money ? c.standing : null,
      signed("− "),
      m.stats_standing_note(),
      flowColour("house"),
    ),
    row(
      m.stats_feed_in_pay(),
      t.money ? c.earned : null,
      signed("+ "),
      kwh(s.feedIn),
      flowColour("export"),
    ),
    against(
      row(m.stats_savings(), t.money ? c.saved : null, money, m.stats_saved_note()),
      t.base?.money?.saved,
    ),
  ];
}

function shares(t: BreakdownInput): Row[] {
  const s = t.sum;

  return [
    against(
      row(m.stats_autarky(), s.autarky, share, m.stats_autarky_note(), flowColour("battery")),
      t.base?.sum.autarky,
      true,
    ),
    against(
      row(m.stats_self_use(), s.selfUse, share, m.stats_self_use_note(), flowColour("solar")),
      t.base?.sum.selfUse,
      true,
    ),
    ...battery(s),
    against(
      row(m.stats_bought(), s.purchase, kwh, money(t.money?.paid ?? 0), flowColour("import")),
      t.base?.sum.purchase,
    ),
  ];
}

function plant(t: BreakdownInput): Row[] {
  const gap = Math.max(0, t.elapsed - t.sum.covered) / 3_600_000;

  return [
    row(
      m.stats_kwp(),
      t.kwp,
      (v) => `${num(v, 1)} kWp`,
      m.stats_strings_count({ count: t.strings }),
      flowColour("solar"),
    ),
    row(
      m.stats_specific(),
      t.kwp > 0 ? t.sum.production / t.kwp : null,
      (v) => `${num(v, v < 100 ? 1 : 0)} kWh/kWp`,
      m.stats_specific_note(),
    ),
    row(
      m.stats_recorded(),
      t.elapsed > 0 ? (t.sum.covered / t.elapsed) * 100 : null,
      share,
      m.stats_gap_hours({ hours: num(gap) }),
    ),
  ];
}

const priced = (v: number | undefined, sign: string) =>
  v === undefined ? "" : `${sign}${money(v)}`;

function energy(t: BreakdownInput): Row[] {
  const s = t.sum;
  const was = t.base?.sum;

  return [
    against(
      row(m.stats_production(), s.production, kwh, daily(t, s.production), flowColour("solar")),
      was?.production,
    ),
    row(m.stats_self_used(), s.selfUsed, kwh, pct(s.selfUse), "", true),
    against(
      row(
        m.stats_feed_in(),
        s.feedIn,
        kwh,
        priced(t.money?.earned, "+ "),
        flowColour("export"),
        true,
      ),
      was?.feedIn,
    ),
    against(
      row(m.stats_house(), s.consumption, kwh, daily(t, s.consumption), flowColour("house")),
      was?.consumption,
    ),
    ...(s.ev > 0.05
      ? [row(m.stats_ev(), s.ev, kwh, pct((s.ev / s.consumption) * 100), flowColour("ev"), true)]
      : []),
    against(
      row(
        m.stats_bought(),
        s.purchase,
        kwh,
        priced(t.money?.paid, "− "),
        flowColour("import"),
        true,
      ),
      was?.purchase,
    ),
    ...battery(s),
  ];
}

const ROWS: Readonly<Record<Metric, (t: BreakdownInput) => Row[]>> = {
  energy,
  money: cash,
  autarky: shares,
  plant,
};

export const breakdownOf = (metric: Metric, t: BreakdownInput): Row[] => ROWS[metric](t);
