import { Elysia } from "elysia";
import { contentTypeFor } from "./asset-pack";
import { PACKED_ENCODINGS, negotiateEncoding, variantKey } from "./encoding";
import { resolveAsset } from "./static-assets";

/**
 * Path prefixes the engine owns. An unmatched request under one of them must
 * 404 rather than fall through to the SPA page — a 200 of HTML would turn an
 * API typo into a parse error at the Eden client instead of an error response.
 */
const ENGINE_PREFIXES = ["/api", "/openapi", "/ws", "/healthz"];

const isEnginePath = (pathname: string): boolean =>
  ENGINE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * Serves the SvelteKit build embedded in the binary — the role the addon's
 * nginx `location /` used to play.
 *
 * Registered with `.all`, not `.get`, and that is not a style choice: a GET
 * wildcard outranks the engine's method-agnostic `.all("/api/auth/*")` mount
 * and swallowed every session read (sign-in returned 200, then the dashboard
 * sat permanently logged out). Matching every method leaves the router to
 * decide on path specificity, where the engine's longer prefixes win.
 *
 * Serving from an `onError` NOT_FOUND hook fixes the precedence too, but then
 * the request logger reports every asset request as a 404 error before the hook
 * answers it — routing has to succeed for the log to stay readable.
 */
export function webRoutes(assets: ReadonlyMap<string, Uint8Array>) {
  const manifest = new Set(assets.keys());

  return new Elysia({ name: "web-routes" }).all("/*", ({ path, request, status }) => {
    if (request.method !== "GET" && request.method !== "HEAD") return status(404, "Not found");
    if (isEnginePath(path)) return status(404, "Not found");

    const hit = resolveAsset(manifest, path);
    if (!hit) return status(404, "Not found");

    // Precompressed variants were built at pack time; pick one the client
    // accepts, else hand back the raw bytes.
    const available = new Set(
      PACKED_ENCODINGS.filter((encoding) => manifest.has(variantKey(encoding, hit.key))),
    );
    const encoding = negotiateEncoding(request.headers.get("accept-encoding"), available);
    const key = encoding ? variantKey(encoding, hit.key) : hit.key;

    // A HEAD reply carries the headers and no body. `.get` used to give this
    // for free; `.all` matches HEAD itself, so the body has to be dropped here.
    const body = request.method === "HEAD" ? null : (assets.get(key) as Uint8Array<ArrayBuffer>);
    return new Response(body, {
      headers: {
        // The type is the asset's own — content-encoding describes the wrapper.
        "content-type": contentTypeFor(hit.key),
        "cache-control": hit.cacheControl,
        // Sent even when nothing was compressed: a shared cache that stored an
        // identity reply must not later hand it to a client expecting gzip, or
        // the reverse.
        vary: "Accept-Encoding",
        ...(encoding ? { "content-encoding": encoding } : {}),
      },
    });
  });
}
