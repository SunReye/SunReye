// The value axis the small charts share (ADR 21): three quiet ticks on the left over faint grid
// lines, no rule.
export const VALUE_AXIS = {
  placement: "left",
  ticks: 3,
  grid: { class: "stroke-foreground/[0.07]" },
  rule: false,
  tickLength: 0,
  classes: { tickLabel: "fill-muted-foreground text-[11px] tabular-nums" },
} as const;
