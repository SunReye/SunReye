/**
 * Which origins Better Auth's CSRF/origin check may trust, per request.
 *
 * Kept out of ./index.ts, and free of the env and database it reads, so the
 * rules can be asserted directly: that module builds the Better Auth singleton
 * at import time and cannot be loaded without a database.
 *
 * A same-origin deployment cannot enumerate its origin in advance — the browser
 * reaches it at a Home Assistant hostname, a bare LAN IP, or through whatever
 * reverse proxy the user put in front. This used to be resolved by trusting an
 * `x-sunreye-proxied` header that the addon's nginx set and stripped from
 * client requests. That invariant only ever held where an nginx existed: the
 * standalone image is now the front door itself, and there nothing strips the
 * header, so anything able to set one header could take its Origin as trusted.
 *
 * The replacement asks whether the request is same-origin: does the `Origin`
 * the page came from match the `Host` it was sent to? Page script can set
 * NEITHER — both are forbidden header names — so a browser cannot make them
 * agree for a cross-site request, which is exactly the CSRF threat model. A
 * non-browser client can forge both, and gains nothing: CSRF needs a victim's
 * cookies, which only their browser has.
 */

/** Origin allow-list inputs, read from env by the caller. */
export interface OriginPolicy {
  /** Origin of a split-origin dashboard, when there is one. */
  corsOrigin: string | undefined;
  /** Extra origins to trust, e.g. an HTTPS reverse proxy. */
  trustedOrigins: readonly string[];
  isProduction: boolean;
}

/** Ports that are implied by the scheme, and so may be absent from `Host`. */
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

/**
 * `host:port` of an origin, with a scheme-default port dropped so it compares
 * equal to a `Host` that omits it. `null` for anything that is not a usable
 * origin — including the literal `"null"` a sandboxed iframe or a
 * redirect-crossed request sends, which names no document to trust.
 */
// fallow-ignore-next-line unused-export -- the origin-parsing boundary, asserted by trusted-origins.test.ts; test files aren't traced as consumers
export function originAuthority(origin: string | null): string | null {
  if (!origin || origin.trim() === "" || origin === "null") return null;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }

  return url.port && url.port === DEFAULT_PORTS[url.protocol] ? url.hostname : url.host;
}

/** Whether this request's `Origin` is the host it was actually sent to. */
// fallow-ignore-next-line unused-export -- the trust decision itself, asserted by trusted-origins.test.ts; test files aren't traced as consumers
export function sameOriginRequest(request: Request | undefined): boolean {
  const origin = originAuthority(request?.headers.get("origin") ?? null);
  if (origin === null) return false;

  // Deliberately not X-Forwarded-Host: a browser cannot set `Host`, but any
  // client can set a forwarding header, which would let one forge the match.
  const host = request?.headers.get("host")?.trim();
  return !!host && host === origin;
}

/** Origins trusted for `request`, in the order Better Auth should see them. */
export function trustedOriginsFor(request: Request | undefined, policy: OriginPolicy): string[] {
  const origins = policy.corsOrigin ? [policy.corsOrigin] : [];
  origins.push(...policy.trustedOrigins);

  // The dev dashboard moves port (Vite's fallback, editor port-forwarding).
  // Better Auth globs per URL segment, so `:*` matches only the port and never
  // crosses into another host — `localhostfake.com` stays rejected.
  if (!policy.isProduction) origins.push("*://localhost:*", "*://127.0.0.1:*");

  if (sameOriginRequest(request)) {
    const origin = request?.headers.get("origin");
    if (origin) origins.push(origin);
  }
  return origins;
}
