/**
 * Normalize an Eden response body into "the payload, or nothing".
 *
 * Elysia serializes a handler that returns `null` (weather disabled, no
 * forecast configured, no data yet) as an **empty body with no content-type**,
 * and Eden hands that back as the string `""`. `data ?? null` keeps it — `""`
 * is not nullish — so a `!== null` guard reads it as data and the component
 * renders against a string: `${Math.round(undefined)}${undefined}` prints
 * "NaN undefined".
 *
 * Anything that is not an object (or array) is therefore not a payload. Callers
 * that legitimately read a scalar body must not use this.
 */
export function payloadOrNull<T>(data: unknown): T | null {
  return typeof data === "object" && data !== null ? (data as T) : null;
}
