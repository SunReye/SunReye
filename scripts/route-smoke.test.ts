import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DB_PORT,
  DEV_DB_PORT,
  MIN_ROUTES,
  SKIP_LABELS,
  SmokeTargetError,
  assertSmokeTarget,
  classify,
  fillPath,
  parseArgs,
  planProbes,
  generatedSurface,
  generatedSurfaceProblem,
  probeLabel,
  sampleQuery,
  summarize,
  type OpenApiDoc,
  type ProbeResult,
} from "./route-smoke-plan";
import { main } from "./route-smoke";

const NOW = Date.UTC(2026, 7, 30, 12, 0, 0);

const doc = (paths: OpenApiDoc["paths"]): OpenApiDoc => ({ paths });

const plan = (paths: OpenApiDoc["paths"], samples: Record<string, string> = {}) =>
  planProbes(doc(paths), { samples, nowMs: NOW });

describe("target pinning", () => {
  test("refuses the dev database port, which is shared with a live inverter", () => {
    // 5432 on a developer's host is the database a real grid-tied inverter
    // writes into. This harness DROPs and seeds its target.
    expect(() => assertSmokeTarget(DEV_DB_PORT)).toThrow(SmokeTargetError);
  });

  test("accepts the throwaway port", () => {
    expect(() => assertSmokeTarget(DEFAULT_DB_PORT)).not.toThrow();
    expect(DEFAULT_DB_PORT).toBe(5433);
  });

  test("refuses a port that is not a usable TCP port", () => {
    expect(() => assertSmokeTarget(0)).toThrow(SmokeTargetError);
    expect(() => assertSmokeTarget(-1)).toThrow(SmokeTargetError);
    expect(() => assertSmokeTarget(70_000)).toThrow(SmokeTargetError);
    expect(() => assertSmokeTarget(5433.5)).toThrow(SmokeTargetError);
  });
});

describe("argument parsing", () => {
  test("defaults are the throwaway database and a warmup long enough to record", () => {
    const options = parseArgs([]);
    expect(options.dbPort).toBe(DEFAULT_DB_PORT);
    expect(options.warmupMs).toBeGreaterThanOrEqual(10_000);
    expect(options.help).toBe(false);
    expect(options.keep).toBe(false);
  });

  test("reads the flags it documents", () => {
    const options = parseArgs(["--db-port=5434", "--port=3999", "--warmup=2000", "--keep"]);
    expect(options).toMatchObject({ dbPort: 5434, port: 3999, warmupMs: 2000, keep: true });
  });

  test("--help short-circuits without validating a target", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  test("rejects the dev database port at the argument boundary, not later", () => {
    expect(() => parseArgs([`--db-port=${DEV_DB_PORT}`])).toThrow(SmokeTargetError);
  });

  test("rejects an unparseable number rather than silently defaulting", () => {
    expect(() => parseArgs(["--warmup=soon"])).toThrow();
    expect(() => parseArgs(["--db-port=abc"])).toThrow();
  });

  test("rejects an unknown flag", () => {
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});

describe("filling path parameters", () => {
  test("substitutes a discovered sample", () => {
    expect(fillPath("/api/v1/entities/{key}/history", { key: "dc.pv1.power" })).toBe(
      "/api/v1/entities/dc.pv1.power/history",
    );
  });

  test("URL-encodes the sample so a dotted or slashed id cannot escape the path", () => {
    expect(fillPath("/api/x/{id}", { id: "a/b c" })).toBe("/api/x/a%2Fb%20c");
  });

  test("a parameter with no sample gets a placeholder that reads as absent, not empty", () => {
    // An empty substitution silently changes which route is hit; a placeholder
    // asks the handler for something that does not exist, which must be a 404.
    const filled = fillPath("/api/automations/{id}", {});
    expect(filled).not.toBe("/api/automations/");
    expect(filled.startsWith("/api/automations/")).toBe(true);
    expect(filled.length).toBeGreaterThan("/api/automations/".length);
  });

  test("substitutes every parameter, not just the first", () => {
    expect(fillPath("/a/{x}/b/{y}", { x: "1", y: "2" })).toBe("/a/1/b/2");
  });

  test("leaves a path with no parameters alone", () => {
    expect(fillPath("/healthz", {})).toBe("/healthz");
  });
});

describe("sampling query parameters", () => {
  const sample = (parameters: Parameters<typeof sampleQuery>[0]) => sampleQuery(parameters, NOW);

  test("omits an optional parameter", () => {
    expect(sample([{ name: "metric", in: "query", schema: { type: "string" } }])).toEqual({});
  });

  test("omits path, header and cookie parameters — only the query is built here", () => {
    expect(
      sample([
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "x-key", in: "header", required: true, schema: { type: "string" } },
      ]),
    ).toEqual({});
  });

  test("a required enum takes its first member, so the value is one the route accepts", () => {
    expect(
      sample([
        { name: "bucket", in: "query", required: true, schema: { enum: ["hour", "day", "month"] } },
      ]),
    ).toEqual({ bucket: "hour" });
  });

  test("a union of literals is read like an enum", () => {
    expect(
      sample([
        {
          name: "range",
          in: "query",
          required: true,
          schema: { anyOf: [{ const: "today" }, { const: "month" }] },
        },
      ]),
    ).toEqual({ range: "today" });
  });

  test("a declared default is preferred over an invented value", () => {
    expect(
      sample([
        { name: "hours", in: "query", required: true, schema: { type: "number", default: 24 } },
      ]),
    ).toEqual({ hours: "24" });
  });

  test("zero is a default, not a missing one", () => {
    expect(
      sample([
        { name: "offset", in: "query", required: true, schema: { type: "number", default: 0 } },
      ]),
    ).toEqual({ offset: "0" });
  });

  test("false is a default, not a missing one", () => {
    expect(
      sample([
        { name: "raw", in: "query", required: true, schema: { type: "boolean", default: false } },
      ]),
    ).toEqual({ raw: "false" });
  });

  test("a window is a real, ordered [from, to) around now", () => {
    const q = sample([
      { name: "from", in: "query", required: true, schema: { type: "string" } },
      { name: "to", in: "query", required: true, schema: { type: "string" } },
    ]);
    expect(Date.parse(q.from as string)).toBeLessThan(Date.parse(q.to as string));
    expect(Date.parse(q.to as string)).toBe(NOW);
  });

  test("a number with only a minimum takes the minimum, never a value the route rejects", () => {
    expect(
      sample([
        { name: "limit", in: "query", required: true, schema: { type: "integer", minimum: 5 } },
      ]),
    ).toEqual({ limit: "5" });
  });

  test("an unrecognised required parameter still gets a value rather than being dropped", () => {
    const q = sample([{ name: "mystery", in: "query", required: true, schema: {} }]);
    expect(q.mystery).toBeTruthy();
  });

  test("no parameters at all is an empty query, not a stray '?'", () => {
    expect(sample(undefined)).toEqual({});
    expect(sample([])).toEqual({});
  });
});

describe("planning the probes", () => {
  test("one probe per method per path", () => {
    const probes = plan({
      "/healthz": { get: {} },
      "/api/settings": { get: {}, put: {} },
    });
    expect(probes.map(probeLabel)).toEqual([
      "GET /healthz",
      "GET /api/settings",
      "PUT /api/settings",
    ]);
  });

  test("reads run before writes, so a DELETE cannot empty what a GET was going to read", () => {
    const probes = plan({
      "/a": { delete: {} },
      "/b": { post: {} },
      "/c": { get: {} },
    });
    expect(probes.map((p) => p.method)).toEqual(["GET", "POST", "DELETE"]);
  });

  test("skips HEAD and OPTIONS — auto-generated mirrors of routes already probed", () => {
    expect(plan({ "/a": { get: {}, head: {}, options: {} } }).map(probeLabel)).toEqual(["GET /a"]);
  });

  test("skips the docs UI and the websocket upgrade, which are not JSON handlers", () => {
    expect(
      plan({ "/openapi": { get: {} }, "/openapi/json": { get: {} }, "/ws": { get: {} } }),
    ).toEqual([]);
  });

  test("skips Better Auth's mounted handler, which owns its own contract", () => {
    expect(plan({ "/api/auth/*": { get: {}, post: {} } })).toEqual([]);
  });

  test("skips the routes that would end the run they are part of", () => {
    // POST /api/admin/restart answers, then exits the process 150 ms later.
    // Probing it turns every later probe into "connection refused" — a sweep
    // that destroys its own subject proves nothing about the routes after it.
    expect(SKIP_LABELS).toContain("POST /api/admin/restart");
    for (const label of SKIP_LABELS) {
      const [method, path] = label.split(" ") as [string, string];
      expect(plan({ [path]: { [method.toLowerCase()]: {} } })).toEqual([]);
    }
  });

  test("a skipped label does not take the rest of its path with it", () => {
    // /api/admin/restart is POST-only today, but the rule is per-operation:
    // skipping a write must not silently drop a read of the same path.
    const probes = plan({ "/api/admin/restart": { get: {}, post: {} } });
    expect(probes.map(probeLabel)).toEqual(["GET /api/admin/restart"]);
  });

  test("an empty document plans nothing rather than inventing a route", () => {
    expect(planProbes({}, { samples: {}, nowMs: NOW })).toEqual([]);
    expect(plan({})).toEqual([]);
  });

  test("carries the sampled query into the URL", () => {
    const [probe] = plan({
      "/api/history/rollup": {
        get: {
          parameters: [
            { name: "bucket", in: "query", required: true, schema: { enum: ["hour", "day"] } },
          ],
        },
      },
    });
    expect(probe?.url).toBe("/api/history/rollup?bucket=hour");
  });

  test("path parameters are filled from the samples the run discovered", () => {
    const [probe] = plan({ "/api/v1/entities/{key}": { get: {} } }, { key: "battery.soc" });
    expect(probe?.url).toBe("/api/v1/entities/battery.soc");
  });

  test("a write carries a JSON body — an empty one, since a 4xx is a pass here", () => {
    const [probe] = plan({ "/api/settings/tariff": { put: { requestBody: {} } } });
    expect(probe?.body).toBe("{}");
    expect(probe?.method).toBe("PUT");
  });

  test("a read carries no body at all", () => {
    expect(plan({ "/a": { get: {} } })[0]?.body).toBeUndefined();
  });
});

describe("classifying one response", () => {
  const probe = { method: "GET", path: "/a", url: "/a", label: "GET /a" };

  test("a 5xx is the failure this harness exists to catch", () => {
    expect(classify(probe, { status: 500 }).ok).toBe(false);
    expect(classify(probe, { status: 503 }).ok).toBe(false);
  });

  test("a 4xx on bad input is fine — the handler ran and refused", () => {
    for (const status of [400, 401, 403, 404, 405, 422]) {
      expect(classify(probe, { status }).ok).toBe(true);
    }
  });

  test("a 2xx and a 3xx pass", () => {
    expect(classify(probe, { status: 200 }).ok).toBe(true);
    expect(classify(probe, { status: 304 }).ok).toBe(true);
  });

  test("a request that never got a response is a failure, not a skip", () => {
    // A server that died mid-sweep must go red rather than quietly stop counting.
    expect(classify(probe, { error: "connection refused" }).ok).toBe(false);
  });

  test("the failure carries the status and body excerpt a reader needs", () => {
    const verdict = classify(probe, { status: 500, body: "TypeError: x is not a function" });
    expect(verdict.detail).toContain("500");
    expect(verdict.detail).toContain("TypeError");
  });

  test("an allowed status for one exact route passes, and does not spread to others", () => {
    const allow = { "GET /a": [503] };
    expect(classify(probe, { status: 503 }, allow).ok).toBe(true);
    expect(classify({ ...probe, label: "GET /b" }, { status: 503 }, allow).ok).toBe(false);
    // The exemption is per-status: a 500 on the same route is still a failure.
    expect(classify(probe, { status: 500 }, allow).ok).toBe(false);
  });
});

describe("the generated surface guard", () => {
  /** What the document looks like with no active profile: hand-written only. */
  const handWrittenOnly = (): OpenApiDoc["paths"] => {
    const paths: NonNullable<OpenApiDoc["paths"]> = {
      "/healthz": { get: {} },
      "/api/status": { get: {} },
      "/api/history": { get: {} },
      "/api/settings": { get: {}, put: {} },
      "/api/command": { post: {} },
      "/api/statistics/today": { get: {} },
    };
    // The hand-written surface is ~88 operations and is mounted whether or not a
    // profile is active, so it alone must never satisfy the guard.
    for (let i = 0; i < 100; i++) paths[`/api/filler/${i}`] = { get: {} };
    return paths;
  };

  /** The routes `entitiesApi()` mounts only when a profile is active. */
  const generated = (): NonNullable<OpenApiDoc["paths"]> => ({
    "/api/v1/entities": { get: {} },
    "/api/v1/state": { get: {} },
    "/api/v1/entities/{key}": { get: {} },
    "/api/v1/entities/{key}/history": { get: {} },
    "/api/v1/entities/settings.workmode": { put: {} },
    "/api/v1/entities/settings.battery.grid_charge": { put: {} },
  });

  test("a document of ONLY hand-written routes is rejected", () => {
    // The failure this guard exists for: seedProfile silently did nothing, so
    // the entity catalog and every generated command route are absent — while
    // the hand-written routes (mounted unconditionally, answering 503
    // ONBOARDING_REQUIRED at worst) still probe well past any raw total floor.
    const problem = generatedSurfaceProblem(doc(handWrittenOnly()));
    expect(problem).toBeDefined();
    expect(problem).toMatch(/profile/i);
  });

  test("the catalog and at least one generated command route satisfy it", () => {
    const paths = { ...handWrittenOnly(), ...generated() };
    expect(generatedSurfaceProblem(doc(paths))).toBeUndefined();
  });

  test("the entity catalog without a single generated command route is rejected", () => {
    // A profile that activated but generated no writes is still a broken seed:
    // the committed sample profile has 39 writable metrics, so zero means the
    // catalog came from somewhere other than a properly installed profile.
    const paths = { ...handWrittenOnly(), ...generated() };
    delete paths["/api/v1/entities/settings.workmode"];
    delete paths["/api/v1/entities/settings.battery.grid_charge"];
    expect(generatedSurfaceProblem(doc(paths))).toMatch(/command/i);
  });

  test("generated command routes without the catalog are rejected", () => {
    const paths = { ...handWrittenOnly(), ...generated() };
    delete paths["/api/v1/entities"];
    expect(generatedSurfaceProblem(doc(paths))).toMatch(/catalog|\/api\/v1\/entities/i);
  });

  test("a templated path is never counted as a generated command route", () => {
    // `PUT /api/v1/entities/{key}` would be a hand-written route; the generated
    // ones spell the entity key out, one route per writable metric.
    const paths = { ...handWrittenOnly(), ...generated() };
    delete paths["/api/v1/entities/settings.workmode"];
    delete paths["/api/v1/entities/settings.battery.grid_charge"];
    paths["/api/v1/entities/{key}"] = { get: {}, put: {} };
    expect(generatedSurfaceProblem(doc(paths))).toBeDefined();
  });

  test("the surface it reports is the generated routes, not the hand-written ones", () => {
    const surface = generatedSurface(doc({ ...handWrittenOnly(), ...generated() }));
    expect(surface.catalog).toContain("GET /api/v1/entities");
    expect(surface.commands).toContain("PUT /api/v1/entities/settings.workmode");
    expect(surface.commands.some((label) => label.includes("/api/filler/"))).toBe(false);
  });

  test("an empty document is rejected too", () => {
    expect(generatedSurfaceProblem(doc({}))).toBeDefined();
  });
});

describe("summarising the sweep", () => {
  const result = (label: string, ok: boolean): ProbeResult => ({
    label,
    ok,
    detail: ok ? "200" : "500",
  });

  test("all green passes", () => {
    const many = Array.from({ length: MIN_ROUTES }, (_, i) => result(`GET /${i}`, true));
    expect(summarize(many).ok).toBe(true);
    expect(summarize(many).exitCode).toBe(0);
  });

  test("one 5xx fails the sweep and names the route", () => {
    const many = Array.from({ length: MIN_ROUTES }, (_, i) => result(`GET /${i}`, true));
    many[3] = result("GET /api/statistics/today", false);
    const verdict = summarize(many);
    expect(verdict.ok).toBe(false);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.text).toContain("GET /api/statistics/today");
  });

  test("probing nothing FAILS — an empty listing must not read as a clean sweep", () => {
    expect(summarize([]).ok).toBe(false);
    expect(summarize([]).text).toMatch(/no routes/i);
  });

  test("a listing far below the measured size fails the floor", () => {
    // A secondary sanity check only: it catches a listing that shrank wholesale
    // (a truncated document, a group that failed to mount). A profile seeding
    // slip is NOT its job — the hand-written surface alone clears this floor,
    // which is what `generatedSurfaceProblem` is for.
    const few = Array.from({ length: MIN_ROUTES - 1 }, (_, i) => result(`GET /${i}`, true));
    expect(summarize(few).ok).toBe(false);
    expect(summarize(few).text).toMatch(/at least/i);
  });

  test("the floor sits below the measured total and above the hand-written surface", () => {
    // Measured 2026-08-30 against the committed sample profile: 131 routes
    // probed, of which 43 are generated (4 catalog + 39 commands). The floor is
    // headroom under 131, not a derivation of the generated count.
    expect(MIN_ROUTES).toBeLessThan(131);
    expect(MIN_ROUTES).toBeGreaterThan(43);
  });

  test("the report counts what it probed", () => {
    const many = Array.from({ length: MIN_ROUTES }, (_, i) => result(`GET /${i}`, true));
    expect(summarize(many).text).toContain(String(MIN_ROUTES));
  });
});

describe("the command line", () => {
  test("--help prints the usage and succeeds without reaching for Docker", async () => {
    const printed: string[] = [];
    const real = console.log;
    console.log = (line: string) => printed.push(line);
    try {
      expect(await main(["--help"])).toBe(0);
    } finally {
      console.log = real;
    }
    expect(printed.join("\n")).toContain("--db-port");
  });

  test("a refused target exits non-zero with the reason, before anything boots", async () => {
    const printed: string[] = [];
    const real = console.error;
    console.error = (line: string) => printed.push(line);
    try {
      expect(await main([`--db-port=${DEV_DB_PORT}`])).toBe(1);
    } finally {
      console.error = real;
    }
    expect(printed.join("\n")).toContain(String(DEV_DB_PORT));
  });
});
