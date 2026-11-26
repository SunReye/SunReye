// The live graph's samples (ADR 21): every power value of the live stream (ADR 9), kept for the
// two-minute window plus its off-screen buffer, so a sheet opens with the graph already drawn.
import type { Values } from "../api/core.ts";

/** One sample: epoch milliseconds and watts. */
export interface LivePoint {
  readonly t: number;
  readonly v: number;
}

/** Samples by `<device>/<series>`, each array replaced, never mutated, when it grows. */
export type LiveSeries = Readonly<Record<string, readonly LivePoint[]>>;

/** The graph's window. */
export const WINDOW_MS = 2 * 60 * 1000;

/** The window plus six intervals of the slowest feed `live-window.ts` glides (5 s). */
export const KEEP_MS = WINDOW_MS + 6 * 5000;

const POWER = /power/u;

const keyOf = (device: number | string, series: string) => `${device}/${series}`;

/** `series` with the fresh power values of `live`, received at `at`, appended. */
export function record(series: LiveSeries, live: Values, at: number): LiveSeries {
  if (live.lost !== undefined) return series;

  const next = kept(series, at - KEEP_MS);

  for (const [key, v] of fresh(live)) next.set(key, [...(next.get(key) ?? []), { t: at, v }]);

  return Object.fromEntries(next);
}

/** Each series' points from `cut` on; a series left empty is dropped. */
function kept(series: LiveSeries, cut: number) {
  const next = new Map<string, readonly LivePoint[]>();

  for (const [key, points] of Object.entries(series)) {
    const recent = points.filter((p) => p.t >= cut);

    if (recent.length > 0) next.set(key, recent.length === points.length ? points : recent);
  }

  return next;
}

/** The power values `live` holds that are not stale, by key. */
function* fresh(live: Values): Generator<readonly [string, number]> {
  for (const [device, values] of Object.entries(live.devices)) {
    const stale = live.stale?.[device] ?? {};

    for (const [name, v] of Object.entries(values))
      if (POWER.test(name) && stale[name] === undefined) yield [keyOf(device, name), v];
  }
}

/** The samples of one device's series, oldest first. */
export function pointsOf(series: LiveSeries, device: number, name: string): readonly LivePoint[] {
  return series[keyOf(device, name)] ?? [];
}
