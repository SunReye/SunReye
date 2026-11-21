// A drill-in level's key as the hash route names it (ADR 21): a level of its own, a record's id,
// or the list.

/** A record's level, by its id. */
export type IdKey = `${number}`;

const isId = (key: string): key is IdKey => /^\d+$/u.test(key);

/** The level `key` names among `named`, else a record's by its id; anything else is the list. */
export function levelKey<K extends string>(key: string, named: readonly K[]): K | IdKey | "list" {
  const isNamed = (k: string): k is K => named.some((n) => n === k);

  if (isNamed(key) || isId(key)) return key;

  return "list";
}
