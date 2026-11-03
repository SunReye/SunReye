import createClient from "openapi-fetch";
import type { paths } from "./core-api.gen";
import { serverUrl } from "./server-url";
import { bounceOnUnauthorized } from "./session-expiry";

/**
 * Typed client for the Rust core's REST surface (types generated from its OpenAPI
 * document, see `scripts/gen-core-api.ts`).
 *
 * `credentials: "include"` keeps the session cookie on requests once the core has accounts.
 */
export const core = createClient<paths>({ baseUrl: serverUrl, credentials: "include" });

core.use({
  onResponse({ response, schemaPath }) {
    // The auth routes answer 401 as an ordinary result: the session probe reads it as an
    // anonymous visitor (kiosk view included), and a refused sign-in belongs to its form.
    if (!schemaPath.startsWith("/api/auth/")) bounceOnUnauthorized(response);
  },
});
