import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";

/** What a setting's write may carry, as the admin reads it before enabling it (ADR 8). */
export function boundsText(
  range: Readonly<{ min: number; max: number }> | null | undefined,
  values: readonly number[] | null | undefined,
  step: number,
): string {
  const number = new Intl.NumberFormat(getLocale());

  if (values) return m.settings_values({ values: values.join(", ") });

  return m.settings_range({
    min: number.format(range?.min ?? Number.NaN),
    max: number.format(range?.max ?? Number.NaN),
    step: number.format(step),
  });
}
