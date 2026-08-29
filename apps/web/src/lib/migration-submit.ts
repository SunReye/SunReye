/**
 * WHICH SLUGS A SUBMIT MAY CARRY.
 *
 * A rule, not plumbing, which is why it is here and not inline in the form's
 * `submit`:
 *
 *  * Nothing at all once the window has closed. The server refuses a slug change
 *    after the Home Assistant announcement (`slug_frozen`), and a client that sent
 *    one anyway would turn a finished form into a 409 the operator cannot act on.
 *  * Only what actually CHANGED. An equal slug is a no-op to the server, but
 *    sending it makes the one write that can never be undone indistinguishable, in
 *    the log, from a no-op resubmit of an untouched form.
 */

/** The slugs a submit is proposing, and the ones already on disk. */
export interface SlugSubmission {
  editable: boolean;
  plantSlug: string;
  deviceSlug: string;
  current: { plantSlug: string; deviceSlug: string };
}

/** The slug fields to include in the request body — often none. */
export function slugFields(input: SlugSubmission): {
  plantSlug?: string;
  deviceSlug?: string;
} {
  if (!input.editable) return {};
  return {
    ...(input.plantSlug === input.current.plantSlug ? {} : { plantSlug: input.plantSlug }),
    ...(input.deviceSlug === input.current.deviceSlug ? {} : { deviceSlug: input.deviceSlug }),
  };
}

/** A refused submit, in the shape the form renders. */
export type ConfirmResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> }
  | { ok: false; message: string };

/** Field errors out of the server's 400 body, ignoring anything unexpected. */
function fieldErrors(value: unknown): Record<string, string> {
  const entries = typeof value === "object" && value !== null ? Object.entries(value) : [];
  return Object.fromEntries(entries.filter(([, message]) => typeof message === "string"));
}

/**
 * What a refused submit means, from whatever the client hands back.
 *
 * FIELD ERRORS WIN over the summary message. A 400 names the fields, and showing
 * the sentence instead would put the reason somewhere other than beside the input
 * that caused it — on a form whose two fields are both required and both about to
 * be frozen.
 *
 * A 409 has no field to blame (`slug_frozen`, `onboarding_closed`), so its message
 * is the whole answer. Anything with neither degrades to the status code, which is
 * ugly but is at least a thing the operator can quote.
 */
export function refusalOf(error: { status?: unknown; value?: unknown }): ConfirmResult {
  const body = error.value as { errors?: unknown; message?: unknown } | null;
  const errors = fieldErrors(body?.errors);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const message = body?.message;
  return { ok: false, message: typeof message === "string" ? message : String(error.status) };
}
