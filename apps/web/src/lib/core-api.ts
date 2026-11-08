import createClient from "openapi-fetch";
import type { paths } from "./core-api.gen";
import { serverUrl } from "./server-url";
import { bounceOnUnauthorized } from "./session-expiry";

/**
 * A range the instance cannot answer COMPLETELY comes back as a 422 naming the oldest instant it
 * could have started at. Noticed here and nowhere else: call sites destructure only `data`, so a
 * refusal would otherwise arrive as `undefined` and paint an empty chart.
 *
 * `clone()`, because the client parses this body itself and a stream reads once. Fire-and-forget:
 * nothing in a middleware may await, and the banner may appear a tick after the empty chart.
 */
function noticeIncompleteRange(response: Response): void {
  if (response.status !== 422) return;
  void response
    .clone()
    .json()
    .then(async (body: unknown) => {
      const { historyIncomplete } = await import("$lib/history-incomplete.svelte");
      historyIncomplete.observe(422, body);
    })
    // A 422 with a non-JSON body is somebody else's 422.
    .catch(() => {});
}

/**
 * Typed client for the Rust core's REST surface (types generated from its OpenAPI
 * document, see `scripts/gen-core-api.ts`).
 *
 * `credentials: "include"` keeps the session cookie on requests once the core has accounts.
 */
export const core = createClient<paths>({
  baseUrl: serverUrl,
  credentials: "include",
  // Late-bound: openapi-fetch otherwise captures `globalThis.fetch` at creation.
  fetch: (request) => globalThis.fetch(request),
});

core.use({
  onResponse({ response, schemaPath }) {
    // The auth routes answer 401 as an ordinary result: the session probe reads it as an
    // anonymous visitor (kiosk view included), and a refused sign-in belongs to its form.
    if (!schemaPath.startsWith("/api/auth/")) bounceOnUnauthorized(response);
    noticeIncompleteRange(response);
  },
});
