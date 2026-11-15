// A dragging handle's live value as words (ADR 20). Pure.
import type { Reading } from "./grabbing.ts";

/** One length to the decimetre or an angle in degrees; a move's x and z. */
export function valueText(
  { value, unit }: Pick<Reading, "value" | "unit">,
  locale: string,
): string {
  const digits = unit === "m" ? 1 : 0;

  const format = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  const [first = 0, second] = value;

  if (second !== undefined) return `x ${format.format(first)} · z ${format.format(second)} m`;

  return unit === "m" ? `${format.format(first)} m` : `${format.format(first)}°`;
}
