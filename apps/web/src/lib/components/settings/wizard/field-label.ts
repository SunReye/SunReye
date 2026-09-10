/**
 * WHAT A CATALOG FIELD IS CALLED, for the fields this build knows.
 *
 * The catalog describes a field's SHAPE — its type, its bounds, its default —
 * and deliberately not its prose: a server that shipped a translation would be
 * shipping five of them, and the locale a viewer reads is the web app's
 * business. The field NAME is the join, and this table is the web half of it.
 *
 * The names come from the server, so a build can meet one it has never heard of
 * — a newer server, an integration added after this build shipped. That is not
 * an error and must not render a blank label: the raw name is a worse label
 * than a sentence and a far better one than nothing.
 *
 * Spelled out rather than indexed by a computed key: an index into the message
 * module is a cast, and a cast would hide the day one of these stops existing.
 *
 * A `Map` rather than an object literal, for the reason `devices/coded.ts` gives
 * about the same trap: the key arrives from outside, and against an object a
 * field named `constructor` resolves to a function and renders as source code.
 */

import * as m from "$lib/paraglide/messages";

const FIELD_LABELS = new Map<string, () => string>([
  ["topicRoot", m.wizard_field_topicRoot],
  ["topicPrefix", m.wizard_field_topicPrefix],
  ["haDiscoveryEnabled", m.wizard_field_haDiscoveryEnabled],
  ["haDiscoveryPrefix", m.wizard_field_haDiscoveryPrefix],
]);

/** The field's label in the viewer's locale, or its raw name when unknown. */
export function fieldLabel(field: string): string {
  const label = FIELD_LABELS.get(field);
  return label === undefined ? field : label();
}
