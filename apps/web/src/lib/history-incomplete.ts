/**
 * RECOGNISING THE SERVER'S "I CANNOT ANSWER THAT WINDOW COMPLETELY".
 *
 * The server already refuses such a range rather than answering it
 * (`apps/server/src/shared/history-horizon.ts`, and `guardRange` in its
 * `index.ts`): a month-to-date figure whose window opens before the retention
 * horizon — or before a pending 1.2.0 migration's cutover — is a real number
 * computed over a fraction of the range it claims, and it renders exactly like a
 * complete one. Issue #154 asks for the same thing from the retention end.
 *
 * That refusal is a 422 with a body naming the oldest instant that CAN be
 * answered. Until this module existed, nothing on the client read it: every one of
 * the ten or so `const { data } = await api.api.history…` call sites destructures
 * only `data`, so a refused read arrived as `undefined` and painted an EMPTY chart.
 * Which is the defect back again in its quietest form — the operator sees "no
 * data" where the truth is "this window cannot be answered, and here is from when
 * it can".
 *
 * ## Why it is recognised in ONE place
 *
 * Retrofitting ten call sites would leave the eleventh silent. `$lib/api.ts`'s
 * `onResponse` hook sees every response the typed client makes, so the refusal is
 * noticed there and surfaced by the app-wide banner — the same slot the migration
 * notice uses. That is what "solve it once, for both causes" means here: one
 * detector, one renderer, and no call site has to opt in.
 *
 * This module is the pure half so it can be tested without a fetch.
 */

/** The oldest instant a tier can answer, and which tier was asked. */
export interface IncompleteRange {
  /** Why: the retention policy dropped it, or a migration has not carried it. */
  reason: string;
  /** ISO instant — the oldest the request COULD have started at. */
  from: string;
  /** `raw` | `minute` | `hour` | `day`: whose horizon this is. */
  tier: string;
  /** The server's own sentence. Shown when there is nothing better to say. */
  message: string;
}

/** The `error` discriminator the server sends. Matched exactly, never by status. */
const MARKER = "history_incomplete";

/**
 * The refusal this response carries, or `null` for anything else.
 *
 * Keyed on the BODY's `error` field and not on the status code alone: 422 is a
 * perfectly ordinary validation failure elsewhere in this API, and turning one of
 * those into "your history is missing" would send an operator hunting for a
 * migration button over a mistyped date.
 *
 * Every field is checked for type. The body arrives from the network, and a
 * `from` that is not a string would reach `new Date(undefined)` and render
 * "Invalid Date" as the date the operator is meant to act on.
 */
export function incompleteRangeFrom(status: number, body: unknown): IncompleteRange | null {
  if (status !== 422 || typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (candidate.error !== MARKER) return null;
  if (typeof candidate.from !== "string" || Number.isNaN(Date.parse(candidate.from))) return null;
  return {
    reason: typeof candidate.reason === "string" ? candidate.reason : "unknown",
    from: candidate.from,
    tier: typeof candidate.tier === "string" ? candidate.tier : "unknown",
    message: typeof candidate.message === "string" ? candidate.message : "",
  };
}

/**
 * The identity of a notice, for de-duplication.
 *
 * A dashboard mount fires a dozen range reads at once and several of them fail
 * the same way. Twelve copies of one sentence is a banner nobody reads, so the
 * pair that actually distinguishes two DIFFERENT problems — the tier and the
 * boundary — is the key. The reason is not part of it: the same boundary reported
 * with two reasons is one problem described twice.
 */
// fallow-ignore-next-line unused-export -- read by `withNotice` in this file and asserted directly by ./history-incomplete.test.ts (the key is what stops a dozen identical refusals becoming a dozen banner lines); test files are not traced as consumers.
export function noticeKey(notice: IncompleteRange): string {
  return `${notice.tier} ${notice.from}`;
}

/**
 * Fold a new notice into the ones already showing.
 *
 * Returns the SAME array when nothing changed, so a store assigning the result
 * does not re-render the banner on every duplicate — which, at a dozen refused
 * reads per page load, is the difference between one paint and a dozen.
 */
export function withNotice(
  notices: readonly IncompleteRange[],
  notice: IncompleteRange,
): readonly IncompleteRange[] {
  const key = noticeKey(notice);
  return notices.some((existing) => noticeKey(existing) === key) ? notices : [...notices, notice];
}
