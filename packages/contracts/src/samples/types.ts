/**
 * Per-value provenance — where one number in a sample came from.
 *
 * NOT a new concept: `ChargePowerSource` in `../evcc/types.ts` has carried
 * exactly this hint for exactly one field since EVCC's live-charge-power work,
 * and it was validated against a real instance. This is that type, promoted to
 * the sample model so every device can state it, and `ChargePowerSource` is now
 * an alias of it. A second, parallel "staleness" concept beside this one is the
 * thing this file exists to prevent.
 *
 * WHY IT IS LOAD-BEARING AND NOT DECORATION
 *
 * `measured` is a reading. `estimated` is an attribution (EVCC's charge power
 * inferred from the 1 Hz house-load residual) and `feedforward` is a prediction
 * of a command's effect that no device has confirmed yet. Both are the right
 * thing to PAINT — they are why a wallbox tile moves the instant you press a
 * button — and the wrong thing to STORE: a five-year hypertable that cannot tell
 * a guess from a reading is a history of what we guessed. So the write seam
 * (`apps/server/src/inverter/device-writer.ts`) persists the measured values of
 * a sample and nothing else.
 *
 * Absent provenance means `measured`, so a device that states nothing — every
 * Modbus profile, every poll loop — is unaffected.
 */
export type ValueProvenance = "measured" | "estimated" | "feedforward";

/**
 * One sample's provenance, keyed by metric key. Sparse: a key not named is
 * {@link ValueProvenance} `"measured"`.
 */
export type SampleProvenance = Readonly<Record<string, ValueProvenance>>;
