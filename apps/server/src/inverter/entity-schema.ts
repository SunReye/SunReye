/**
 * The write contract of one generated `/api/v1` entity route, derived from the
 * entity's constraint: the TypeBox validator a request body must satisfy, and
 * the human-readable value envelope that goes into the OpenAPI description.
 *
 * Pure (constraint in, schema/string out) and unit-tested, because this is
 * exactly what third-party integrators see and what rejects their writes.
 */

import type { EntityConstraint } from "@SunReye/inverter-core";
import { t } from "elysia";

/** Inclusive numeric bounds a constraint declares, as TypeBox options. */
function numberBounds(c: EntityConstraint): { minimum?: number; maximum?: number } {
  const bounds: { minimum?: number; maximum?: number } = {};
  if (c.min !== undefined) bounds.minimum = c.min;
  if (c.max !== undefined) bounds.maximum = c.max;
  return bounds;
}

/** TypeBox validator for a writable entity's value, from its constraint. */
export function valueSchema(c: EntityConstraint) {
  if (c.valueType === "enum" && c.enumValues && c.enumValues.length > 0) {
    return t.Union(c.enumValues.map((v) => t.Literal(v)));
  }
  return t.Number(numberBounds(c));
}

/** Bounded-range note, with the entity's unit appended when it has one. */
const boundsNote = (c: EntityConstraint, unit: string | null): string =>
  `Range: ${c.min ?? "-∞"}..${c.max ?? "∞"}${unit ? ` ${unit}` : ""}.`;

/** Enum note listing the raw values the entity accepts. */
const enumNote = (c: EntityConstraint): string => `Allowed values: ${c.enumValues?.join(", ")}.`;

/** What values this entity accepts, for its route's OpenAPI description. */
export function rangeNote(c: EntityConstraint, unit: string | null): string {
  if (c.valueType === "enum") return enumNote(c);
  if (c.min === undefined && c.max === undefined) return "Unbounded numeric value.";
  return boundsNote(c, unit);
}
