/**
 * What a failure on the generated `/api/v1` surface tells a third party.
 *
 * Elysia 2 replaced the `code` discriminant on the error hook with real Error
 * classes, and this is the one place in the engine that decided policy from
 * that code — so the mapping lives here, pure and tested, rather than inside
 * the hook where the only way to reach it is a live request.
 *
 * The policy: a caller's own mistake comes back described, and everything else
 * comes back bare. An internal stack trace in a response body is a leak to
 * every integrator, and the API key that reached this route is not a licence
 * to read the engine's internals.
 */
import { ParseError, ValidationError } from "elysia/error";

export interface EntityErrorResponse {
  status: number;
  body: { error: string; detail?: string };
  /** What to log, or `null` when the caller's own message already says it. */
  log: string | null;
}

export function entityErrorResponse(error: unknown): EntityErrorResponse {
  // `status` is the class's own (422 / 400) rather than a number restated here.
  if (error instanceof ValidationError) {
    const detail = error.message;
    return { status: error.status, body: { error: "Validation failed", detail }, log: null };
  }
  if (error instanceof ParseError) {
    return { status: error.status, body: { error: "Malformed request body" }, log: null };
  }
  return {
    status: 500,
    body: { error: "Internal server error" },
    log: error instanceof Error ? (error.stack ?? error.message) : String(error),
  };
}
