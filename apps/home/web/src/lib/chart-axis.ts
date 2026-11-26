// The value axis the small charts share (ADR 21): three quiet ticks on the left over faint grid
// lines, no rule.
import { formatPower } from "./power.ts";

export const VALUE_AXIS = {
  placement: "left",
  ticks: 3,
  grid: { class: "stroke-foreground/[0.07]" },
  rule: false,
  tickLength: 0,
  classes: { tickLabel: "fill-muted-foreground text-[11px] tabular-nums" },
} as const;

/** The value axis over kW, each tick in the shared power format. */
export const KW_AXIS = {
  ...VALUE_AXIS,
  format: (kw: number) => formatPower(kw * 1000),
} as const;
