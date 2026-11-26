// Numbers with a fixed count of fraction digits, in the SPA's locale.
import { getLocale } from "./paraglide/runtime.js";

/** One formatter per locale, digits and sign: building one costs far more than formatting with it. */
const FORMATS = new Map<string, Intl.NumberFormat>();

/** The format writing exactly `digits` fraction digits; `negative` never writes "-0". */
export function fixedFormat(digits: number, sign: "auto" | "negative" = "auto"): Intl.NumberFormat {
  const key = `${getLocale()} ${digits} ${sign}`;
  let format = FORMATS.get(key);

  if (!format) {
    format = new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: sign,
    });
    FORMATS.set(key, format);
  }

  return format;
}
