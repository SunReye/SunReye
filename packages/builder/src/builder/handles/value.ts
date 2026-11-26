// A dragging handle's live value as words (ADR 20). Pure.
import { m } from "../../paraglide/messages.js";
import { isLocale } from "../../paraglide/runtime.js";
import type { Reading } from "./grabbing.ts";

/** One length to the decimetre, a roof object's size to the centimetre, or an angle in degrees;
 * a move's x and z; a roof object's metres from its eave and verge. */
export function valueText(
  { value, unit }: Pick<Reading, "value" | "unit">,
  locale: string,
): string {
  const digits = unit === "°" ? 0 : unit === "size" ? 2 : 1;

  const format = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  const [first = 0, second] = value;

  if (unit === "roof") {
    return m.builder_value_roof(
      { eave: format.format(first), verge: format.format(second ?? 0) },
      isLocale(locale) ? { locale } : {},
    );
  }

  if (second !== undefined) return `x ${format.format(first)} · z ${format.format(second)} m`;

  return unit === "°" ? `${format.format(first)}°` : `${format.format(first)} m`;
}
