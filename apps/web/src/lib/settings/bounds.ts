import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";

/** The text the profile labels an enumerated value with, such as a mode's name; else the number. */
export function valueText(
  value: number,
  labels: readonly Readonly<{ value: number; text: string }>[] | undefined,
): string {
  return labels?.find((label) => label.value === value)?.text ?? String(value);
}

/** What a setting's write may carry, as the admin reads it before enabling it (ADR 8). */
export function boundsText(
  range: Readonly<{ min: number; max: number }> | null | undefined,
  values: readonly number[] | null | undefined,
  step: number,
  labels?: readonly Readonly<{ value: number; text: string }>[],
): string {
  const number = new Intl.NumberFormat(getLocale());

  if (values)
    return m.settings_values({
      values: values.map((value) => valueText(value, labels)).join(", "),
    });

  return m.settings_range({
    min: number.format(range?.min ?? Number.NaN),
    max: number.format(range?.max ?? Number.NaN),
    step: number.format(step),
  });
}
