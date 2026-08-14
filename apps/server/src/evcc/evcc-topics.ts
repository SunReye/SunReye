/**
 * EVCC's MQTT topic grammar and payload encoding — the pure half of the ingest
 * in {@link ./evcc}.
 *
 * Kept separate (and free of any client/state) because it is the part of the
 * EVCC contract that has to be exactly right and is worth pinning down in
 * tests: which topics are loadpoint or vehicle state, which are command echoes,
 * and how a leaf payload string maps onto a primitive.
 */

/** A coerced EVCC topic payload (leaf values are JSON-ish primitives). */
export type EvccValue = string | number | boolean | null;

/**
 * Split `<root>/<section>/<id>/<key…>` into the entity id and its (possibly
 * nested) key. Returns `null` for anything else under the root — including the
 * retained section-count topic (`<root>/loadpoints`), a bare id with no leaf,
 * and `.../set` command echoes.
 *
 * Shared by the loadpoint and vehicle grammars: EVCC lays both out identically,
 * differing only in how the id segment is interpreted.
 */
function parseSectionTopic(
  topicRoot: string,
  section: string,
  topic: string,
): { id: string; key: string } | null {
  const prefix = `${topicRoot}/${section}/`;
  if (!topic.startsWith(prefix)) return null;
  const [head, ...rest] = topic.slice(prefix.length).split("/");
  if (!head || rest.length === 0) return null;
  if (rest[rest.length - 1] === "set") return null;
  return { id: head, key: rest.join("/") };
}

/**
 * Parse a loadpoint state topic into its 1-based index and (possibly nested)
 * key. Returns `null` for anything else under the root — including the
 * retained `<root>/loadpoints` count topic and `.../set` command echoes.
 */
export function parseLoadpointTopic(
  topicRoot: string,
  topic: string,
): { index: number; key: string } | null {
  const parsed = parseSectionTopic(topicRoot, "loadpoints", topic);
  if (!parsed) return null;
  const index = Number(parsed.id);
  if (!Number.isInteger(index) || index < 1) return null;
  return { index, key: parsed.key };
}

/**
 * Parse a vehicle state topic into its config name (the EVCC config slug, e.g.
 * `tesla_ble`) and (possibly nested) key. Same shape as the loadpoint grammar,
 * with a string id instead of an index.
 */
export function parseVehicleTopic(
  topicRoot: string,
  topic: string,
): { name: string; key: string } | null {
  const parsed = parseSectionTopic(topicRoot, "vehicles", topic);
  return parsed && { name: parsed.id, key: parsed.key };
}

/**
 * Coerce a raw payload string into a primitive: numbers and booleans become
 * typed, `null`/empty become null, everything else stays a string (JSON
 * blobs like plan arrays are kept verbatim — the snapshot ignores them).
 */
export function coercePayload(raw: string): EvccValue {
  const s = raw.trim();
  if (s === "" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  // Number() accepts "" (handled above) and whitespace, but not "1x" — exactly
  // the numeric-or-not test needed here.
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}
