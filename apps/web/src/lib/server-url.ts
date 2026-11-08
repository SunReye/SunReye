import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";

/**
 * Base URL of the core engine, resolved once at startup.
 *
 * Priority:
 * 1. `PUBLIC_SERVER_URL` — runtime env via `$env/dynamic/public` (adapter-node
 *    reads it when the container starts; nothing is inlined at build time).
 *    For split-origin deployments where the engine lives on another origin.
 * 2. Same-origin default: the directory of the current document URL. This
 *    keeps reverse-proxy path prefixes intact — under Home Assistant ingress
 *    the app is served at `https://<ha>/api/hassio_ingress/<token>/`, and both
 *    fetch and the ws(s):// URL derived from it must stay under that prefix.
 *
 * The trailing slash is stripped because openapi-fetch and the `/ws` URL join
 * paths with a leading `/`.
 */
function resolveServerUrl(): string {
  if (env.PUBLIC_SERVER_URL) return env.PUBLIC_SERVER_URL.replace(/\/+$/, "");
  // The SSR pass only renders the empty shell (`ssr = false` in the root
  // layout) and never calls the API; any syntactically valid base will do.
  if (!browser) return "http://localhost:3000";
  return new URL(".", location.href).href.replace(/\/+$/, "");
}

export const serverUrl = resolveServerUrl();
