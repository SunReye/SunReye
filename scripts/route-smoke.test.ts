import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DB_PORT,
  DEV_DB_PORT,
  MAX_UNPROVEN_GATES,
  MIN_ROUTES,
  PUBLIC_LABELS,
  SESSION_LABELS,
  SKIP_LABELS,
  SmokeTargetError,
  UPGRADE_LABEL,
  assertSmokeTarget,
  classify,
  classifyAuth,
  classifyUpgrade,
  fillPath,
  isPublicLabel,
  isSessionLabel,
  parseArgs,
  planProbes,
  sampleBody,
  generatedSurface,
  generatedSurfaceProblem,
  probeLabel,
  sampleQuery,
  summarize,
  summarizeAuth,
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

// ---------------------------------------------------------------------------
// The AUTH half of the sweep. `classify` answers "did the handler run"; these
// answer "was it allowed to". A route silently left public is the failure this
// exists for, and it is invisible to a 5xx check: an ungated config read
// answers 200 to a stranger and sweeps green.
// ---------------------------------------------------------------------------

describe("the public surface is a closed list", () => {
  test("only the pre-auth routes are declared public", () => {
    // Anything not on this list must refuse a request with no credentials.
    // `/openapi`, `/api/auth/*` and `/ws` never reach the classifier — the plan
    // skips them (see SKIP) — so they are deliberately absent here.
    expect([...PUBLIC_LABELS].sort()).toEqual(
      [
        "GET /api/access-status",
        "GET /api/profile-status",
        "GET /api/setup-status",
        "GET /healthz",
      ].sort(),
    );
  });

  test("no configuration read is on it", () => {
    for (const label of [
      "GET /api/status",
      "GET /api/profiles",
      "GET /api/profiles/updates",
      "GET /api/settings/profile-sources",
      "GET /api/settings/tariff",
      "GET /api/settings/inverter",
    ]) {
      expect(isPublicLabel(label)).toBe(false);
    }
  });

  test("no dashboard read is on it either — those need a session", () => {
    for (const label of [
      "GET /api/profile",
      "GET /api/history",
      "GET /api/history/rollup",
      "GET /api/cost",
      "GET /api/cost/series",
      "GET /api/energy/series",
      "GET /api/statistics/heatmap",
    ]) {
      expect(isPublicLabel(label)).toBe(false);
    }
  });

  test("the generated third-party surface is not public — it is API-key gated", () => {
    expect(isPublicLabel("GET /api/v1/entities")).toBe(false);
    expect(isPublicLabel("GET /api/v1/state")).toBe(false);
  });

  test("the SPA shell is public on every method — it is the web app itself", () => {
    // `/*` is the SvelteKit build. A logged-out visitor must be able to load it
    // to reach the login page at all; the engine paths it must not swallow are
    // refused inside the handler (see apps/server/src/web/static.ts).
    expect(isPublicLabel("GET /*")).toBe(true);
    expect(isPublicLabel("POST /*")).toBe(true);
    expect(isPublicLabel("DELETE /*")).toBe(true);
  });

  test("the wildcard does not make everything under it public", () => {
    expect(isPublicLabel("GET /api/history")).toBe(false);
    expect(isPublicLabel("GET /*/settings")).toBe(false);
  });
});

describe("classifying an ANONYMOUS probe", () => {
  const anon = (label: string, status: number) =>
    classifyAuth({ label }, { status, body: "" }, "anonymous");

  /** A probe that carries a payload, i.e. one whose route declares a body schema. */
  const anonWrite = (label: string, status: number) =>
    classifyAuth({ label, body: "{}" }, { status, body: "" }, "anonymous");

  test("a gated route that answers 200 to a stranger FAILS, and says it is public", () => {
    const verdict = anon("GET /api/settings/tariff", 200);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/public|no credentials|unauthenticated/i);
  });

  test("401 and 403 are the pass — the gate refused", () => {
    expect(anon("GET /api/settings/tariff", 401).ok).toBe(true);
    expect(anon("GET /api/settings/tariff", 403).ok).toBe(true);
  });

  test("a 2xx is not the only leak: any answer that is not a refusal fails", () => {
    expect(anon("GET /api/history", 503).ok).toBe(false);
    expect(anon("GET /api/history", 200).ok).toBe(false);
    expect(anon("DELETE /api/profiles/{id}", 404).ok).toBe(false);
  });

  test("a 422 on a probe that CARRIES A BODY is the framework, not a leak", () => {
    // Elysia 2 validates a declared body before `beforeHandle`, where the guard
    // lives, so a malformed anonymous payload is answered 422 with the guard
    // never consulted. The handler still never runs. Pinned in
    // apps/server/src/routes/admin-guard.test.ts, and explained in
    // apps/server/src/routes/admin-guard.ts.
    expect(anonWrite("PUT /api/settings/tariff", 422).ok).toBe(true);
  });

  test("...but it is UNPROVEN, not a passing gate — the guard was never asked", () => {
    // The blind spot this half was reviewed for: a 422 says the SCHEMA refused
    // the payload. A gated write and an UNGATED write answer it identically, so
    // counting it as a pass blanks the whole write surface — the register
    // writes, the admin resets, the profile installs — under a summary line
    // reading "every gate held".
    const verdict = anonWrite("POST /api/commands/setting", 422);
    expect(verdict.unproven).toBe(true);
    expect(verdict.detail).toMatch(/unproven/i);
  });

  test("a refusal is a pass and is never unproven", () => {
    expect(anonWrite("POST /api/commands/setting", 401).unproven).toBeFalsy();
    expect(anon("GET /api/status", 401).unproven).toBeFalsy();
  });

  test("the allowance is for 422 alone, and only where a body was sent", () => {
    // A write route answering anything else without credentials really did run.
    expect(anonWrite("PUT /api/settings/tariff", 200).ok).toBe(false);
    expect(anonWrite("POST /api/admin/reset-data", 409).ok).toBe(false);
    expect(anonWrite("DELETE /api/profiles/{id}", 404).ok).toBe(false);
    // A GET has no body to validate, so its 422 came from somewhere past the gate.
    expect(anon("GET /api/history", 422).ok).toBe(false);
  });

  test("a public route must NOT refuse — that is the half a regression hides", () => {
    expect(anon("GET /healthz", 401).ok).toBe(false);
    expect(anon("GET /api/setup-status", 403).ok).toBe(false);
    expect(anon("GET /api/profile-status", 200).ok).toBe(true);
    expect(anon("GET /api/access-status", 200).ok).toBe(true);
  });

  test("a public route may still be 5xx-broken without the AUTH sweep claiming a leak", () => {
    // `classify` owns 5xx. Doubling the claim here would report one defect twice
    // and, worse, make an outage look like an auth regression.
    expect(anon("GET /healthz", 503).ok).toBe(true);
  });

  test("silence fails — a server that died mid-sweep proves nothing about the gate", () => {
    const verdict = classifyAuth(
      { label: "GET /api/history" },
      { error: "connection refused" },
      "anonymous",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("connection refused");
  });
});

describe("classifying an AUTHENTICATED probe", () => {
  const auth = (label: string, status: number) =>
    classifyAuth({ label }, { status, body: "" }, "authenticated");

  test("a gated route that still 401s means the harness's credentials miss it", () => {
    const verdict = auth("GET /api/profiles", 401);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/credential|admin|session|api key/i);
  });

  test("403 fails too — an admin session that is refused is a wrongly-gated route", () => {
    expect(auth("GET /api/settings/display", 403).ok).toBe(false);
  });

  test("anything the handler itself answers passes — this sweep only asks about the gate", () => {
    expect(auth("GET /api/profiles", 200).ok).toBe(true);
    expect(auth("PUT /api/settings/tariff", 422).ok).toBe(true);
    expect(auth("GET /api/profile", 503).ok).toBe(true);
    expect(auth("DELETE /api/profiles/{id}", 404).ok).toBe(true);
  });

  test("a public route answering 401 to a CREDENTIALED caller is still wrong", () => {
    expect(auth("GET /healthz", 401).ok).toBe(false);
  });
});

describe("the live socket's upgrade", () => {
  // `/ws` is skipped by the HTTP plan — a plain GET there is a protocol error,
  // not a route bug — so the one thing that can be asked of it is whether the
  // handshake completes, and for whom.
  test("a stranger who gets a socket FAILS the run", () => {
    const verdict = classifyUpgrade("opened", "anonymous");
    expect(verdict.ok).toBe(false);
    expect(verdict.label).toBe(UPGRADE_LABEL);
    expect(verdict.detail).toMatch(/no credentials|anonymous|public/i);
  });

  test("a refused handshake is the pass, anonymously", () => {
    expect(classifyUpgrade("refused", "anonymous").ok).toBe(true);
  });

  test("the admin session must get one — a refused upgrade is a dead dashboard", () => {
    expect(classifyUpgrade("refused", "authenticated").ok).toBe(false);
    expect(classifyUpgrade("opened", "authenticated").ok).toBe(true);
  });

  test("the upgrade is reported under the same label the plan skips", () => {
    expect(UPGRADE_LABEL).toBe("WS /ws");
  });
});

describe("summarising the auth sweep", () => {
  const green = (label: string): ProbeResult => ({ label, ok: true, detail: "401" });
  const red = (label: string): ProbeResult => ({ label, ok: false, detail: "200 (public)" });

  test("all gates holding passes", () => {
    const verdict = summarizeAuth(
      [green("GET /api/history"), green("GET /api/status")],
      "anonymous",
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.exitCode).toBe(0);
  });

  test("one leak fails the run and names the route", () => {
    const verdict = summarizeAuth(
      [green("GET /api/history"), red("GET /api/profiles/updates")],
      "anonymous",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.text).toContain("GET /api/profiles/updates");
  });

  test("an empty anonymous sweep FAILS — no routes checked is not a clean bill", () => {
    expect(summarizeAuth([], "anonymous").ok).toBe(false);
  });

  test("the verdict says which credentials the sweep carried", () => {
    expect(summarizeAuth([green("GET /x")], "anonymous").text).toMatch(/anonymous|no credentials/i);
    expect(summarizeAuth([green("GET /x")], "authenticated").text).toMatch(/authenticated|admin/i);
    expect(summarizeAuth([green("GET /x")], "member").text).toMatch(/non-admin|member/i);
  });

  const unproven = (label: string): ProbeResult => ({
    label,
    ok: true,
    unproven: true,
    detail: "422 (schema refused the payload before the gate) — UNPROVEN",
  });

  test("an unproven gate must never be reported as a gate that held", () => {
    // The summary is the only thing a reader sees. A route whose guard was
    // never consulted has proved nothing, and saying "every gate held" over it
    // is the failure mode this whole harness exists to refuse.
    const verdict = summarizeAuth(
      [green("GET /api/history"), unproven("POST /api/commands/setting")],
      "anonymous",
      1,
    );
    expect(verdict.text).not.toMatch(/every gate held/i);
    expect(verdict.text).toMatch(/unproven/i);
    expect(verdict.text).toContain("POST /api/commands/setting");
  });

  test("more unproven gates than the floor fails the run", () => {
    const results = [green("GET /api/history"), unproven("POST /api/commands/setting")];
    const verdict = summarizeAuth(results, "anonymous", 0);
    expect(verdict.ok).toBe(false);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.text).toContain("POST /api/commands/setting");
  });

  test("the floor is ZERO: every gate the sweep counts must have been asked", () => {
    // Every body-carrying route in the listing gets a schema-valid payload
    // synthesised from its own `requestBody`, so there is no route left whose
    // gate cannot be reached. A floor above zero would be a licence to stop
    // proving the next one.
    expect(MAX_UNPROVEN_GATES).toBe(0);
    expect(summarizeAuth([green("GET /x"), unproven("POST /y")], "anonymous").ok).toBe(false);
  });

  test("a leak outranks an unproven gate in the report", () => {
    const verdict = summarizeAuth(
      [red("GET /api/profiles/updates"), unproven("POST /y")],
      "anonymous",
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.text).toContain("GET /api/profiles/updates");
  });
});

// ---------------------------------------------------------------------------
// Synthesising a body. The anonymous and non-admin passes send a payload the
// route's own schema ACCEPTS, so validation cannot answer before the guard does
// and the 401/403 the gate owes is the thing actually measured.
// ---------------------------------------------------------------------------

describe("synthesising a schema-valid body", () => {
  const body = (schema: unknown) =>
    sampleBody({ requestBody: { content: { "application/json": { schema } } } }, NOW);
  const parsed = (schema: unknown) => JSON.parse(body(schema) as string) as Record<string, unknown>;

  test("an operation with no declared body needs no synthesis — {} already validates", () => {
    // `t.Unknown()` and a route with no body schema both accept the empty
    // object the probe already sends, so those gates were never blind.
    expect(sampleBody({}, NOW)).toBe("{}");
    expect(body({})).toBe("{}");
  });

  test("a required string property gets a value", () => {
    expect(
      parsed({ type: "object", properties: { id: { type: "string" } }, required: ["id"] }).id,
    ).toBeTruthy();
  });

  test("a required number takes its minimum, never a value the route rejects", () => {
    expect(
      parsed({
        type: "object",
        properties: { value: { type: "number", minimum: 5, maximum: 350 } },
        required: ["value"],
      }),
    ).toEqual({ value: 5 });
  });

  test("an enum member is sent AS THE JSON VALUE IT IS, not stringified", () => {
    // The generated register writes declare `{"value": {"type":"string","enum":[0,1]}}`
    // — the members are numbers whatever the `type` says, and `"0"` is refused.
    expect(
      parsed({
        type: "object",
        properties: { value: { type: "string", enum: [0, 1] } },
        required: ["value"],
      }),
    ).toEqual({ value: 0 });
  });

  test("only REQUIRED properties are sent — an optional one is the route's own default path", () => {
    const built = parsed({
      type: "object",
      properties: { key: { type: "string" }, note: { type: "string" } },
      required: ["key"],
    });
    expect(Object.keys(built)).toEqual(["key"]);
  });

  test("a union body takes its first branch, whole", () => {
    // POST /api/commands/evcc is an anyOf of per-action shapes; half of one
    // branch would be refused by every branch.
    const built = parsed({
      anyOf: [
        {
          type: "object",
          properties: {
            loadpoint: { type: "integer", minimum: 1 },
            action: { type: "string", const: "mode" },
            value: { type: "string" },
          },
          required: ["loadpoint", "action", "value"],
        },
        { type: "object", properties: { other: { type: "string" } }, required: ["other"] },
      ],
    });
    expect(built.loadpoint).toBe(1);
    expect(built.action).toBe("mode");
    expect(typeof built.value).toBe("string");
  });

  test("a required window is a real, ordered pair of instants", () => {
    const built = parsed({
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    });
    expect(Date.parse(built.from as string)).toBeLessThan(Date.parse(built.to as string));
  });

  test("a nested object is built, not left as a placeholder string", () => {
    const built = parsed({
      type: "object",
      properties: {
        window: { type: "object", properties: { hour: { type: "integer" } }, required: ["hour"] },
      },
      required: ["window"],
    });
    expect(built.window).toEqual({ hour: 1 });
  });

  test("a required array is a real array", () => {
    const built = parsed({
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } } },
      required: ["ids"],
    });
    expect(Array.isArray(built.ids)).toBe(true);
  });

  test("a nullable union takes the branch that is not null", () => {
    const built = parsed({
      type: "object",
      properties: { expiresIn: { anyOf: [{ type: "number", minimum: 1 }, { type: "null" }] } },
      required: ["expiresIn"],
    });
    expect(built.expiresIn).toBe(1);
  });

  test("a schema no rule understands yields NO synthesis rather than a guess", () => {
    // The honest fallback: the probe falls back to `{}`, its 422 is reported
    // UNPROVEN, and the run fails rather than claiming a gate held.
    expect(
      sampleBody(
        { requestBody: { content: { "application/json": { schema: { type: "string" } } } } },
        NOW,
      ),
    ).toBeUndefined();
  });

  test("a body that is not JSON is not synthesised", () => {
    expect(
      sampleBody(
        { requestBody: { content: { "multipart/form-data": { schema: { type: "object" } } } } },
        NOW,
      ),
    ).toBeUndefined();
  });
});

describe("planning carries both bodies", () => {
  test("a write carries the empty body for the run, and a valid one for the gate", () => {
    const [probe] = plan({
      "/api/commands/setting": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { key: { type: "string" }, value: { type: "number" } },
                  required: ["key", "value"],
                },
              },
            },
          },
        },
      },
    });
    // The authenticated pass must NOT write real registers: it keeps `{}`.
    expect(probe?.body).toBe("{}");
    const gate = JSON.parse(probe?.gateBody as string) as Record<string, unknown>;
    expect(gate.key).toBeTruthy();
    expect(typeof gate.value).toBe("number");
  });

  test("a write whose schema cannot be synthesised has no gate body", () => {
    const [probe] = plan({
      "/api/x": {
        post: { requestBody: { content: { "application/json": { schema: { type: "string" } } } } },
      },
    });
    expect(probe?.body).toBe("{}");
    expect(probe?.gateBody).toBeUndefined();
  });

  test("a read carries neither", () => {
    const [probe] = plan({ "/a": { get: {} } });
    expect(probe?.body).toBeUndefined();
    expect(probe?.gateBody).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The NON-ADMIN pass. Both other passes carry an admin session, so a dashboard
// read wrongly raised to `requireAdmin` sweeps green — the "broken dashboard"
// half of the same asymmetry, and the one a user reports rather than an
// attacker finds.
// ---------------------------------------------------------------------------

describe("the session surface is a closed list", () => {
  test("the dashboard reads a plain signed-in user must be able to make", () => {
    for (const label of [
      "GET /api/profile",
      "GET /api/history",
      "GET /api/history/rollup",
      "GET /api/cost",
      "GET /api/energy/series",
      "GET /api/statistics/heatmap",
      "GET /api/custom-charts",
      "GET /api/settings/display",
    ]) {
      expect(isSessionLabel(label)).toBe(true);
    }
  });

  test("no configuration read is on it — those are admin", () => {
    for (const label of [
      "GET /api/status",
      "GET /api/settings/inverter",
      "GET /api/settings/tariff",
      "GET /api/profiles/updates",
      "GET /api/admin/api-keys",
    ]) {
      expect(isSessionLabel(label)).toBe(false);
    }
  });

  test("no write is on it: every mutation in this app is admin-only", () => {
    for (const label of SESSION_LABELS) expect(label.startsWith("GET ")).toBe(true);
  });

  test("a public route is not a session route — it needs no credentials at all", () => {
    for (const label of PUBLIC_LABELS) expect(isSessionLabel(label)).toBe(false);
  });
});

describe("classifying a NON-ADMIN probe", () => {
  const member = (label: string, status: number) =>
    classifyAuth({ label }, { status, body: "" }, "member");
  const memberWrite = (label: string, status: number) =>
    classifyAuth({ label, body: "{}" }, { status, body: "" }, "member");

  test("a dashboard read that refuses a signed-in user FAILS — that is over-gating", () => {
    const verdict = member("GET /api/history", 403);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/over-gat|non-admin|dashboard/i);
    expect(member("GET /api/history", 401).ok).toBe(false);
  });

  test("a dashboard read the user reaches passes, whatever the handler then says", () => {
    expect(member("GET /api/history", 200).ok).toBe(true);
    expect(member("GET /api/profile", 503).ok).toBe(true);
  });

  test("an admin route must still refuse a plain user", () => {
    expect(member("GET /api/settings/inverter", 403).ok).toBe(true);
    const verdict = member("GET /api/settings/inverter", 200);
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/non-admin|admin/i);
  });

  test("an admin WRITE answering 422 to a plain user is unproven here too", () => {
    const verdict = memberWrite("POST /api/commands/setting", 422);
    expect(verdict.unproven).toBe(true);
  });

  test("a public route must not refuse a signed-in user either", () => {
    expect(member("GET /healthz", 401).ok).toBe(false);
    expect(member("GET /api/setup-status", 200).ok).toBe(true);
  });

  test("the API-key surface refusing a cookie-only user is correct", () => {
    expect(member("GET /api/v1/entities", 401).ok).toBe(true);
  });
});

describe("the live socket for a non-admin", () => {
  test("the upgrade is requireSession, so a plain user must get one", () => {
    expect(classifyUpgrade("opened", "member").ok).toBe(true);
    const verdict = classifyUpgrade("refused", "member");
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toMatch(/dashboard|refused/i);
  });
});
