import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";

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
