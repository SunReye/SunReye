/**
 * Reading a `jsonb` value that may not be the shape it looks like.
 *
 * Its own module, and neutral, because BOTH the 1.x settings mining
 * (`./plant-repo.ts`'s `readRawSetting`) and the 1.2.0 -> 2.0.0 migration record
 * (`./upgrade-120-run.ts`) have to survive it, and neither is the natural owner of
 * a rule about how a driver encodes a parameter.
 */
/**
 * A jsonb value that may be wrapped in a JSON string, unwrapped once.
 *
 * A `jsonb` column can hold `"{\"a\":1}"` — a JSON STRING whose content is a
 * document — and it is not a hypothetical: bun's `SQL` produces exactly that when
 * a JS string is bound to a jsonb destination (see `./upgrade-120-run.ts`'s
 * `writeMigrationRecord`), which is why every `app_settings` row in
 * `scripts/fixture-1-2-0.ts`'s 1.2.0 database is double-encoded. Treating one as
 * "not an object" reads a fully-populated setting as absent.
 *
 * ONE level of unwrapping, not a loop: a document nested twice is a bug nobody
 * should be able to hide behind this, and a string that is not JSON at all is a
 * legitimate setting value (a time zone, a bidding zone) that must come back as
 * itself rather than as `null`.
 */
export function jsonDocument(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
