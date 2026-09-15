/**
 * WHAT A FAILED REQUEST SAYS — the one reader for an Eden failure body.
 *
 * The settings forms all report failures the same way: Elysia sends
 * `status(4xx, { error })` and better-auth sends `{ message }`, so the readable
 * text always sits one level inside `error.value`. `error.value` itself must
 * NEVER be shown — it is an object, and `String(…)` renders it "[object
 * Object]". Measured: a Solarman connection test against a unit id nothing
 * answers on showed "Fehlgeschlagen: [object Object]" where the server had said
 * "Timed out".
 *
 * Lives in `$lib` rather than under `components/settings`, because a failed
 * request is not a settings concern — the setup route and the device dialogs
 * read the same bodies.
 */

/** The `key` field of `value`, when it is a non-empty string. */
function stringField(value: unknown, key: string): string | undefined {
  const field = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof field === "string" && field !== "" ? field : undefined;
}

/**
 * The fields a failure body names its reason in, in the order they are trusted:
 * our own routes' `{ error }` first, then Elysia's validation `summary`, then a
 * serialised Error's `message` (which better-auth also sends).
 */
const REASON_FIELDS = ["error", "summary", "message"];

/** The first of {@link REASON_FIELDS} this body carries, or null. */
function reasonOf(value: object): string | null {
  for (const key of REASON_FIELDS) {
    const text = stringField(value, key);
    if (text !== undefined) return text;
  }
  return null;
}

/** The JSON of a body that names itself in no other way — never "[object Object]". */
function serialised(value: object): string | null {
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    // Cyclic, or a getter that throws: there is nothing readable here.
    return null;
  }
}

/**
 * The reason a request failed, or `fallback` when the body carries none — a
 * dead connection, a CORS refusal, a server that never answered.
 */
export function apiErrorText(value: unknown, fallback: string): string {
  if (value === null || value === undefined) return fallback;
  // Covers a plain-text body, which is already its own reason.
  if (typeof value !== "object") return String(value) || fallback;
  return reasonOf(value) ?? serialised(value) ?? fallback;
}

/** Text of a better-auth `{ message }` payload, else `fallback`. */
export function apiMessageText(value: unknown, fallback: string): string {
  return stringField(value, "message") ?? fallback;
}
