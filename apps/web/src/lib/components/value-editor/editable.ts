import { valueText } from "../../settings/bounds.ts";

/**
 * What the value editor edits: a bounded stepped number on a wheel, a time of day on an hour and a
 * minute wheel, or one of a list (ADR 21).
 */
export type Editable =
  | {
      readonly kind: "number";
      readonly name: string;
      readonly unit: string;
      readonly min: number;
      readonly max: number;
      readonly step: number;
    }
  | {
      readonly kind: "time";
      readonly name: string;
      /** Minutes since midnight. */
      readonly min: number;
      readonly max: number;
      /** Minutes. */
      readonly step: number;
    }
  | {
      readonly kind: "enum";
      readonly name: string;
      readonly options: readonly Readonly<{ value: number; text: string }>[];
    };

/** What a setting declares (ADR 5), as the core's capabilities list it. */
export type EditableSetting = Readonly<{
  key: string;
  name?: string | null;
  unit?: string | null;
  range?: Readonly<{ min: number; max: number }> | null;
  step: number;
  values?: readonly number[] | null;
  labels?: readonly Readonly<{ value: number; text: string }>[];
  /** Its value is a time of day in minutes since midnight (ADR 5). */
  time?: boolean;
}>;

export function editable(setting: EditableSetting): Editable {
  const name = setting.name ?? setting.key;

  if (setting.values)
    return {
      kind: "enum",
      name,
      options: setting.values.map((value) => ({ value, text: valueText(value, setting.labels) })),
    };

  // The profile format requires a range where there are no values (ADR 5).
  const range = setting.range ?? { min: 0, max: 0 };

  if (setting.time === true)
    return { kind: "time", name, min: range.min, max: range.max, step: setting.step };

  return {
    kind: "number",
    name,
    unit: setting.unit ?? "",
    min: range.min,
    max: range.max,
    step: setting.step,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes since midnight as `HH:MM`. */
export function clock(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

// The core's own tolerance for a whole number of steps (crates/profile setting.rs).
const EXACT = 1e-9;

/** Whether the core's funnel would take `value` (ADR 7): inside the bounds, on a whole step. */
export function fits(edit: Editable, value: number): boolean {
  if (edit.kind === "enum") return edit.options.some((option) => option.value === value);

  const steps = value / edit.step;

  return (
    Number.isFinite(steps) &&
    Math.abs(steps - Math.round(steps)) <= EXACT &&
    value >= edit.min &&
    value <= edit.max
  );
}

export interface Rows {
  readonly count: number;
  /** The value of row `i`. */
  at(i: number): number;
  /** The nearest row to `value`, clamped to the wheel. */
  index(value: number): number;
}

/** A number's wheel: one row per whole step from zero inside its bounds. */
export function wheel(edit: Extract<Editable, { kind: "number" }>): Rows {
  const first = Math.ceil(edit.min / edit.step - EXACT);
  const last = Math.floor(edit.max / edit.step + EXACT);
  const count = Math.max(1, last - first + 1);
  // Enough decimals for the step, so 3 × 0.1 reads 0.3.
  const decimals = Math.max(0, -Math.floor(Math.log10(edit.step) + EXACT)) + 2;

  return {
    count,
    at: (i) => Number(((first + i) * edit.step).toFixed(decimals)),
    index: (value) => Math.max(0, Math.min(count - 1, Math.round(value / edit.step) - first)),
  };
}

/** How an apply ended: the editor closes on `confirmed` and stays open, saying why, on the others (ADR 21). */
export type Outcome =
  | { readonly kind: "confirmed" }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "mismatch"; readonly reason: string };
