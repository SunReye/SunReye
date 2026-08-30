/**
 * ROUTE SMOKE, the part that needs no Docker: the target pinning, the plan, the
 * sampling, the verdicts. `./route-smoke.ts` is the command,
 * `./route-smoke-run.ts` the driver that boots things; this is what both agree
 * on, and the only one of the three a unit test can hold still.
 *
 * The layer the harness closes is named in `route-layer-has-no-automated-cover`: the
 * unit suite stops below `apps/server/src/routes/*`, the browser suite fakes the
 * backend entirely (`apps/web/e2e/support/api-mock.ts` — no Elysia, no Postgres,
 * no inverter), and the database suite proves statements without the handlers
 * that compose them. Two 500s shipped behind a fully green suite through that
 * gap: an ambiguous `time_bucket` overload and an `ORDER BY` that bound to a
 * UNION instead of its arm. Both were a booted server away from being obvious.
 *
 * So this harness boots one. It starts its own TimescaleDB, migrates it, seeds
 * the committed sample profile so the generated `/api/v1` surface exists, runs
 * the server with `INVERTER_SIMULATE=true` long enough that the simulator has
 * written real rows, then walks `/openapi/json` and hits everything.
 *
 * ## What counts as a failure
 *
 * A 5xx, and a request that never came back. Nothing else — a 4xx means the
 * handler RAN and refused the input, which is exactly what a probe carrying an
 * empty body and a placeholder id should get. Response shapes are out of scope
 * by design; correctness stays in the unit and database suites. This layer
 * answers one question: does the route execute.
 *
 * ## Two floors, because a silent shrink is the failure mode
 *
 * An empty sweep and a nearly-empty one both fail ({@link summarize}). The
 * OpenAPI document is generated from the ACTIVE PROFILE, so a seeding slip
 * would drop every entity and command route and leave a green run that proved
 * almost nothing.
 *
 * Run `bun scripts/route-smoke.ts --help`.
 */

/** The developer's dev database. Shared with a live grid-tied inverter. */
export const DEV_DB_PORT = 5432;

/** The throwaway this harness creates, drops and recreates. */
export const DEFAULT_DB_PORT = 5433;

/** Where the booted server listens, unless `--port` moves it. */
export const DEFAULT_SERVER_PORT = 3999;

/**
 * Below this many probed routes the sweep is not a sweep. The generated
 * `/api/v1` surface alone is far larger; a run that finds fewer has lost the
 * profile, and a green report would be a lie about coverage rather than a
 * result. Measured against the sample profile, which yields ~180.
 */
export const MIN_ROUTES = 40;

/** How long the simulator runs before the sweep, so history reads see rows. */
export const DEFAULT_WARMUP_MS = 20_000;

/** A path parameter the run could not discover a real value for. */
export const MISSING_SAMPLE = "route-smoke-absent";

export class SmokeTargetError extends Error {}

/**
 * Refuse anything but a real, non-production port.
 *
 * The dev database on 5432 is shared with a live inverter and this harness
 * DROPs and seeds its target — the same pinning `fixture-1-2-0.ts`,
 * `replay-rehearsal.ts` and `apps/server/db-tests/harness.ts` each apply to
 * theirs, for the same reason.
 */
export function assertSmokeTarget(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new SmokeTargetError(`not a TCP port: ${port}`);
  }
  if (port === DEV_DB_PORT) {
    throw new SmokeTargetError(
      `refusing port ${DEV_DB_PORT}: that is the dev database, which is shared with a live ` +
        `grid-tied inverter. This harness drops and re-seeds its target — use ${DEFAULT_DB_PORT}.`,
    );
  }
}

export interface SmokeOptions {
  help: boolean;
  /** Port the throwaway TimescaleDB listens on. Never {@link DEV_DB_PORT}. */
  dbPort: number;
  /** Port the booted server listens on. */
  port: number;
  /** Simulator warmup before the sweep, ms. */
  warmupMs: number;
  /** Leave the container and database up for inspection after the run. */
  keep: boolean;
}

export const HELP = `route-smoke.ts — boot the server and smoke every route in the OpenAPI listing.

  bun scripts/route-smoke.ts [options]

Starts a throwaway TimescaleDB, migrates it, seeds the committed sample profile,
boots the server with INVERTER_SIMULATE=true, lets the simulator record for a
while, then hits every route. A 5xx (or no response at all) fails the run; a 4xx
passes — the handler ran and refused the input.

  --db-port=N   throwaway database port (default ${DEFAULT_DB_PORT}; ${DEV_DB_PORT} is refused)
  --port=N      port the server listens on (default ${DEFAULT_SERVER_PORT})
  --warmup=MS   simulator warmup before the sweep (default ${DEFAULT_WARMUP_MS})
  --keep        leave the container up afterwards
  --help        this text
`;

const NUMERIC_FLAGS = {
  "--db-port": "dbPort",
  "--port": "port",
  "--warmup": "warmupMs",
} as const;

export function parseArgs(argv: readonly string[]): SmokeOptions {
  const options: SmokeOptions = {
    help: false,
    dbPort: DEFAULT_DB_PORT,
    port: DEFAULT_SERVER_PORT,
    warmupMs: DEFAULT_WARMUP_MS,
    keep: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    const [flag, raw] = splitFlag(arg);
    const key = NUMERIC_FLAGS[flag as keyof typeof NUMERIC_FLAGS];
    if (!key) throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${flag} needs a number, got: ${raw}`);
    options[key] = value;
  }
  assertSmokeTarget(options.dbPort);
  return options;
}

function splitFlag(arg: string): [string, string] {
  const at = arg.indexOf("=");
  return at === -1 ? [arg, ""] : [arg.slice(0, at), arg.slice(at + 1)];
}

/** The slice of JSON Schema an Elysia/TypeBox route emits that we sample from. */
export interface SchemaLike {
  type?: string;
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  minimum?: number;
  anyOf?: SchemaLike[];
  oneOf?: SchemaLike[];
}

export interface OpenApiParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: SchemaLike;
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: unknown;
}

export interface OpenApiDoc {
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

export interface Probe {
  method: string;
  /** The templated path, as the document spells it. */
  path: string;
  /** The path actually requested: parameters filled, query appended. */
  url: string;
  body?: string;
  /** `METHOD /templated/path` — the identity a failure is reported under. */
  label: string;
}

const HOUR_MS = 3_600_000;

/** One attempt at a value; `undefined` means "not my kind of parameter". */
type SampleRule = (name: string, schema: SchemaLike, nowMs: number) => string | undefined;

/**
 * The rules that pick a value for a required query parameter, IN ORDER. Each
 * answers for the shapes it recognises and passes otherwise, so the precedence
 * is the list itself rather than a chain of conditions.
 *
 * The route's own vocabulary comes first: a declared enum member or default is
 * a value the handler is documented to accept, and anything invented here is a
 * guess. `!== undefined` throughout — `0` and `false` are values, not absences.
 */
const SAMPLE_RULES: readonly SampleRule[] = [
  (_name, schema) => stringOrUndefined(schema.enum?.[0] ?? schema.const),
  (_name, schema) => stringOrUndefined(schema.default),
  (name, schema, nowMs) =>
    isInstant(name, schema) ? new Date(instantFor(name, nowMs)).toISOString() : undefined,
  (_name, schema) =>
    schema.type === "number" || schema.type === "integer" ? String(schema.minimum ?? 1) : undefined,
  (_name, schema) => (schema.type === "boolean" ? "false" : undefined),
];

const stringOrUndefined = (value: unknown) => (value === undefined ? undefined : String(value));

/**
 * One value for a required query parameter, chosen so the route ACCEPTS it — a
 * rejected value would turn every probe into a 422 and prove nothing beyond
 * validation. A parameter no rule recognises still gets a value: dropping it
 * would silently change the request into one the route never sees.
 */
function sampleValue(param: OpenApiParameter, nowMs: number): string {
  const schema = flatten(param.schema ?? {});
  for (const rule of SAMPLE_RULES) {
    const value = rule(param.name, schema, nowMs);
    if (value !== undefined) return value;
  }
  return "route-smoke";
}

/** Collapse a `t.Union` (`anyOf`/`oneOf`) onto its first branch. */
function flatten(schema: SchemaLike): SchemaLike {
  const branches = schema.anyOf ?? schema.oneOf;
  const first = branches?.[0];
  if (!first) return schema;
  return { ...first, enum: schema.enum ?? first.enum, default: schema.default ?? first.default };
}

const INSTANT_NAMES = new Set(["from", "to", "start", "end", "since", "until", "at"]);
const isInstant = (name: string, schema: SchemaLike) =>
  schema.format === "date-time" || INSTANT_NAMES.has(name);

/** A window that is ordered and non-empty: openers look back a day, closers are now. */
const instantFor = (name: string, nowMs: number) =>
  name === "from" || name === "start" || name === "since" ? nowMs - 24 * HOUR_MS : nowMs;

/**
 * The query string for one operation: every REQUIRED query parameter, and
 * nothing else. An optional parameter left out is the route's default path,
 * which is the one worth smoking.
 */
export function sampleQuery(
  parameters: readonly OpenApiParameter[] | undefined,
  nowMs: number,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const param of parameters ?? []) {
    if (param.in !== "query" || !param.required) continue;
    query[param.name] = sampleValue(param, nowMs);
  }
  return query;
}

/**
 * Fill `{param}` segments from the values the run discovered. A parameter with
 * no sample gets {@link MISSING_SAMPLE} rather than an empty string: an empty
 * substitution silently changes WHICH route is hit, while a placeholder asks
 * the handler for something that does not exist — which must be a 404.
 */
export function fillPath(path: string, samples: Record<string, string>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(samples[name] ?? MISSING_SAMPLE),
  );
}

/** Methods worth probing. HEAD and OPTIONS mirror routes already covered. */
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Reads first, then writes, then deletes — a DELETE must not empty a read. */
const METHOD_ORDER: Record<string, number> = { get: 0, post: 1, put: 1, patch: 1, delete: 2 };

/**
 * Paths that are not JSON handlers: the Scalar UI and its own document, and the
 * websocket upgrade (a plain GET there is a protocol error, not a route bug).
 * Better Auth is mounted raw and owns its contract — the harness signs in
 * through it, which is cover enough.
 */
const SKIP = (path: string) =>
  path === "/openapi" ||
  path.startsWith("/openapi/") ||
  path === "/ws" ||
  path.startsWith("/api/auth/");

/**
 * Operations that would END THE RUN they belong to, by `METHOD /path`.
 *
 * Not a list of routes that are allowed to be broken — a list of routes whose
 * effect is to destroy the sweep's own subject. `POST /api/admin/restart`
 * answers `{ ok: true }` and then exits the process 150 ms later for a
 * supervisor to relaunch; probing it turns every later probe into "connection
 * refused" and, worse, would do so non-deterministically depending on where the
 * ordering put it. Keep this list at exactly that: self-termination, nothing
 * else. A route that merely deletes data is fine here — the database is a
 * throwaway, and reads are probed first.
 */
export const SKIP_LABELS: readonly string[] = ["POST /api/admin/restart"];

export const probeLabel = (probe: Probe): string => probe.label;

export interface PlanContext {
  /** Real ids discovered from the booted server, by path-parameter name. */
  samples: Record<string, string>;
  nowMs: number;
}

/** One operation as a request, or `undefined` when it is not to be probed. */
function probeFor(
  path: string,
  method: (typeof METHODS)[number],
  operation: OpenApiOperation | undefined,
  ctx: PlanContext,
): Probe | undefined {
  const label = `${method.toUpperCase()} ${path}`;
  if (!operation || SKIP_LABELS.includes(label)) return undefined;
  const query = new URLSearchParams(sampleQuery(operation.parameters, ctx.nowMs)).toString();
  return {
    method: method.toUpperCase(),
    path,
    url: fillPath(path, ctx.samples) + (query ? `?${query}` : ""),
    // An empty object, not a synthesised body: a 4xx from validation is a pass,
    // so guessing at a valid payload would buy nothing and could write nonsense
    // through a command route.
    body: method === "get" ? undefined : "{}",
    label,
  };
}

/** Every route in the document, as requests, reads before writes. */
export function planProbes(doc: OpenApiDoc, ctx: PlanContext): Probe[] {
  const probes = Object.entries(doc.paths ?? {})
    .filter(([path]) => !SKIP(path))
    .flatMap(([path, operations]) =>
      METHODS.map((method) => probeFor(path, method, operations[method], ctx)),
    )
    .filter((probe): probe is Probe => probe !== undefined);
  return probes.sort((a, b) => order(a) - order(b));
}

const order = (probe: Probe) => METHOD_ORDER[probe.method.toLowerCase()] ?? 1;

/** What came back from one probe: a status, or the reason there is none. */
export interface ProbeResponse {
  status?: number;
  body?: string;
  error?: string;
}

export interface ProbeResult {
  label: string;
  ok: boolean;
  /** Status and, on a failure, the excerpt that names the cause. */
  detail: string;
}

/** Statuses a named route is allowed to answer with, e.g. `{"GET /x": [503]}`. */
export type StatusAllowList = Readonly<Record<string, readonly number[]>>;

/** How much of a 5xx body is worth carrying into the report. */
const EXCERPT = 300;

/**
 * The verdict for one response. A 5xx fails; so does silence, which is what a
 * server that died mid-sweep looks like. Everything else passes: a 4xx means
 * the handler ran and refused, which is the expected answer to a probe carrying
 * an empty body and a placeholder id.
 */
export function classify(
  probe: Pick<Probe, "label">,
  response: ProbeResponse,
  allow: StatusAllowList = {},
): ProbeResult {
  const { label } = probe;
  if (response.status === undefined) {
    return { label, ok: false, detail: `no response: ${response.error ?? "unknown error"}` };
  }
  const allowed = allow[label]?.includes(response.status) ?? false;
  const ok = response.status < 500 || allowed;
  const excerpt = ok ? "" : ` ${(response.body ?? "").slice(0, EXCERPT)}`;
  return { label, ok, detail: `${response.status}${excerpt}`.trimEnd() };
}

export interface SmokeVerdict {
  ok: boolean;
  exitCode: number;
  text: string;
}

/**
 * The run's verdict. Two floors rather than one: an empty sweep and a shrunken
 * one both fail, because the document is generated from the active profile and
 * a seeding slip would otherwise report a clean run over nothing.
 */
export function summarize(results: readonly ProbeResult[], minRoutes = MIN_ROUTES): SmokeVerdict {
  const failures = results.filter((r) => !r.ok);
  const lines = failures.map((r) => `  ${r.label} -> ${r.detail}`);
  if (results.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      text: "no routes were probed — the OpenAPI listing was empty",
    };
  }
  if (results.length < minRoutes) {
    return {
      ok: false,
      exitCode: 1,
      text:
        `only ${results.length} routes were probed; expected at least ${minRoutes}. ` +
        `The generated API comes from the active profile — check that it was seeded.`,
    };
  }
  if (failures.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      text: `${failures.length} of ${results.length} routes answered 5xx:\n${lines.join("\n")}`,
    };
  }
  return { ok: true, exitCode: 0, text: `${results.length} routes probed, none answered 5xx` };
}
