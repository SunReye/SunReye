import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { requestContextStorage } from "./request-context";
import { type RequestLogEntry, requestLogger } from "./request-log";

/** Only `.handle` is exercised here; the full Elysia generic is noise. */
type Handleable = { handle(request: Request): Promise<Response> };

const appWith = (options?: Parameters<typeof requestLogger>[0]) => {
  const seen: RequestLogEntry[] = [];
  /** What the ambient context held when unrelated code ran mid-request. */
  const contexts: (string | undefined)[] = [];
  const app = new Elysia()
    .use(requestLogger({ ...options, emit: (entry) => seen.push(entry) }))
    .get("/ping", () => "pong")
    .get("/healthz", () => "ok")
    .get("/boom", () => {
      throw new Error("nope");
    })
    .get("/deep", async () => {
      // Stands in for the engine: unrelated code, several awaits away, that
      // logs without being handed anything.
      await new Promise((r) => setTimeout(r, 1));
      contexts.push(requestContextStorage.getStore()?.requestId as string | undefined);
      return "deep";
    })
    .post("/thing", () => "made");
  return { app, seen, contexts };
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

  // The dropped `@logtape/elysia` logged the full URL; we logged only the path,
  // which loses exactly the part that identifies a history request.
  it("records the query string, which is what distinguishes one request", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping?from=2026-01-01&to=2026-02-01");
    expect(seen[0]?.path).toBe("/ping");
    expect(seen[0]?.query).toBe("?from=2026-01-01&to=2026-02-01");
  });

  it("reports an empty query rather than undefined when there is none", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping");
    expect(seen[0]?.query).toBe("");
  });

  it("logs at the level the caller asked for", async () => {
    const { app, seen } = appWith({ level: "debug" });
    await get(app, "/ping");
    expect(seen[0]?.level).toBe("debug");
  });

  it("logs at info by default", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping");
    expect(seen[0]?.level).toBe("info");
  });
});

describe("requestLogger correlation", () => {
  it("carries the id a caller supplied", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping", { headers: { "x-request-id": "caller-abc" } });
    expect(seen[0]?.requestId).toBe("caller-abc");
  });

  it("mints one when the caller supplied none", async () => {
    const { app, seen } = appWith();
    await get(app, "/ping");
    expect(seen[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  // So a caller can find its own request in the log, and a proxy can stitch a
  // trace together.
  it("echoes the id back on the response", async () => {
    const { app } = appWith();
    const res = await get(app, "/ping", { headers: { "x-request-id": "caller-abc" } });
    expect(res.headers.get("x-request-id")).toBe("caller-abc");
  });

  it("echoes a minted id too", async () => {
    const { app, seen } = appWith();
    const res = await get(app, "/ping");
    expect(res.headers.get("x-request-id")).toBe(seen[0]?.requestId ?? null);
  });

  it("refuses to repeat an id that could forge a log line", async () => {
    const { app, seen } = appWith();
    const res = await get(app, "/ping", { headers: { "x-request-id": "ok-but-then\ttab" } });
    expect(seen[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-request-id")).toBe(seen[0]?.requestId ?? null);
  });

  // The point of the whole exercise: a record emitted by unrelated code deep
  // inside the request still carries the id.
  it("reaches a log record emitted from inside the handler", async () => {
    const { app, contexts } = appWith();
    await get(app, "/deep", { headers: { "x-request-id": "deep-1" } });
    expect(contexts).toEqual(["deep-1"]);
  });
});
