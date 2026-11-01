import createClient from "openapi-fetch";
import type { paths } from "./core-api.gen";
import { serverUrl } from "./server-url";

/**
 * Typed client for the Rust core's REST surface (types generated from its OpenAPI
 * document, see `scripts/gen-core-api.ts`).
 *
 * `credentials: "include"` keeps the session cookie on requests once the core has accounts.
 */
export const core = createClient<paths>({ baseUrl: serverUrl, credentials: "include" });
