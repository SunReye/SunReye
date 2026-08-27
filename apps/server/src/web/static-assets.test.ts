import { describe, expect, it } from "bun:test";
import { resolveAsset } from "./static-assets";

/** The header values the addon's nginx sent, asserted literally on purpose. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PAGE_CACHE_CONTROL = "no-cache";

/** Stand-in for the generated manifest: url path → embedded file path. */
const manifest = new Set([
  "/index.html",
  "/favicon.svg",
  "/_app/immutable/entry/app.CAFEBABE.js",
  "/_app/immutable/assets/app.DEADBEEF.css",
]);

describe("resolveAsset", () => {
  it("serves the fallback page at the root, revalidated", () => {
    expect(resolveAsset(manifest, "/")).toEqual({
      key: "/index.html",
      cacheControl: PAGE_CACHE_CONTROL,
    });
  });

  it("serves a hashed bundle with a year-long immutable cache", () => {
    expect(resolveAsset(manifest, "/_app/immutable/entry/app.CAFEBABE.js")).toEqual({
      key: "/_app/immutable/entry/app.CAFEBABE.js",
      cacheControl: IMMUTABLE_CACHE_CONTROL,
    });
  });

  it("serves a non-hashed asset that exists, revalidated", () => {
    expect(resolveAsset(manifest, "/favicon.svg")).toEqual({
      key: "/favicon.svg",
      cacheControl: PAGE_CACHE_CONTROL,
    });
  });

  it("falls back to the page for a client route (hash router deep link)", () => {
    expect(resolveAsset(manifest, "/statistics")).toEqual({
      key: "/index.html",
      cacheControl: PAGE_CACHE_CONTROL,
    });
  });

  // A stale manifest must 404, never answer a script request with HTML: the
  // browser would parse the fallback page as JS and the app would die silently.
  it("404s a missing hashed bundle instead of falling back to the page", () => {
    expect(resolveAsset(manifest, "/_app/immutable/entry/app.OLDHASH.js")).toBeNull();
  });

  it("percent-decodes the path before lookup", () => {
    expect(resolveAsset(new Set(["/index.html", "/a b.svg"]), "/a%20b.svg")).toEqual({
      key: "/a b.svg",
      cacheControl: PAGE_CACHE_CONTROL,
    });
  });

  it("rejects a traversal attempt rather than resolving it", () => {
    expect(resolveAsset(manifest, "/_app/../../etc/passwd")).toBeNull();
    expect(resolveAsset(manifest, "/%2e%2e/etc/passwd")).toBeNull();
  });

  it("rejects a malformed escape instead of throwing", () => {
    expect(resolveAsset(manifest, "/%E0%A4%A")).toBeNull();
  });

  // Without the build output embedded there is nothing to serve; the route must
  // decline so the API-only binary still answers /api and /healthz.
  it("returns null for every path when nothing is embedded", () => {
    expect(resolveAsset(new Set<string>(), "/")).toBeNull();
    expect(resolveAsset(new Set<string>(), "/statistics")).toBeNull();
  });
});
