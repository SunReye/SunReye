// What every group of the core's client shares: the generated client and refusals (ADR 9).
import createClient from "openapi-fetch";
import { sharing } from "./in-flight";
import type { components, paths } from "./schema";

export type { components };

export type Client = ReturnType<typeof createClient<paths>>;

/** The generated client over `fetch`, its paths resolved under `base`; a range read in flight is
 * shared with the same read asked meanwhile. */
export function open(base: string, fetch: (request: Request) => Promise<Response>): Client {
  return createClient<paths>({ baseUrl: base, fetch: sharing(fetch) });
}

export type ProblemDetails = components["schemas"]["ProblemDetails"];

/** A refusal's stable code (ADR 9), such as `auth.required`, and the request body's member at
 * fault where the core names it, as a JSON pointer such as `/strings/0/modules`. */
export interface Problem {
  readonly problem: string;
  readonly pointer?: string;
}

/** A proxy in front of the core may refuse with a body that is no JSON; its status stands in. */
export function refusal(error: Readonly<ProblemDetails> | string, status: number): Problem {
  if (!(error instanceof Object)) return { problem: `http.${status}` };

  const { code, pointer } = error;

  return pointer === undefined || pointer === null ? { problem: code } : { problem: code, pointer };
}

/** Undefined for a success without a body, else why it was refused. */
export function done(
  error: Readonly<ProblemDetails> | string | undefined,
  response: Readonly<Pick<Response, "ok" | "status">>,
): Problem | undefined {
  return response.ok ? undefined : refusal(error ?? "", response.status);
}
