// What every group of the core's client shares: the generated client and refusals (ADR 9).
import type createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type Client = ReturnType<typeof createClient<paths>>;

export type ProblemDetails = components["schemas"]["ProblemDetails"];

/** A refusal's stable code (ADR 9), such as `auth.required`. */
export interface Problem {
  readonly problem: string;
}

/** A proxy in front of the core may refuse with a body that is no JSON; its status stands in. */
export function refusal(error: Readonly<ProblemDetails> | string, status: number): Problem {
  return { problem: error instanceof Object ? error.code : `http.${status}` };
}

/** Undefined for a success without a body, else why it was refused. */
export function done(
  error: Readonly<ProblemDetails> | string | undefined,
  response: Readonly<Pick<Response, "ok" | "status">>,
): Problem | undefined {
  return response.ok ? undefined : refusal(error ?? "", response.status);
}
