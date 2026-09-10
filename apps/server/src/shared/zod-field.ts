/**
 * PARSING A SETTINGS BODY, AND NAMING THE FIELD THAT FAILED — what
 * `../devices/device-admin.ts` and `../integrations/integration-admin.ts` share
 * at the top of every write.
 *
 * A refusal that names its field is what lets the dialog put the message under
 * the control the operator typed in; one that does not is a red banner with no
 * way to tell which of nine inputs is wrong. Both services therefore take the
 * first issue, read the top-level path segment, and check it against the set of
 * fields their own error class can name.
 *
 * Shared because that check is the load-bearing half and is easy to get subtly
 * wrong. A path head can be a NUMBER (an array index, `arrays.0.kwp`), so a bare
 * `String(head)` reports the field as "0" and the dialog highlights nothing; a
 * nested path's head is the OUTER field, which is the one the form has a control
 * for; and a `.refine` on the whole object has no path at all, which must come
 * back as "no field" rather than as the first key of the schema.
 *
 * THE ERROR IS A CALLBACK, not a class this module knows. The two services
 * refuse with different types, name different fields and phrase the prefix
 * differently (the device roster says "unit id", not "unitId"). What is common
 * is the extraction, not the sentence.
 */

import type { z } from "zod";

/**
 * The first issue's message, and the top-level field it names — `undefined`
 * when it names none of `fields`.
 *
 * FIRST issue only, deliberately: the caller throws one refusal with one field,
 * and a list of every violated rule would be a message no dialog can place.
 */
function firstIssue<F extends string>(
  error: z.ZodError,
  fields: ReadonlySet<F>,
): { message: string; field: F | undefined } {
  const issue = error.issues[0];
  const head = issue?.path[0];
  const field = typeof head === "string" && fields.has(head as F) ? (head as F) : undefined;
  return { message: issue?.message ?? "invalid body", field };
}

/** Parse a body, or throw whatever `refuse` makes of the first issue. */
export function parseBody<T, F extends string>(
  schema: z.ZodType<T>,
  body: unknown,
  fields: ReadonlySet<F>,
  refuse: (message: string, field: F | undefined) => Error,
): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const { message, field } = firstIssue(result.error, fields);
  throw refuse(message, field);
}
