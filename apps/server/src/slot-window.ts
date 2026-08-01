/**
 * Forecast slot geometry — the one place a time series of plant-local slots is
 * turned into "which slots, and how much of each, fall in a window".
 *
 * Extracted from `./peak-shaving` so that planners which are *not* peak shaving
 * can walk the same slots without importing it. Peak shaving will come to depend
 * on the price planner, so the price planner must not depend back on peak
 * shaving — and a second copy of this geometry is exactly how the two would
 * drift apart on the details that matter (the hour cap, the prorated running
 * slot, the plant-local day boundary).
 *
 * Pure: no DB, no clock of its own.
 */

import { HOUR_MS } from "./energy-flow";
import type { SolarForecastPoint } from "./solar-forecast";

/** The slice of a forecast a planner reads (raw/uncurtailed view). */
export interface ForecastSlice {
  series: SolarForecastPoint[];
  stepMinutes: number;
  utcOffsetSeconds: number;
}

/** A forecast slot, with the part of it inside the caller's window. */
export interface ForecastSlot {
  /** Slot start, epoch ms. */
  startMs: number;
  /** The part of the slot inside the window, ms. */
  remainingMs: number;
  /** Raw (uncurtailed) forecast power for the slot, W. */
  watts: number;
}

/**
 * Width of the slot starting at `startMs`, ms: the gap to the next slot's local
 * time, but never wider than an hour — a series gap (e.g. a day boundary) must
 * not stretch a slot across it. Falls back to the nominal step at the tail.
 */
function slotWidthMs(
  startMs: number,
  nextTime: string | undefined,
  offsetMs: number,
  fallbackWidthMs: number,
): number {
  if (nextTime === undefined) return fallbackWidthMs;
  const gap = Date.parse(`${nextTime}:00Z`) - offsetMs - startMs;
  return gap > 0 && gap <= HOUR_MS ? gap : fallbackWidthMs;
}

/** Absolute start instant of a series point. */
const startOf = (time: string, offsetMs: number): number => Date.parse(`${time}:00Z`) - offsetMs;

/**
 * Slots overlapping `[fromMs, toMs)`, oldest first, each carrying only the part
 * inside the window — so the first and last are prorated exactly like the
 * running slot in {@link remainingSlotsToday}.
 *
 * The sibling of `remainingSlotsToday` for an *arbitrary* window: that one
 * filters by the plant-local date string, so it cannot integrate over a window
 * that crosses midnight or lies in tomorrow, which is precisely what a planner
 * looking ahead to tomorrow's prices needs.
 */
export function slotsBetween(view: ForecastSlice, fromMs: number, toMs: number): ForecastSlot[] {
  const offsetMs = view.utcOffsetSeconds * 1000;
  const fallbackWidth = view.stepMinutes * 60_000;
  const slots: ForecastSlot[] = [];
  for (const [i, point] of view.series.entries()) {
    const startMs = startOf(point.time, offsetMs);
    const width = slotWidthMs(startMs, view.series[i + 1]?.time, offsetMs, fallbackWidth);
    const overlapMs = Math.min(startMs + width, toMs) - Math.max(startMs, fromMs);
    if (overlapMs <= 0) continue;
    slots.push({ startMs, remainingMs: overlapMs, watts: point.watts });
  }
  return slots;
}

/**
 * Future slots of the plant-local calendar day, oldest first, with the running
 * slot prorated by the fraction still ahead (mirrors `remainingTodayKwh` in
 * solar-forecast). Both the shave threshold's surplus integral and the forward
 * projection walk the day through this.
 */
export function remainingSlotsToday(view: ForecastSlice, fromMs: number): ForecastSlot[] {
  const offsetMs = view.utcOffsetSeconds * 1000;
  const today = new Date(fromMs + offsetMs).toISOString().slice(0, 10);
  const fallbackWidth = view.stepMinutes * 60_000;
  const slots: ForecastSlot[] = [];
  for (const [i, point] of view.series.entries()) {
    if (!point.time.startsWith(today)) continue;
    const startMs = startOf(point.time, offsetMs);
    const width = slotWidthMs(startMs, view.series[i + 1]?.time, offsetMs, fallbackWidth);
    const remainingMs = Math.min(startMs + width - fromMs, width);
    if (remainingMs <= 0) continue;
    slots.push({ startMs, remainingMs, watts: point.watts });
  }
  return slots;
}
