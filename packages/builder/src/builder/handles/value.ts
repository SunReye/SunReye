// A dragging handle's live value as words (ADR 20). Pure.
import { m } from "../../paraglide/messages.js";
import { isLocale } from "../../paraglide/runtime.js";
import type { Reading } from "./grabbing.ts";

/** Fraction digits a value shows by its unit: degrees whole, a roof object's size to the
 * centimetre, every other length to the decimetre. */
const DIGITS: Readonly<Record<Reading["unit"], number>> = { "°": 0, size: 2, m: 1, roof: 1 };

/** One length to the decimetre, a roof object's size to the centimetre, or an angle in degrees;
 * a move's x and z; a roof object's metres from its eave and verge. */
export function valueText(
  { value, unit, edge }: Pick<Reading, "value" | "unit" | "edge">,
  locale: string,
): string {
  const digits = DIGITS[unit];
  const options = isLocale(locale) ? { locale } : {};

  const format = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  const [first = 0, second] = value;

  if (unit === "roof") {
    return m.builder_value_roof(
      { eave: format.format(first), verge: format.format(second ?? 0) },
      options,
    );
  }

  if (second !== undefined) return `x ${format.format(first)} · z ${format.format(second)} m`;

  const text = `${format.format(first)}${unit === "°" ? "°" : " m"}`;

  return edge ? m.builder_value_edge({ value: text }, options) : text;
}
