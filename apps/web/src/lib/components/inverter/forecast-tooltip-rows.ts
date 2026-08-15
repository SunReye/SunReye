/**
 * Pure row-building and formatting for the solar-forecast tooltip. Extracted
 * from forecast-tooltip.svelte so the "headline is the slot average, peak is
 * secondary" contract is unit-testable without a component render harness.
 *
 * The chart bars draw the slot AVERAGE power (`predictedW` / `actualW`), and a
 * bar's area equals the slot's energy. So the tooltip's headline must be the
 * average too — the peak (`*PeakW`) runs well above it on a spiky measured slot
 * and, shown large, reads as if the bar is wrong. Peak stays, demoted.
 */

import type { ForecastSlot } from "./forecast-chart.svelte";

export type TooltipRowKey = "predicted" | "uncapped" | "actual";

export interface TooltipRow {
  key: TooltipRowKey;
  /** Slot peak power, W — secondary text. */
  peakW: number;
  /** Slot average power, W — the headline and the bar height. */
  avgW: number;
}

/**
 * The rows to show for a hovered slot, in render order: forecast always;
 * the uncapped forecast only where clipping actually bites (else it just
 * duplicates the predicted numbers); the measured row only once the slot has
 * been measured (`actualW !== null`). Older samples predate per-slot peak
 * tracking, so a missing measured peak falls back to the average.
 */
export function tooltipRows(slot: ForecastSlot): TooltipRow[] {
  const rows: TooltipRow[] = [
    { key: "predicted", peakW: slot.predictedPeakW, avgW: slot.predictedW },
  ];
  if (slot.predictedRawW > slot.predictedW + 1) {
    rows.push({ key: "uncapped", peakW: slot.predictedRawPeakW, avgW: slot.predictedRawW });
  }
  if (slot.actualW !== null) {
    rows.push({ key: "actual", peakW: slot.actualPeakW ?? slot.actualW ?? 0, avgW: slot.actualW });
  }
  return rows;
}

/** Power in kW, at most two decimals, e.g. `5.92 kW`. */
export const kwLabel = (w: number): string =>
  `${(w / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kW`;

/** Slot energy in kWh from an average power (W) held over `stepMinutes`. */
export const kwhLabel = (w: number, stepMinutes: number): string =>
  `${((w * stepMinutes) / 60 / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`;

/**
 * The slot's end clock label from its start label plus the step, so the header
 * reads `16:15 – 16:30` and the last slot of the day correctly reads `24:00`.
 */
export const slotEndLabel = (label: string, stepMinutes: number): string => {
  const t = Number(label.slice(0, 2)) * 60 + Number(label.slice(3, 5)) + stepMinutes;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
