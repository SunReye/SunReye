import { describe, expect, it } from "bun:test";
import { originAuthority, sameOriginRequest, trustedOriginsFor } from "./trusted-origins";

const POLICY = { corsOrigin: undefined, trustedOrigins: [], isProduction: true } as const;

/** A request as a browser sends it: Origin and Host are both unforgeable there. */
const req = (headers: Record<string, string>) =>
  new Request("http://internal/api/auth/sign-in/email", { method: "POST", headers });

describe("originAuthority", () => {
  it("reduces an origin to host:port", () => {
    expect(originAuthority("http://192.168.1.50:3000")).toBe("192.168.1.50:3000");
  });

  // A default port is omitted by the browser in Origin but may be spelled out
  // in Host, or the reverse — the two must still compare equal.
  it("drops the default port for the scheme", () => {
    expect(originAuthority("http://example.com:80")).toBe("example.com");
    expect(originAuthority("https://example.com:443")).toBe("example.com");
  });

  it("keeps a non-default port", () => {
    expect(originAuthority("https://example.com:8443")).toBe("example.com:8443");
  });

  // Sandboxed iframes and some redirect-crossed requests send the literal
  // string "null". Treating it as an origin would trust an unknown document.
  it("refuses the literal null origin", () => {
    expect(originAuthority("null")).toBeNull();
  });

  it("refuses what is not an origin at all", () => {
    for (const value of ["", "   ", "not a url", "/relative", null]) {
      expect(originAuthority(value)).toBeNull();
    }
  });
});

describe("sameOriginRequest", () => {
  // Neither header can be set by page script — both are forbidden header
  // names — so agreement between them is exactly "the browser sent this to the
  // host the page came from", which is what the CSRF check needs to know.
  it("accepts an origin that matches the host it was sent to", () => {
    expect(
      sameOriginRequest(req({ origin: "http://192.168.1.50:3000", host: "192.168.1.50:3000" })),
    ).toBe(true);
  });

  it("accepts a default-port origin against a bare host", () => {
    expect(sameOriginRequest(req({ origin: "http://ha.local", host: "ha.local" }))).toBe(true);
  });

  it("rejects a cross-site origin", () => {
    expect(
      sameOriginRequest(req({ origin: "http://evil.example", host: "192.168.1.50:3000" })),
    ).toBe(false);
  });

  // The attack this is here to stop: same registrable domain, different host.
  it("rejects a different host on the same domain", () => {
    expect(sameOriginRequest(req({ origin: "http://evil.ha.local", host: "ha.local" }))).toBe(
      false,
    );
  });

  it("rejects a matching host on a different port", () => {
    expect(sameOriginRequest(req({ origin: "http://ha.local:9999", host: "ha.local:3000" }))).toBe(
      false,
    );
  });

  it("declines when either header is missing", () => {
    expect(sameOriginRequest(req({ origin: "http://ha.local" }))).toBe(false);
    expect(sameOriginRequest(req({ host: "ha.local" }))).toBe(false);
    expect(sameOriginRequest(undefined)).toBe(false);
  });
});

describe("trustedOriginsFor", () => {
  // The deployment this exists for: a reverse proxy (HA ingress) or a LAN IP,
  // where the hostname cannot be enumerated in advance.
  it("trusts a same-origin request's own origin", () => {
    const origins = trustedOriginsFor(
      req({ origin: "http://ha.local:8123", host: "ha.local:8123" }),
      POLICY,
    );
    expect(origins).toContain("http://ha.local:8123");
  });

  it("does not trust a cross-site origin", () => {
    const origins = trustedOriginsFor(
      req({ origin: "http://evil.example", host: "ha.local" }),
      POLICY,
    );
    expect(origins).not.toContain("http://evil.example");
  });

  // The header this replaces was set by our nginx and stripped from client
  // requests. Nothing strips it in the standalone image, where the binary is
  // the front door, so it must not be a trust signal any more.
  it("ignores x-sunreye-proxied entirely", () => {
    const origins = trustedOriginsFor(
      req({ origin: "http://evil.example", host: "ha.local", "x-sunreye-proxied": "1" }),
      POLICY,
    );
    expect(origins).not.toContain("http://evil.example");
  });

  it("keeps the configured split-origin web app", () => {
    const origins = trustedOriginsFor(undefined, {
      corsOrigin: "https://dash.example",
      trustedOrigins: ["https://proxy.example"],
      isProduction: true,
    });
    expect(origins).toEqual(["https://dash.example", "https://proxy.example"]);
  });

  // Vite's fallback port and editor port-forwarding move the dev origin around.
  it("trusts any localhost port outside production", () => {
    const origins = trustedOriginsFor(undefined, { ...POLICY, isProduction: false });
    expect(origins).toContain("*://localhost:*");
    expect(origins).toContain("*://127.0.0.1:*");
  });

  it("adds no localhost glob in production", () => {
    expect(trustedOriginsFor(undefined, POLICY)).toEqual([]);
  });
});
