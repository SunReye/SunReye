import type { MetricKind } from "./types";

/**
 * Render registry: the UI dispatches on the canonical `kind`, never on
 * vendor-specific metric keys. Adding an inverter that reports a new metric
 * needs no change here as long as it maps onto an existing kind/role.
 */

/** Tailwind classes for the value text of a metric, by kind. */
export function kindValueClass(kind: MetricKind): string {
  switch (kind) {
    case "cumulative":
      return "text-foreground";
    case "setting":
      return "text-muted-foreground";
    default:
      return "text-foreground";
  }
}
