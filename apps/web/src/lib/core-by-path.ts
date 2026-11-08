import { core } from "./core-api";

/**
 * The core client addressed by path, for routes its generated contract does not name yet
 * (integrations, tariff, investment, spot prices, the 3.x engine's own routes). The one untyped
 * door: each caller owns the shape of the answer it reads. Drop a route from here when
 * `core-api.gen.ts` names it.
 */
type Answer = { data?: unknown; error?: unknown; response?: Response };
type ByPath = Record<
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  (path: string, init?: unknown) => Promise<Answer>
>;
// Resolved per call: `core` may be replaced after this module loads (test doubles).
type Args = [path: string, init?: unknown];
const client = () => core as unknown as ByPath;
export const byPath = {
  GET: (...args: Args) => client().GET(...args),
  POST: (...args: Args) => client().POST(...args),
  PUT: (...args: Args) => client().PUT(...args),
  PATCH: (...args: Args) => client().PATCH(...args),
  DELETE: (...args: Args) => client().DELETE(...args),
};

/**
 * Whether the answer is a refusal. `error` alone is not enough: openapi-fetch reads an empty
 * error body (a bare 404) as `""`, so the status decides when there is no body to read.
 */
export function refused(answer: { error?: unknown; response?: Response }): boolean {
  return answer.error !== undefined || answer.response?.ok === false;
}
