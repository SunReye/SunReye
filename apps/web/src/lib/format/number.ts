// Locale-aware number formatting, the counterpart to ./date.ts.
//
// Same defect, same fix: `toLocaleString(undefined, …)` groups digits the way
// the *browser* is configured, so a German page printed "1,234.5 kWh".

import { localeFormatter } from "./intl";

const formatter = localeFormatter(
  (locale, options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options),
);

/** Format a number in the UI locale. */
export const formatNumber = (value: number, options: Intl.NumberFormatOptions = {}): string =>
  formatter(options).format(value);

/** `value` at up to `digits` fraction digits — the common case. */
export const decimal = (value: number, digits = 1): string =>
  formatNumber(value, { maximumFractionDigits: digits });
