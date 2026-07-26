// The settings forms all report failures the same way: Elysia sends
// `status(4xx, { error })` and better-auth sends `{ message }`, so the readable
// text always sits one level inside `error.value`. `error.value` itself must
// never be shown — it is an object and stringifies to "[object Object]".

/** The `key` field of `value`, when it is a string. */
function stringField(value: unknown, key: "error" | "message"): string | undefined {
  const field = (value as Record<string, unknown> | null | undefined)?.[key];
  return typeof field === "string" ? field : undefined;
}

/** Text of an Elysia `{ error }` payload, else `fallback`. */
export function apiErrorText(value: unknown, fallback: string): string {
  return stringField(value, "error") ?? fallback;
}

/** Text of a better-auth `{ message }` payload, else `fallback`. */
export function apiMessageText(value: unknown, fallback: string): string {
  return stringField(value, "message") ?? fallback;
}

/** Like {@link apiErrorText}, but a plain string `value` is already the message. */
export function apiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  return apiErrorText(value, fallback);
}
