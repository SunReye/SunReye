/**
 * That the engine's plugin stack *constructs*.
 *
 * Every other suite here builds one plugin at a time. Nothing built the stack,
 * and the Elysia 2 upgrade showed what that costs: `@logtape/elysia` threw from
 * its own constructor (it registered `.onRequest`, a hook Elysia 2 renamed), so
 * the server died before its first request while all 4 700 tests stayed green.
 * A plugin that cannot be constructed is not a subtle failure — it just needs
 * something to try.
 *
 * It has already paid for itself twice: it also caught
 * `@elysia/openapi@2.0.0-beta.1` shipping `dist/gen/index.mjs` with a
 * build-time relative path to typebox (`../node_modules/typebox/…`) that
 * resolves nowhere — see `patches/`.
 *
 * The composition root needs a database; this needs only the plugins, so
 * `@SunReye/auth` is mocked the way ./routes/admin-guard.test.ts mocks it.
 *
 * The HTTP route modules are deliberately NOT mounted here. None of them is
 * covered by this suite (see the coverage report), and importing one only to
 * construct it would add a few hundred unexercised lines to the ratchet while
 * proving nothing about their handlers. What verifies those is apps/web/e2e.
 */
import { describe, expect, it, mock } from "bun:test";
import { cors } from "@elysia/cors";
import { openapi } from "@elysia/openapi";
import { Elysia } from "elysia";
import { autoHead } from "elysia/auto-head";

// mock-hygiene-ignore-next-line -- importing the real module boots Better Auth, which reads env and a database; avoiding that is the whole point of mocking it here. `auth` is its only export the server imports.
mock.module("@SunReye/auth", () => ({
  auth: { api: { getSession: async () => null } },
}));

// Imported after the mock so the guard inside the ws route binds to it.
const { wsRoutes } = await import("./routes/ws");
const { requestLogger } = await import("./shared/request-log");
const { webRoutes } = await import("./web/static");

// `@SunReye/auth` is deliberately not handed back: the real module cannot be
// imported to snapshot it (booting Better Auth is what the mock avoids), and no
// suite in this repo unit-tests it — same reasoning as
// ./routes/admin-guard.test.ts.

const bytes = (s: string) => new TextEncoder().encode(s);

/** The ws route only has to be constructible here; its behaviour is ws-connection's. */
const wsDeps = () => ({
  streams: { subscribe: () => () => {} } as never,
  access: async () => ({}) as never,
  backfill: {} as never,
});

const stack = () =>
  new Elysia()
    .use(requestLogger({ skip: (ctx) => ctx.path === "/healthz" }))
    .use(cors({ origin: true }))
    .use(openapi({ exclude: { staticFile: false } }))
    .get("/healthz", () => "ok")
    .use(wsRoutes(wsDeps()))
    .use(webRoutes(new Map([["/index.html", bytes("<body>SunReye</body>")]])))
    // Last, and async: it derives HEAD from the GET routes already registered.
    .use(autoHead());

/** `autoHead()` is async, so nothing may be handled before the app settles. */
const ready = async () => {
  const app = stack();
  await app.modules;
  return app;
};

describe("the engine's plugin stack", () => {
  it("constructs without throwing", () => {
    expect(() => stack()).not.toThrow();
  });

  it("still answers its own routes once every plugin is mounted", async () => {
    const res = await (await ready()).handle(new Request("http://localhost/healthz"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  // webRoutes is mounted last and matches every method on `/*`; the engine's
  // own paths have to keep winning, which is the bug that made it `.all`.
  it("leaves the dashboard wildcard behind the engine's own paths", async () => {
    const app = await ready();
    expect((await app.handle(new Request("http://localhost/healthz"))).status).toBe(200);
    const page = await app.handle(new Request("http://localhost/statistics"));
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  // Elysia 1 answered HEAD on a `.get` route; Elysia 2 does not unless
  // `autoHead()` is mounted, and it 404s instead — a silent break for any
  // integrator that probes an endpoint with HEAD before reading it.
  it("answers HEAD on a GET route, with no body", async () => {
    const app = await ready();
    const res = await app.handle(new Request("http://localhost/healthz", { method: "HEAD" }));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it("serves the OpenAPI document", async () => {
    const res = await (await ready()).handle(new Request("http://localhost/openapi"));
    expect(res.status).toBe(200);
  });
});
