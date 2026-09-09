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
 * Two questions, asked over the same plan.
 *
 * **Does the route execute** ({@link classify}): a 5xx fails, and so does a
 * request that never came back. Nothing else — a 4xx means the handler RAN and
 * refused the input, which is exactly what a probe carrying an empty body and a
 * placeholder id should get. Response shapes are out of scope by design;
 * correctness stays in the unit and database suites.
 *
 * **Was the caller allowed to make it execute** ({@link classifyAuth}): the
 * listing is swept twice more, with no credentials and then with a plain
 * non-admin session. Everything outside {@link PUBLIC_LABELS} must refuse the
 * stranger; everything on {@link SESSION_LABELS} must ANSWER the ordinary user,
 * and everything else must still refuse them. That half exists because the
 * first one cannot see either defect it is aimed at — a configuration read left
 * ungated answers 200 to a stranger and sweeps perfectly green (issue #174),
 * and a dashboard read wrongly raised to admin works perfectly for the only
 * person who ever tests it. The authenticated pass carries the mirror claim:
 * nothing may 401 the harness's own admin session and API key, or the sweep
 * would be reporting refusals as passes and proving nothing about the handlers
 * behind them.
 *
 * A write is only asked its access question honestly if the request gets PAST
 * validation, because Elysia validates a declared body before the gate runs:
 * both credentialled passes therefore send {@link Probe.gateBody}, synthesised
 * from the route's own `requestBody`, and anything that still answers 422 is
 * reported UNPROVEN rather than counted as a gate that held
 * ({@link MAX_UNPROVEN_GATES}).
 *
 * ## Proving the sweep had something to sweep
 *
 * A green run over a listing that lost its profile would be a lie about
 * coverage, so the run refuses to start one: {@link generatedSurfaceProblem}
 * asserts POSITIVELY that the routes only an active profile can produce — the
 * entity catalog and the per-writable-metric command routes — are in the
 * document. That is the whole seeding guard. It cannot be done by counting: the
 * hand-written routes are mounted unconditionally (profile-dependent handlers
 * answer 503 ONBOARDING_REQUIRED rather than vanishing), so an unseeded run
 * still probes most of the listing.
 *
 * {@link summarize} then keeps two coarse floors — an empty sweep, and one far
 * below the measured size — as a sanity check on the listing itself.
 *
 * Measured 2026-08-30 against the committed sample profile: 131 routes probed,
 * 43 of them generated (4 catalog routes + 39 command routes, one per writable
 * metric) and 88 hand-written. The same server booted WITHOUT the seeding step
 * still lists 68 paths / 151 operations and would probe 88 routes — which is
 * exactly why the guard asks for the generated routes by name.
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
 * A raw sanity floor on the size of the listing, and NOTHING MORE.
 *
 * It catches a document that shrank wholesale — a truncated `/openapi/json`, a
 * route group that failed to mount. It is NOT the profile seeding guard, and
 * must never be relied on as one: the hand-written routes mount unconditionally
 * (a profile-dependent handler answers 503 ONBOARDING_REQUIRED rather than
 * disappearing), so their number is unrelated to whether the profile seeded and
 * grows on its own. {@link generatedSurfaceProblem} is what proves the seeding.
 *
 * Derived from measurements taken 2026-08-30, not from a guess: against the
 * committed sample profile the harness probed 131 routes (43 generated — the
 * 4-route entity catalog plus one command route per writable metric — and 88
 * hand-written); booted with the seeding step skipped, the same document
 * yielded 88 probes. 100 leaves headroom for routes coming and going without
 * leaving room for the listing to halve unnoticed. That it currently also sits
 * above the 88 is an accident of today's split, not a second guard.
 */
export const MIN_ROUTES = 100;

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

/** The slice of a JSON Schema a request BODY is described by. */
export interface BodySchema extends SchemaLike {
  properties?: Record<string, BodySchema>;
  required?: string[];
  items?: BodySchema;
  minItems?: number;
  anyOf?: BodySchema[];
  oneOf?: BodySchema[];
}

export interface RequestBodyLike {
  content?: Record<string, { schema?: BodySchema }>;
}

export interface OpenApiOperation {
  parameters?: OpenApiParameter[];
  requestBody?: RequestBodyLike;
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
  /**
   * The payload the EXECUTION pass sends: `{}` for every write. Deliberately
   * not a valid one — that pass carries an admin session and would otherwise
   * write real registers on the inverter the harness booted.
   */
  body?: string;
  /**
   * The payload a CREDENTIALS pass sends: one the route's own schema accepts,
   * so validation cannot answer before the guard does. `undefined` when the
   * schema could not be synthesised — the probe then falls back to
   * {@link Probe.body} and its 422 is reported UNPROVEN rather than as a pass.
   */
  gateBody?: string;
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

// ---------------------------------------------------------------------------
// SYNTHESISING A BODY, and why the sweep is worthless without one.
//
// Elysia 2 validates a route's declared body BEFORE `beforeHandle`, where this
// app's gates live. Send `{}` to a write route with no credentials and the
// answer is 422 from the schema — with the guard never consulted. A GATED write
// and an UNGATED write are then indistinguishable: both answer 422, and a sweep
// that reads that as "the gate held" has silently blanked the entire write
// surface, register writes included, under a green summary line.
//
// So the credentials passes send a payload the route's own `requestBody`
// ACCEPTS. Validation passes, the request reaches `beforeHandle`, and the
// 401/403 that comes back is the gate actually answering. What cannot be
// synthesised is reported UNPROVEN rather than passed (see
// {@link anonymousVerdict} and {@link MAX_UNPROVEN_GATES}).
//
// The values are minimal on purpose — required properties only, minimums rather
// than midpoints, the first enum member. A synthesised body is a key turned in
// a lock, not a payload anyone wants executed; the execution pass keeps sending
// `{}` precisely so an admin-credentialled probe never writes a real register.
// ---------------------------------------------------------------------------

/** The media type the whole engine speaks; anything else is not synthesised. */
const JSON_MEDIA_TYPE = "application/json";

/** One attempt at a body value; `undefined` means "not my kind of schema". */
type BodyRule = (name: string, schema: BodySchema, nowMs: number) => unknown;

/** An array short enough to be legal and long enough to be one: `minItems`, or none. */
function sampleArray(name: string, schema: BodySchema, nowMs: number): unknown[] | undefined {
  if ((schema.minItems ?? 0) === 0) return [];
  const item = schema.items ? sampleSchemaValue(name, schema.items, nowMs) : undefined;
  return item === undefined ? undefined : [item];
}

/** A string the route recognises: an instant where the name says so, else a marker. */
const sampleString = (name: string, schema: BodySchema, nowMs: number) =>
  isInstant(name, schema) ? new Date(instantFor(name, nowMs)).toISOString() : "route-smoke";

/**
 * The rules that pick one body value, IN ORDER — the same shape as
 * {@link SAMPLE_RULES}, and for the same reason: the route's own vocabulary
 * (an enum member, a literal, a declared default) beats anything invented here.
 */
const BODY_RULES: readonly BodyRule[] = [
  (_name, schema) => schema.enum?.[0],
  (_name, schema) => schema.const,
  (_name, schema) => schema.default,
  (_name, schema, nowMs) =>
    schema.type === "object" || schema.properties ? sampleObject(schema, nowMs) : undefined,
  (name, schema, nowMs) => (schema.type === "array" ? sampleArray(name, schema, nowMs) : undefined),
  (_name, schema) =>
    schema.type === "number" || schema.type === "integer" ? (schema.minimum ?? 1) : undefined,
  (_name, schema) => (schema.type === "boolean" ? false : undefined),
  (name, schema, nowMs) =>
    schema.type === "string" ? sampleString(name, schema, nowMs) : undefined,
];

/** A value for one property, or `undefined` when no rule understands it. */
function sampleSchemaValue(name: string, raw: BodySchema, nowMs: number): unknown {
  const schema = flattenBody(raw);
  for (const rule of BODY_RULES) {
    const value = rule(name, schema, nowMs);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Collapse a union onto the first branch that is not `null`. A `nullable`
 * TypeBox field is `anyOf: [T, {type:"null"}]`, and sending `null` for a
 * required field is exactly the payload a schema tends to refuse.
 */
function flattenBody(schema: BodySchema): BodySchema {
  const branches = schema.anyOf ?? schema.oneOf;
  if (!branches?.length) return schema;
  const first = branches.find((branch) => branch.type !== "null") ?? branches[0];
  return {
    ...first,
    enum: schema.enum ?? first?.enum,
    default: schema.default ?? first?.default,
  } as BodySchema;
}

/**
 * One object, carrying its REQUIRED properties and nothing else. A property no
 * rule understands makes the whole object unsynthesisable: a body missing a
 * required field is refused by the schema, which is the case this exists to
 * avoid.
 */
function sampleObject(schema: BodySchema, nowMs: number): Record<string, unknown> | undefined {
  const built: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const property = schema.properties?.[name];
    if (!property) return undefined;
    const value = sampleSchemaValue(name, property, nowMs);
    if (value === undefined) return undefined;
    built[name] = value;
  }
  return built;
}

/**
 * A JSON body one operation's schema accepts, or `undefined` when it cannot be
 * built. An operation that declares NO JSON body — including `t.Unknown()`,
 * which is what the admin settings PUTs use — is answered `{}`: that is already
 * a payload validation lets past, so those gates were never blind.
 */
export function sampleBody(operation: OpenApiOperation, nowMs: number): string | undefined {
  const content = operation.requestBody?.content;
  if (!content) return "{}";
  // A body declared in some other media type is a route this synthesiser has no
  // business guessing at; say so rather than send JSON at it.
  if (!(JSON_MEDIA_TYPE in content)) return Object.keys(content).length === 0 ? "{}" : undefined;
  const schema = content[JSON_MEDIA_TYPE]?.schema;
  if (!schema) return "{}";
  const flattened = flattenBody(schema);
  if (flattened.type !== undefined && flattened.type !== "object") return undefined;
  const built = sampleObject(flattened, nowMs);
  return built === undefined ? undefined : JSON.stringify(built);
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
  const isRead = method === "get";
  return {
    method: method.toUpperCase(),
    path,
    url: fillPath(path, ctx.samples) + (query ? `?${query}` : ""),
    // An empty object for the EXECUTION pass: a 4xx from validation is a pass
    // there, and that pass carries an admin session — a valid payload would
    // write real registers through a command route.
    body: isRead ? undefined : "{}",
    // A payload the schema accepts for the CREDENTIALS passes, where the point
    // is to get past validation and make the gate answer for itself.
    gateBody: isRead ? undefined : sampleBody(operation, ctx.nowMs),
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

/** Everything `entitiesApi()` mounts, and only while a profile is active. */
const GENERATED_PREFIX = "/api/v1/";
/** The generated per-entity write routes: one per writable metric, key spelled out. */
const COMMAND_PREFIX = "/api/v1/entities/";
const COMMAND_METHODS = new Set(["put", "post", "patch"]);
/** The discovery route a consumer reads first; absent without a profile. */
export const CATALOG_LABEL = "GET /api/v1/entities";

/** The operations in a document that exist ONLY because a profile is active. */
export interface GeneratedSurface {
  /** The catalog and the other read routes under `/api/v1`. */
  catalog: string[];
  /** `PUT /api/v1/entities/<key>` — one per writable metric, no templating. */
  commands: string[];
}

/**
 * Split the generated surface out of an OpenAPI document.
 *
 * A path segment spelled `{like this}` is a hand-written route with a
 * parameter; the generated command routes name their entity key literally,
 * because they are built by folding over `writableMetrics(profile)`.
 */
export function generatedSurface(doc: OpenApiDoc): GeneratedSurface {
  const surface: GeneratedSurface = { catalog: [], commands: [] };
  for (const { path, method } of generatedOperations(doc.paths)) {
    const bucket = isGeneratedCommand(path, method) ? "commands" : "catalog";
    surface[bucket].push(`${method.toUpperCase()} ${path}`);
  }
  return surface;
}

/** Every operation the document lists under `/api/v1`, as path/method pairs. */
const generatedOperations = (paths: OpenApiDoc["paths"]) =>
  Object.entries(paths ?? {})
    .filter(([path]) => path.startsWith(GENERATED_PREFIX))
    .flatMap(([path, operations]) =>
      METHODS.filter((method) => operations[method]).map((method) => ({ path, method })),
    );

const isGeneratedCommand = (path: string, method: string) =>
  COMMAND_METHODS.has(method) && path.startsWith(COMMAND_PREFIX) && !path.includes("{");

/**
 * Why this document proves nothing, or `undefined` when it does prove
 * something. THE guard against a profile seeding slip, and the reason
 * {@link MIN_ROUTES} is not one.
 *
 * The check is positive on purpose: it asks whether the routes that can only
 * come from an active profile are actually there, rather than inferring it from
 * a total. Counting cannot answer the question — the hand-written routes are
 * mounted whether or not a profile exists (the profile-dependent ones answer
 * 503 ONBOARDING_REQUIRED), so a run that seeded nothing still sweeps most of
 * the listing and reports green over a surface with no entities in it.
 */
export function generatedSurfaceProblem(doc: OpenApiDoc): string | undefined {
  const { catalog, commands } = generatedSurface(doc);
  const missing: string[] = [];
  if (!catalog.includes(CATALOG_LABEL)) missing.push(`the entity catalog (${CATALOG_LABEL})`);
  if (commands.length === 0) {
    missing.push(
      "every generated command route (PUT /api/v1/entities/<key>, one per writable metric)",
    );
  }
  if (missing.length === 0) return undefined;
  return (
    `the OpenAPI listing is missing ${missing.join(" and ")}. Those routes exist only while a ` +
    `profile is ACTIVE, so the profile was not seeded or did not activate. The hand-written ` +
    `routes are mounted either way, so the sweep would otherwise have gone green over a ` +
    `fraction of the surface it claims to cover.`
  );
}

/** What came back from one probe: a status, or the reason there is none. */
export interface ProbeResponse {
  status?: number;
  body?: string;
  error?: string;
}

export interface ProbeResult {
  label: string;
  ok: boolean;
  /**
   * The gate was never asked: not a leak, and NOT a pass either. Counted
   * separately, kept out of every "the gates held" claim, and held to
   * {@link MAX_UNPROVEN_GATES} by {@link summarizeAuth}.
   */
  unproven?: boolean;
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

// ---------------------------------------------------------------------------
// THE AUTH SWEEP
//
// `classify` above answers one question — did the handler run. It cannot answer
// the other one: was the caller allowed to make it run. A configuration read
// left ungated answers 200 to a stranger and sweeps green, which is exactly the
// defect this half exists to make impossible (issue #174).
//
// Three passes over the same plan, with different credentials:
//
//   anonymous     — everything must refuse (401/403) EXCEPT {@link PUBLIC_LABELS}.
//   member        — a plain signed-in NON-ADMIN. {@link SESSION_LABELS} must be
//                   REACHABLE; everything else gated must still refuse. Without
//                   it, over-gating is invisible: a dashboard read wrongly
//                   raised to `requireAdmin` sweeps green in both other passes,
//                   because both carry an admin session, and the defect only
//                   surfaces as a user's dashboard that is empty for everyone
//                   but the developer who wrote it.
//   authenticated — nothing may refuse: the harness's admin session and API key
//                   between them have to cover every gate, or the sweep is
//                   reporting 401s as passes and proving nothing about the
//                   handlers behind them.
//
// Each credentialled pass sends {@link Probe.gateBody}, a payload the route's
// own schema accepts, so a write's guard is reached instead of its validator.
//
// `/openapi*`, `/api/auth/*` and `/ws` never reach here: {@link planProbes}
// skips them, so they need no entry on either side.
// ---------------------------------------------------------------------------

/** Which credentials a sweep carried. */
export type AuthMode = "anonymous" | "member" | "authenticated";

/**
 * The closed list of routes that must answer WITHOUT credentials, and the whole
 * public surface of the engine's JSON API.
 *
 * Every one of them is a PRE-AUTH gate the web shell has to read before it can
 * know whether to show a login page at all:
 *
 *  * `/healthz` — the addon watchdog and compose healthcheck probe it, neither
 *    of which has a session.
 *  * `/api/setup-status` — true until the first (admin) account exists. The
 *    onboarding flow cannot authenticate to ask whether it should run.
 *  * `/api/profile-status` — true until a profile is active, read by the same
 *    unauthenticated onboarding flow.
 *  * `/api/access-status` — the anonymous-dashboard toggle ALONE, as a boolean,
 *    so a logged-out visitor can be sent to the kiosk view or the login page.
 *    Deliberately not the rest of the access config, which stays admin-only
 *    behind `/api/settings/access`.
 *
 * Anything added here widens the unauthenticated surface of the product. It is
 * a list, not a prefix rule, on purpose: a prefix would silently adopt the next
 * route mounted underneath it.
 */
export const PUBLIC_LABELS: readonly string[] = [
  "GET /healthz",
  "GET /api/setup-status",
  "GET /api/profile-status",
  "GET /api/access-status",
];

const PUBLIC_SET = new Set(PUBLIC_LABELS);

/**
 * The SvelteKit build, served by `apps/server/src/web/static.ts` — public on
 * every method, because a logged-out visitor has to be able to load the app
 * before there is anything to log in to. It is a wildcard the ROUTER matches,
 * not a prefix rule: the handler refuses `/api`, `/openapi`, `/ws` and
 * `/healthz` itself so an API typo cannot fall through to a page of HTML, and
 * only `GET`/`HEAD` ever return bytes.
 */
const SPA_WILDCARD = "/*";

/** Whether `METHOD /path` is declared public. Exact match — never a prefix. */
export const isPublicLabel = (label: string): boolean =>
  PUBLIC_SET.has(label) || label.endsWith(` ${SPA_WILDCARD}`);

/**
 * The closed list of routes a PLAIN SIGNED-IN USER must be able to reach —
 * every `requireSession` route in `apps/server/src`, which is to say the
 * dashboard.
 *
 * This list is read in BOTH directions, and that is the point:
 *
 *  * a route ON it that refuses a non-admin is OVER-GATED — the dashboard is
 *    broken for every user who is not the developer, and no other check in this
 *    repo can see it, since the anonymous and authenticated passes both carry
 *    an admin session.
 *  * a route NOT on it that ANSWERS a non-admin is under-gated: a configuration
 *    read or a mutation reachable by any account the admin ever created.
 *
 * A newly mounted route therefore defaults to "must be admin-only", which is
 * the fail-safe direction: forgetting to add a dashboard read here goes red,
 * forgetting to remove a config read does not go quietly green.
 *
 * Every entry is a GET. Every mutation in this app is `requireAdmin`, and the
 * "no write is on it" test keeps that true by construction.
 */
export const SESSION_LABELS: readonly string[] = [
  "GET /api/battery/health",
  "GET /api/cost",
  "GET /api/cost/series",
  "GET /api/custom-charts",
  "GET /api/energy/series",
  "GET /api/evcc",
  "GET /api/forecast",
  "GET /api/forecast/correction",
  "GET /api/forecast/usable",
  "GET /api/history",
  "GET /api/history/recent",
  "GET /api/history/rollup",
  "GET /api/migration/status",
  "GET /api/prices",
  "GET /api/profile",
  "GET /api/settings/chart-palette",
  "GET /api/settings/display",
  "GET /api/settings/statistics",
  "GET /api/settings/ui",
  "GET /api/sources",
  "GET /api/statistics/amortisation",
  "GET /api/statistics/comparison",
  "GET /api/statistics/heatmap",
  "GET /api/statistics/prices",
  "GET /api/statistics/records",
  "GET /api/weather",
];

const SESSION_SET = new Set(SESSION_LABELS);

/** Whether `METHOD /path` must be reachable by any signed-in user. */
export const isSessionLabel = (label: string): boolean => SESSION_SET.has(label);

/** What a gate looks like from outside: it refused, without running the handler. */
const REFUSALS = new Set([401, 403]);

/**
 * The status that means THE SCHEMA answered, not the gate.
 *
 * Elysia 2 validates a route's declared body BEFORE `beforeHandle`, where this
 * app's gates live, so a payload the schema refuses comes back 422 with the
 * guard never consulted. The handler still does not run — nothing privileged is
 * reachable — and the ordering is not fixable from the guard
 * (`apps/server/src/routes/admin-guard.ts` records what was tried).
 *
 * What it is NOT is evidence about the gate. A gated write and an ungated write
 * answer 422 identically, so treating it as a pass blanks the write surface:
 * the register writes, the admin reset, the profile install, the API-key
 * mint. {@link Probe.gateBody} exists to stop it happening — and where a body
 * cannot be synthesised, the verdict is {@link unprovenVerdict}, never a pass.
 *
 * Only meaningful for a probe that actually carried a body: a GET's 422 came
 * from somewhere past the gate and is a leak.
 */
const SCHEMA_BEFORE_GATE = 422;

const pass = (label: string, detail: string): ProbeResult => ({ label, ok: true, detail });
const fail = (label: string, detail: string): ProbeResult => ({ label, ok: false, detail });

/** The gate was never asked. Not a leak; not a pass; counted and reported. */
const unprovenVerdict = (label: string, status: number): ProbeResult => ({
  label,
  ok: true,
  unproven: true,
  detail:
    `${status} — the SCHEMA refused the payload before the gate was consulted, so this ` +
    `route's guard is UNPROVEN. A body the schema accepts could not be synthesised from ` +
    `its OpenAPI requestBody.`,
});

/**
 * A route on {@link PUBLIC_LABELS}. It must not refuse ANYONE — that is the
 * half of a regression nobody notices, because the dashboard still works for
 * the developer who is logged in while the onboarding flow is dead for everyone
 * who is not.
 */
const publicVerdict = (label: string, status: number): ProbeResult =>
  REFUSALS.has(status)
    ? fail(label, `${status} — declared PUBLIC but refused the caller`)
    : pass(label, `${status}`);

/**
 * A route that MUST refuse these credentials, and what it is if it did not.
 *
 * Not "a 2xx leaked": anything that is not a refusal means the request reached
 * the handler, so a 404 from a missing id is the route RUNNING for a caller who
 * should never have got that far. The one answer that is neither is
 * {@link SCHEMA_BEFORE_GATE}, which is evidence about the schema and none at
 * all about the gate.
 */
function mustRefuse(
  label: string,
  status: number,
  sentBody: boolean,
  leak: (status: number) => string,
): ProbeResult {
  if (REFUSALS.has(status)) return pass(label, `${status}`);
  if (sentBody && status === SCHEMA_BEFORE_GATE) return unprovenVerdict(label, status);
  return fail(label, leak(status));
}

/** A gated route asked WITHOUT credentials. */
const anonymousVerdict = (label: string, status: number, sentBody: boolean): ProbeResult =>
  mustRefuse(
    label,
    status,
    sentBody,
    (answered) => `${answered} — answered a request with NO CREDENTIALS; this route is public`,
  );

/**
 * A route asked with a PLAIN SIGNED-IN NON-ADMIN session.
 *
 * The asymmetry both other passes are blind to, in both directions: a
 * {@link SESSION_LABELS} route that refuses is a dashboard broken for every
 * ordinary user, and any other gated route that answers is privileged surface
 * open to any account on the instance.
 */
function memberVerdict(label: string, status: number, sentBody: boolean): ProbeResult {
  if (isSessionLabel(label)) {
    return REFUSALS.has(status)
      ? fail(
          label,
          `${status} — a dashboard read (requireSession) refused a signed-in NON-ADMIN user. ` +
            `This route is OVER-GATED: the dashboard is broken for everyone who is not an admin.`,
        )
      : pass(label, `${status}`);
  }
  return mustRefuse(
    label,
    status,
    sentBody,
    (answered) =>
      `${answered} — answered a plain NON-ADMIN session; this route is not admin-only. ` +
      `Either it belongs on SESSION_LABELS or its gate is wrong.`,
  );
}

/**
 * A gated route asked WITH the harness's admin session and API key.
 *
 * This pass keeps sending `{}` rather than {@link Probe.gateBody}: it is the
 * only pass whose requests would actually be EXECUTED, and a valid payload here
 * would write inverter registers, reset the database or mint an API key. So its
 * claim is the narrow one — no gate refused these credentials — and the proof
 * that a write's guard refuses everyone else lives in the anonymous and member
 * passes, which send a payload the schema accepts precisely because nothing of
 * theirs is meant to run.
 */
const authenticatedVerdict = (label: string, status: number): ProbeResult =>
  REFUSALS.has(status)
    ? fail(
        label,
        `${status} — refused the harness's admin session and API key. Either the sweep's ` +
          `credentials do not cover this gate, or the route is gated wrongly.`,
      )
    : pass(label, `${status}`);

/**
 * The verdict on one probe's ACCESS, given the credentials it carried.
 *
 * Deliberately silent about 5xx: {@link classify} owns those. Reporting an
 * outage as an auth regression would send the next reader looking at the guards
 * for a database that was down.
 */
export function classifyAuth(
  probe: Pick<Probe, "label" | "body">,
  response: ProbeResponse,
  mode: AuthMode,
): ProbeResult {
  const { label } = probe;
  const status = response.status;
  if (status === undefined) {
    return fail(label, `no response: ${response.error ?? "unknown error"}`);
  }
  if (isPublicLabel(label)) return publicVerdict(label, status);
  const sentBody = probe.body !== undefined;
  if (mode === "anonymous") return anonymousVerdict(label, status, sentBody);
  if (mode === "member") return memberVerdict(label, status, sentBody);
  return authenticatedVerdict(label, status);
}

/** The live socket, reported under the label the HTTP plan skips. */
export const UPGRADE_LABEL = "WS /ws";

/** What happened when the harness tried to open the live socket. */
export type UpgradeOutcome = "opened" | "refused";

/**
 * The verdict on the `/ws` handshake.
 *
 * The multiplexed socket carries the `logs` topic (config values, hostnames,
 * error internals) and `automations` (what the engine writes to the inverter's
 * registers). The upgrade itself runs the weakest policy — `requireSession` —
 * and the per-topic decision is re-evaluated on every subscribe frame
 * (`apps/server/src/routes/ws-subscribe.ts`); this asks only the first
 * question, because it is the one no HTTP probe can ask: a plain GET to `/ws`
 * is a protocol error rather than an answer about access.
 */
export function classifyUpgrade(outcome: UpgradeOutcome, mode: AuthMode): ProbeResult {
  const label = UPGRADE_LABEL;
  const opened = outcome === "opened";
  if (mode === "anonymous") {
    return opened
      ? { label, ok: false, detail: "the handshake completed with NO CREDENTIALS" }
      : { label, ok: true, detail: "refused" };
  }
  const who = mode === "member" ? "a plain signed-in user" : "the admin session";
  return opened
    ? { label, ok: true, detail: "opened" }
    : {
        label,
        ok: false,
        detail: `refused ${who} — the live dashboard would never connect`,
      };
}

export interface SmokeVerdict {
  ok: boolean;
  exitCode: number;
  text: string;
}

/** How a mode's sweep describes itself in its own verdict. */
const MODE_TEXT: Record<AuthMode, string> = {
  anonymous: "anonymously (no credentials)",
  member: "as a plain signed-in NON-ADMIN session",
  authenticated: "as the admin session + API key",
};

/**
 * How many gates a pass may leave UNPROVEN and still be reported as a pass.
 *
 * Zero, and it is meant to stay zero. Every body-carrying route in the listing
 * gets a payload synthesised from its own `requestBody` ({@link sampleBody}),
 * so validation no longer answers before the guard for any of them; a route
 * that cannot be synthesised is a route whose gate this harness did not check,
 * and the run must say so out loud rather than count it green.
 *
 * Raising this number is a decision to ship a check that claims more than it
 * proved. If a new schema defeats the synthesiser, teach the synthesiser.
 */
export const MAX_UNPROVEN_GATES = 0;

const lines = (results: readonly ProbeResult[]) =>
  results.map((r) => `  ${r.label} -> ${r.detail}`).join("\n");

/**
 * The verdict on one auth pass. An empty pass FAILS in every mode: "nothing
 * refused me" over zero routes is the same clean-looking report as a sweep that
 * never ran, and this is the check whose whole value is that it ran.
 *
 * A pass with UNPROVEN gates never claims that every gate held, whatever the
 * floor is set to — the summary line is the only thing most readers see, and
 * the defect this harness was reviewed for was exactly a summary claiming proof
 * it did not have.
 */
export function summarizeAuth(
  results: readonly ProbeResult[],
  mode: AuthMode,
  maxUnproven = MAX_UNPROVEN_GATES,
): SmokeVerdict {
  const failures = results.filter((r) => !r.ok);
  const unproven = results.filter((r) => r.unproven);
  if (results.length === 0) {
    return {
      ok: false,
      exitCode: 1,
      text: `no routes were probed ${MODE_TEXT[mode]} — the access sweep proved nothing`,
    };
  }
  if (failures.length > 0) {
    return {
      ok: false,
      exitCode: 1,
      text:
        `${failures.length} of ${results.length} routes answered wrongly ${MODE_TEXT[mode]}:\n` +
        lines(failures),
    };
  }
  if (unproven.length > maxUnproven) {
    return {
      ok: false,
      exitCode: 1,
      text:
        `${unproven.length} of ${results.length} routes probed ${MODE_TEXT[mode]} left their ` +
        `gate UNPROVEN — the schema answered before the guard was consulted, so a gated and an ` +
        `UNGATED route are indistinguishable here (at most ${maxUnproven} may be):\n` +
        lines(unproven),
    };
  }
  if (unproven.length === 0) {
    return {
      ok: true,
      exitCode: 0,
      text: `${results.length} routes probed ${MODE_TEXT[mode]}; every gate held`,
    };
  }
  return {
    ok: true,
    exitCode: 0,
    text:
      `${results.length - unproven.length} of ${results.length} routes probed ` +
      `${MODE_TEXT[mode]} held their gate; ${unproven.length} left it UNPROVEN:\n` +
      lines(unproven),
  };
}

/**
 * The run's verdict. Two floors rather than one: an empty sweep and a listing
 * far below its measured size both fail, because a document that shrank
 * wholesale would otherwise report a clean run over almost nothing.
 *
 * Neither floor detects a profile seeding slip; nothing counted here can. That
 * is {@link generatedSurfaceProblem}'s job, and the run applies it to the
 * document before any of this.
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
        `The listing shrank — check that every route group still mounts and that ` +
        `/openapi/json was not truncated.`,
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
