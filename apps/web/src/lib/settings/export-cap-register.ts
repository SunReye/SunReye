// The plant's export ceiling and the inverter's own sell-limit register describe
// the same physical quantity from two sides: `maxOutputW` is what the FORECAST
// and the optimizer plan against, `setting.solar_sell.max_power` is what the
// inverter ENFORCES. The Plant tab does not write the register — the optimizer's
// grid-friendly mode owns that hand — but it can show the operator what the
// inverter currently holds and copy it into the field in one click.

import type { Reading } from "$lib/live/plant";
import { kwText, optionalKw } from "./field-text";

/** The register's watts as the field's kW text, or null when the profile maps none. */
export function registerCapKw(reading: Reading): string | null {
  return reading.value === undefined ? null : kwText(reading.value);
}

/**
 * Whether the field and the register agree, to the watt. `null` when either
 * side has nothing to say — a blank field is "no limit", not "0 W".
 */
export function capMatchesRegister(maxOutputText: string, reading: Reading): boolean | null {
  const field = optionalKw(maxOutputText);
  if (!field.ok || field.watts === null || reading.value === undefined) return null;
  return Math.abs(field.watts - reading.value) < 1;
}
