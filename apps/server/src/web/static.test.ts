import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { variantKey } from "./encoding";

/** The header values the addon's nginx sent, asserted literally on purpose. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const PAGE_CACHE_CONTROL = "no-cache";
import { webRoutes } from "./static";

const bytes = (s: string) => new TextEncoder().encode(s);

const assets = new Map([
  ["/index.html", bytes("<!doctype html><body>SunReye</body>")],
  ["/favicon.svg", bytes("<svg/>")],
  ["/_app/immutable/entry/app.CAFEBABE.js", bytes("console.log(1)")],
]);

const get = (path: string, init?: RequestInit) =>
  webRoutes(assets).handle(new Request(`http://localhost${path}`, init));

describe("webRoutes", () => {
  it("serves the fallback page at the root", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(PAGE_CACHE_CONTROL);
    expect(await res.text()).toBe("<!doctype html><body>SunReye</body>");
  });

  it("serves a hashed bundle with its own type and an immutable cache", async () => {
    const res = await get("/_app/immutable/entry/app.CAFEBABE.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it("serves the page for a deep-linked client route", async () => {
    const res = await get("/statistics");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SunReye");
  });

  it("404s a bundle the pack does not contain", async () => {
    expect((await get("/_app/immutable/entry/app.OLDHASH.js")).status).toBe(404);
  });

  // The engine surface owns these prefixes. Answering an unmatched one with the
  // SPA page would turn every API typo into a 200 of HTML, and break the Eden
  // client's error handling.
  it("never answers an engine path with the page", async () => {
    for (const path of ["/api/nope", "/openapi/nope", "/ws", "/healthz"]) {
      expect((await get(path)).status).toBe(404);
    }
  });

  it("answers HEAD without a body", async () => {
    const res = await get("/", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("");
  });

  it("does not answer a non-GET method", async () => {
    expect((await get("/", { method: "POST" })).status).toBe(404);
  });

  it("serves nothing when no build is embedded", async () => {
    const empty = webRoutes(new Map());
    const res = await empty.handle(new Request("http://localhost/"));
    expect(res.status).toBe(404);
  });
});

// The engine mounts a method-agnostic wildcard for Better Auth
// (`.all("/api/auth/*")`). A `GET /*` route registered afterwards outranks it
// for GET — which silently stole every session read and left the dashboard
// permanently logged out while sign-in itself returned 200.
describe("webRoutes alongside the engine's own wildcards", () => {
  const withEngine = () =>
    new Elysia()
      .all("/api/auth/*", () => ({ session: "real" }))
      .get("/api/live", () => "engine")
      .use(webRoutes(assets));

  it("leaves a GET on the auth wildcard to the engine", async () => {
    const res = await withEngine().handle(new Request("http://localhost/api/auth/get-session"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session: "real" });
  });

  it("leaves a POST on the auth wildcard to the engine", async () => {
    const res = await withEngine().handle(
      new Request("http://localhost/api/auth/sign-in/email", { method: "POST" }),
    );
    expect(res.status).toBe(200);
  });

  it("still serves the page for a client route", async () => {
    const res = await withEngine().handle(new Request("http://localhost/statistics"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("still 404s an unmatched engine path", async () => {
    expect((await withEngine().handle(new Request("http://localhost/api/nope"))).status).toBe(404);
  });

  it("does not shadow a concrete engine route", async () => {
    const res = await withEngine().handle(new Request("http://localhost/api/live"));
    expect(await res.text()).toBe("engine");
  });
});

describe("webRoutes content negotiation", () => {
  const gz = bytes("GZIPPED");
  const br = bytes("BROTLID");
  const negotiable = new Map([
    ...assets,
    [variantKey("gzip", "/_app/immutable/entry/app.CAFEBABE.js"), gz],
    [variantKey("br", "/_app/immutable/entry/app.CAFEBABE.js"), br],
    [variantKey("gzip", "/index.html"), gz],
  ]);
  const fetchAsset = (path: string, accept?: string) =>
    webRoutes(negotiable).handle(
      new Request(`http://localhost${path}`, {
        headers: accept === undefined ? {} : { "accept-encoding": accept },
      }),
    );

  it("serves the brotli variant to a browser", async () => {
    const res = await fetchAsset("/_app/immutable/entry/app.CAFEBABE.js", "gzip, deflate, br");
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(await res.text()).toBe("BROTLID");
  });

  it("serves gzip when that is all the client takes", async () => {
    const res = await fetchAsset("/_app/immutable/entry/app.CAFEBABE.js", "gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(await res.text()).toBe("GZIPPED");
  });

  it("serves the raw bytes when no encoding is acceptable", async () => {
    const res = await fetchAsset("/_app/immutable/entry/app.CAFEBABE.js");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("console.log(1)");
  });

  it("keeps the asset's own content-type on a compressed reply", async () => {
    const res = await fetchAsset("/_app/immutable/entry/app.CAFEBABE.js", "br");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  // Without this a shared cache can hand a gzip body to a client that never
  // asked for one.
  it("varies on Accept-Encoding whether or not it compressed", async () => {
    expect((await fetchAsset("/index.html", "gzip")).headers.get("vary")).toBe("Accept-Encoding");
    expect((await fetchAsset("/favicon.svg")).headers.get("vary")).toBe("Accept-Encoding");
  });

  it("serves an asset with no variants raw even to a browser", async () => {
    const res = await fetchAsset("/favicon.svg", "gzip, br");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("<svg/>");
  });

  it("negotiates the fallback page for a deep-linked route", async () => {
    const res = await fetchAsset("/statistics", "gzip");
    expect(res.headers.get("content-encoding")).toBe("gzip");
  });

  // A variant key is reachable as a URL only by smuggling the NUL in
  // percent-encoded. Such a path is simply not in the manifest, so it takes the
  // SPA fallback — what must never happen is the raw compressed blob coming
  // back as an asset of its own, with no content-encoding to describe it.
  it("never serves a variant key as an asset of its own", async () => {
    const res = await fetchAsset("/%00gzip/index.html");
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(await res.text()).toBe("<!doctype html><body>SunReye</body>");
  });

  it("does not let a smuggled variant key reach the immutable arm either", async () => {
    const res = await fetchAsset("/%00br/_app/immutable/entry/app.CAFEBABE.js");
    expect(await res.text()).not.toBe("BROTLID");
  });

  it("sends no body for HEAD but still reports the encoding", async () => {
    const res = await webRoutes(negotiable).handle(
      new Request("http://localhost/index.html", {
        method: "HEAD",
        headers: { "accept-encoding": "gzip" },
      }),
    );
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(await res.text()).toBe("");
  });
});
