// The breakdown beside the chart: what the range's flows were, per question. Pure.
import { flowColour } from "../energy-colours.ts";
import { m } from "../paraglide/messages.js";
import { kwh, money, num } from "../range/format.ts";
import type { Sum } from "./flows.ts";
import type { Money } from "./stats.svelte.ts";
import type { Metric } from "./view.ts";

export interface Row {
  readonly label: string;
  readonly value: number | null;
  readonly format: (v: number) => string;
  readonly sub: string;
  readonly colour: string;
  readonly indent: boolean;
}

export interface BreakdownInput {
  readonly sum: Sum;
  readonly money: Money | null;
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
): Row => ({ label, value, format, sub, colour, indent });

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
  const c = t.money ?? { paid: 0, earned: 0, saved: 0 };

  return [
    row(
      m.stats_bill_without(),
      t.money ? c.saved + c.paid - c.earned : null,
      money,
      m.stats_house_load({ energy: kwh(s.consumption) }),
    ),
    row(
      m.stats_import_cost(),
      t.money ? c.paid : null,
      signed("− "),
      kwh(s.purchase),
      flowColour("import"),
    ),
    row(
      m.stats_feed_in_pay(),
      t.money ? c.earned : null,
      signed("+ "),
      kwh(s.feedIn),
      flowColour("export"),
    ),
    row(m.stats_savings(), t.money ? c.saved : null, money, m.stats_saved_note()),
  ];
}

function shares(t: BreakdownInput): Row[] {
  const s = t.sum;

  return [
    row(m.stats_autarky(), s.autarky, share, m.stats_autarky_note(), flowColour("battery")),
    row(m.stats_self_use(), s.selfUse, share, m.stats_self_use_note(), flowColour("solar")),
    ...battery(s),
    row(m.stats_bought(), s.purchase, kwh, money(t.money?.paid ?? 0), flowColour("import")),
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

  return [
    row(m.stats_production(), s.production, kwh, "", flowColour("solar")),
    row(m.stats_self_used(), s.selfUsed, kwh, pct(s.selfUse), "", true),
    row(
      m.stats_feed_in(),
      s.feedIn,
      kwh,
      priced(t.money?.earned, "+ "),
      flowColour("export"),
      true,
    ),
    row(m.stats_house(), s.consumption, kwh, "", flowColour("house")),
    ...(s.ev > 0.05
      ? [row(m.stats_ev(), s.ev, kwh, pct((s.ev / s.consumption) * 100), flowColour("ev"), true)]
      : []),
    row(m.stats_bought(), s.purchase, kwh, priced(t.money?.paid, "− "), flowColour("import"), true),
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
