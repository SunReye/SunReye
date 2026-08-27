/**
 * Deep-merge a partial update onto a stored settings record.
 *
 * Exists because one `app_settings` record can be edited from more than one
 * place. The weather record is the case that forced it: its location fields live
 * on the Weather page while the plant it describes — the PV arrays, the export
 * limit, the battery, the smart-meter date — belongs with the inverter. Two
 * forms, one row. If each sends the WHOLE record, the second save writes back
 * whatever the first form had loaded, and one page silently undoes the other.
 *
 * So a form sends only the fields it owns and this fills in the rest from what
 * is stored.
 *
 * **Arrays replace, never merge.** `forecast.arrays` is a list of PV surfaces,
 * and index-wise merging would turn "delete the second of three" into "keep the
 * third under the second's index". A list is a value here, not a structure.
 *
 * **`undefined` is absent; `null` is a value.** A form omitting a key means
 * "leave it alone", while a form sending `null` means "clear it" — the
 * smart-meter date is exactly that distinction, and collapsing the two would
 * make the field impossible to unset.
 */

/** Whether a value is a plain object — the only thing worth recursing into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `base` with every key of `patch` applied, recursively.
 *
 * Neither input is mutated: a settings record is served from a cache, and
 * mutating it in place would change the value other readers already hold.
 */
export function mergeSetting(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch;
  if (!isPlainObject(base)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = key in base ? mergeSetting(base[key], value) : value;
  }
  return out;
}
