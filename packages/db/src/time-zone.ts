/**
 * Shared IANA time-zone validation, used by both the viewer display preference
 * ({@link ./display}) and the server-side plant zone ({@link ./plant}). Extracted
 * so the `"auto"` sentinel and the validating Zod field live in one place rather
 * than being copied into each config schema.
 */

import { z } from "zod";

/** `"auto"` sentinel: display → follow the viewer's zone; plant → fall back to host. */
export const TIME_ZONE_AUTO = "auto";

/** True when `tz` is a time zone the runtime's Intl implementation accepts. */
function isValidTimeZone(tz: string): boolean {
  try {
    // Constructing with an unknown zone throws a RangeError.
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** A Zod string field accepting the {@link TIME_ZONE_AUTO} sentinel or any valid IANA zone. */
export const timeZoneField = z
  .string()
  .refine((tz) => tz === TIME_ZONE_AUTO || isValidTimeZone(tz), "unknown time zone")
  .default(TIME_ZONE_AUTO);
