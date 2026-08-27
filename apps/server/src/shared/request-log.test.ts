import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { type RequestLogEntry, requestLogger } from "./request-log";

/** Only `.handle` is exercised here; the full Elysia generic is noise. */
type Handleable = { handle(request: Request): Promise<Response> };

const appWith = (options?: Parameters<typeof requestLogger>[0]) => {
  const seen: RequestLogEntry[] = [];
  const app = new Elysia()
    .use(requestLogger({ ...options, emit: (entry) => seen.push(entry) }))
    .get("/ping", () => "pong")
    .get("/healthz", () => "ok")
    .get("/boom", () => {
      throw new Error("nope");
    })
    .post("/thing", () => "made");
  return { app, seen };
};

const get = (app: Handleable, path: string, init?: RequestInit) =>
  app.handle(new Request(`http://localhost${path}`, init));

describe("requestLogger", () => {
  it("records the method, path and status of a served request", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "GET", path: "/ping", status: 200 });
  });

  it("records the method a non-GET request actually used", async () => {
    const { app, seen } = appWith();
    await get(app, "/thing", { method: "POST" });
    expect(seen[0]).toMatchObject({ method: "POST", path: "/thing", status: 200 });
  });

  // A 404 is the most interesting line in the log, so it must not be the one
  // that goes missing: no route ran, so nothing but this hook can report it.
  it("records a request that matched no route", async () => {
    const { app, seen } = appWith();
    await get(app, "/nowhere");
    expect(seen[0]).toMatchObject({ path: "/nowhere", status: 404 });
  });

  it("records a handler that threw as a 500", async () => {
    const { app, seen } = appWith();
    await get(app, "/boom");
    expect(seen[0]).toMatchObject({ path: "/boom", status: 500 });
  });

  // Health probes and the dashboard page arrive constantly and say nothing
  // about what the engine is doing.
  it("skips what the caller asks it to skip", async () => {
    const { app, seen } = appWith({ skip: (ctx) => ctx.path === "/healthz" });
    await get(app, "/healthz");
    await get(app, "/ping");
    expect(seen.map((e) => e.path)).toEqual(["/ping"]);
  });

  it("offers the skip predicate the method as well as the path", async () => {
    const { app, seen } = appWith({ skip: (ctx) => ctx.method === "POST" });
    await get(app, "/thing", { method: "POST" });
    await get(app, "/ping");
    expect(seen.map((e) => e.path)).toEqual(["/ping"]);
  });

  // A raw performance.now() delta reads as "in 7.111102000002575ms" in the log
  // viewer: noise in every line, for precision nobody can use.
  it("rounds the duration to something a log line can show", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping");
    const durationMs = seen[0]?.durationMs ?? -1;
    expect(durationMs).toBe(Math.round(durationMs * 100) / 100);
  });

  it("times each request without borrowing another's clock", async () => {
    const { app, seen } = appWith();
    await Promise.all([get(app, "/ping"), get(app, "/thing", { method: "POST" })]);
    expect(seen).toHaveLength(2);
    for (const entry of seen) {
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
      expect(entry.durationMs).toBeLessThan(10_000);
    }
  });

  it("reports one line per request, not one per hook", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping");
    await get(app, "/ping");
    expect(seen).toHaveLength(2);
  });
});
