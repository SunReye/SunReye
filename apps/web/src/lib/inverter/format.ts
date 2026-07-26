import type { ManifestMetric } from "./types";

/**
 * Per-unit decimal precision. This is the single place that decides which value
 * types render with decimals: map a unit to a fixed number of fraction digits to
 * override the default. Power is whole-number only — fractional watts are noise
 * at inverter scale. Units not listed here fall back to {@link DEFAULT_DECIMALS}.
 */
const UNIT_DECIMALS: Record<string, number> = {
  W: 0,
  "%": 0,
};

/** Fallback when a unit has no explicit entry: ≥1 decimal (so `2` reads `2.0`), capped at 2. */
const DEFAULT_DECIMALS = { min: 1, max: 2 } as const;

/** Fixed decimal count configured for a unit, or `undefined` to use the default. */
export function configuredDecimals(unit: string | null | undefined): number | undefined {
  return unit ? UNIT_DECIMALS[unit] : undefined;
}

/** `toLocaleString` fraction-digit options for a value's unit. */
export function fractionDigits(unit: string | null | undefined): {
  minimumFractionDigits: number;
  maximumFractionDigits: number;
} {
  const fixed = configuredDecimals(unit);
  return {
    minimumFractionDigits: fixed ?? DEFAULT_DECIMALS.min,
    maximumFractionDigits: fixed ?? DEFAULT_DECIMALS.max,
  };
}

/** Locale-aware number formatted with its unit's configured precision. */
function formatNumber(v: number, unit?: string | null): string {
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, fractionDigits(unit));
}

/**
 * A status metric's enum label for the raw code `v`, falling back to the code
 * itself. Undefined for anything that is not an enum-labelled status metric.
 */
function statusLabel(metric: ManifestMetric, v: number): string | undefined {
  if (metric.kind !== "status" || !metric.enumLabels) return undefined;
  return metric.enumLabels[v] ?? String(v);
}

/**
 * Render-ready value for a metric: status metrics resolve through their enum
 * labels, everything else is a formatted number. Missing → em dash.
 */
export function formatValue(metric: ManifestMetric, v: number | undefined): string {
  if (v === undefined) return "—";
  return statusLabel(metric, v) ?? formatNumber(v, metric.unit);
}
