// The battery tab's figures (ADR 4): the core's capacity estimate over the whole record, and the
// cycles of the range. Pure.
import type { Capacity } from "../api/records.ts";
import { m } from "../paraglide/messages.js";
import { civil, shortDay } from "../range/calendar.ts";
import { kwh, num } from "../range/format.ts";
import { plantNow } from "../plant-day.ts";
import type { TrendRow } from "./trend.ts";
import { delta } from "./words.ts";

export interface Cell {
  readonly key: string;
  readonly value: string;
  readonly sub: string;
}

const dayOf = (zone: string, rfc: string) => plantNow(zone, new Date(rfc)).day;

/** Each measurement, with the least-squares line through them: the trend, not the noise. */
export function capacityRows(c: Capacity, zone: string): TrendRow[] {
  const points: readonly Readonly<{ day: number; kwh: number }>[] = c.measurements.map((p) => ({
    day: dayOf(zone, p.end),
    kwh: p.kwh,
  }));

  const n = points.length;

  if (n < 2) return [];

  const mx = points.reduce((a, p) => a + p.day, 0) / n;
  const my = points.reduce((a, p) => a + p.kwh, 0) / n;
  const sxx = points.reduce((a, p) => a + (p.day - mx) ** 2, 0);
  const slope = sxx > 0 ? points.reduce((a, p) => a + (p.day - mx) * (p.kwh - my), 0) / sxx : 0;

  return points.map((p) => ({
    x: civil(p.day),
    values: { kwh: p.kwh, trend: my + slope * (p.day - mx) },
  }));
}

const known = (v: number | null | undefined): v is number => v !== null && v !== undefined;

function usable(c: Capacity): Cell {
  const reference = c.nameplate ?? c.first;
  const now = c.now ?? null;

  if (now === null)
    return { key: m.stats_capacity_usable(), value: "–", sub: m.stats_capacity_none() };

  const share = known(reference) && reference > 0 ? `${num((now / reference) * 100)} %` : "–";

  return {
    key: m.stats_capacity_usable(),
    value: m.stats_capacity_value({ kwh: kwh(now) }),
    sub: known(c.nameplate)
      ? m.stats_capacity_of_nameplate({ share, nameplate: `${num(c.nameplate)} kWh` })
      : m.stats_capacity_of_first({ share }),
  };
}

function change(c: Capacity): Cell {
  const perYear = c.perYear ?? null;

  return {
    key: m.stats_capacity_change(),
    value: perYear === null ? "–" : delta(perYear),
    sub: perYear === null ? m.stats_capacity_change_wait() : m.stats_capacity_change_trend(),
  };
}

function total(c: Capacity, since: number | null): Cell {
  return {
    key: m.stats_cycles_total(),
    value: known(c.cycles) ? num(c.cycles) : "–",
    sub: m.stats_cycles_since({ date: since === null ? "–" : shortDay(since, true) }),
  };
}

/** The range's cycles; none for a range before the battery's first day. */
function inRange(c: Capacity, discharge: number, before: boolean): Cell {
  const reference = c.nameplate ?? c.now ?? null;
  const counted = !before && known(reference) && reference > 0;

  return {
    key: m.stats_cycles_range(),
    value: counted ? num(discharge / reference, 1) : "–",
    sub: before ? m.stats_cycles_later() : m.stats_cycles_discharged({ kwh: kwh(discharge) }),
  };
}

/** The four figures: capacity, its change a year, cycles in all and in the range. */
export function capacityCells(
  c: Capacity,
  range: Readonly<{ discharge: number; end: number }>,
  zone: string,
): Cell[] {
  const since = c.since === null || c.since === undefined ? null : dayOf(zone, c.since);

  return [
    usable(c),
    change(c),
    total(c, since),
    inRange(c, range.discharge, since !== null && range.end <= since),
  ];
}
