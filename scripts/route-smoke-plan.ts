/**
 * ROUTE SMOKE, the part that needs no booted core: the plan, the sampling, the
 * verdicts. `./route-smoke.ts` is the command, `./route-smoke-run.ts` the
 * driver that builds and boots the Rust core; this is what both agree on, and
 * the only one of the three a unit test can hold still.
 *
 * The harness boots the core binary on a scratch data directory, signs up the
 * admin, has it create a plain account and an API key, then walks
 * `/openapi/json` and hits everything.
 *
 * ## What counts as a failure
 *
 * Two questions, asked over the same plan.
 *
 * **Does the route execute** ({@link classify}): a 5xx fails, and so does a
 * request that never came back. Nothing else — a 4xx means the handler RAN and
 * refused the input, which is exactly what a probe carrying an empty body
 * should get. Response shapes are out of scope by design;
 * correctness stays in the core's own tests.
 *
 * **Was the caller allowed to make it execute** ({@link classifyAuth}): the
 * listing is swept again with no credentials, with none and the kiosk view on,
 * and with a plain non-admin session. Everything outside {@link PUBLIC_LABELS}
 * and {@link CREDENTIAL_LABELS} must refuse the stranger, except
 * {@link KIOSK_LABELS} once the kiosk view is on; everything on
 * {@link SESSION_LABELS} must ANSWER the ordinary user, and everything else
 * must still refuse them. That half exists because the first one cannot see
 * either defect it is aimed at — a configuration read left ungated answers 200
 * to a stranger and sweeps perfectly green (issue #174), and a dashboard read
 * wrongly raised to admin works perfectly for the only person who ever tests
 * it. The authenticated pass carries the mirror claim: nothing may 401 the
 * harness's own admin session, or the sweep would be reporting refusals as
 * passes and proving nothing about the handlers behind them.
 *
 * A write is only asked its access question honestly if the request gets PAST
 * validation wherever validation runs before the gate: both credentialled
 * passes therefore send {@link Probe.gateBody}, synthesised from the route's
 * own `requestBody`, and anything that still answers 422 is reported UNPROVEN
 * rather than counted as a gate that held ({@link MAX_UNPROVEN_GATES}).
 *
 * Run `bun scripts/route-smoke.ts --help`.
 */

/**
 * A raw sanity floor on the size of the listing: it catches a document that
 * shrank wholesale — a truncated `/openapi/json`, a route group that failed to
 * mount. Measured 2026-11-02 against the core: 20 operations.
 */
export const MIN_ROUTES = 20;

export interface SmokeOptions {
  help: boolean;
}

export const HELP = `route-smoke.ts — boot the Rust core and smoke every route in the OpenAPI listing.

  bun scripts/route-smoke.ts [--help]

Builds the core, boots it on a scratch data directory and a free port, signs up
the admin and adds a plain account, then hits every route four times: with no
credentials, with none and the kiosk view on, as the plain account and as the
admin. A 5xx (or no response at
all) fails the run, and so does a route that answers a caller it should refuse
or refuses one it should answer.
`;

export function parseArgs(argv: readonly string[]): SmokeOptions {
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") return { help: true };
    throw new Error(`unknown argument: ${arg}\n\n${HELP}`);
  }
  return { help: false };
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
  requestBody?: RequestBodyLike;
}

export interface OpenApiDoc {
  paths?: Record<string, Record<string, OpenApiOperation>>;
}

export interface Probe {
  method: string;
  path: string;
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

const INSTANT_NAMES = new Set(["from", "to", "start", "end", "since", "until", "at"]);
const isInstant = (name: string, schema: SchemaLike) =>
  schema.format === "date-time" || INSTANT_NAMES.has(name);

/** A window that is ordered and non-empty: openers look back a day, closers are now. */
const instantFor = (name: string, nowMs: number) =>
  name === "from" || name === "start" || name === "since" ? nowMs - 24 * HOUR_MS : nowMs;

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
 * The rules that pick one body value, IN ORDER: the route's own vocabulary
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

/** Methods worth probing. HEAD and OPTIONS mirror routes already covered. */
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** The probe that ends the session; nothing may run after it. */
const SESSION_END = "DELETE /api/auth/session";

/** Reads first, then writes, then deletes — a DELETE must not empty a read. */
const METHOD_ORDER: Record<string, number> = {
  get: 0,
  post: 1,
  put: 1,
  patch: 1,
  delete: 2,
};

export const probeLabel = (probe: Probe): string => probe.label;

/** One operation as a request, or `undefined` when it is not to be probed. */
function probeFor(
  path: string,
  method: (typeof METHODS)[number],
  operation: OpenApiOperation | undefined,
  nowMs: number,
): Probe | undefined {
  const label = `${method.toUpperCase()} ${path}`;
  if (!operation) return undefined;
  const isRead = method === "get";
  return {
    method: method.toUpperCase(),
    path,
    // An empty object for the EXECUTION pass: a 4xx from validation is a pass
    // there, and that pass carries an admin session — a valid payload would
    // write real registers through a command route.
    body: isRead ? undefined : "{}",
    // A payload the schema accepts for the CREDENTIALS passes, where the point
    // is to get past validation and make the gate answer for itself.
    gateBody: isRead ? undefined : sampleBody(operation, nowMs),
    label,
  };
}

/** Every route in the document, as requests, reads before writes. */
export function planProbes(doc: OpenApiDoc, nowMs: number): Probe[] {
  const probes = Object.entries(doc.paths ?? {})
    .flatMap(([path, operations]) =>
      METHODS.map((method) => probeFor(path, method, operations[method], nowMs)),
    )
    .filter((probe): probe is Probe => probe !== undefined);
  return probes.sort((a, b) => order(a) - order(b));
}

const order = (probe: Probe) =>
  probe.label === SESSION_END ? 3 : (METHOD_ORDER[probe.method.toLowerCase()] ?? 1);

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
 * an empty body.
 */
export function classify(
  probe: Pick<Probe, "label">,
  response: ProbeResponse,
  allow: StatusAllowList = {},
): ProbeResult {
  const { label } = probe;
  if (response.status === undefined) {
    return {
      label,
      ok: false,
      detail: `no response: ${response.error ?? "unknown error"}`,
    };
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
// Four passes over the same plan, with different credentials:
//
//   anonymous     — everything must refuse (401/403) EXCEPT {@link PUBLIC_LABELS}.
//   kiosk         — no credentials, kiosk view on: {@link KIOSK_LABELS} and
//                   `/ws` must answer too; everything else still refuses.
//   member        — a plain signed-in NON-ADMIN. {@link SESSION_LABELS} must be
//                   REACHABLE; everything else gated must still refuse. Without
//                   it, over-gating is invisible: a dashboard read wrongly
//                   raised to `requireAdmin` sweeps green in both other passes,
//                   because both carry an admin session, and the defect only
//                   surfaces as a user's dashboard that is empty for everyone
//                   but the developer who wrote it.
//   authenticated — nothing may refuse the harness's admin session, or the
//                   sweep is reporting 401s as passes and proving nothing about
//                   the handlers behind them.
//
// Each credentialled pass sends {@link Probe.gateBody}, a payload the route's
// own schema accepts, so a write's guard is reached instead of its validator.
// ---------------------------------------------------------------------------

/**
 * Which credentials a sweep carried. `kiosk` carries none, like `anonymous`,
 * with the kiosk view switched on.
 */
export type AuthMode = "anonymous" | "kiosk" | "member" | "authenticated";

/**
 * The closed list of routes that must answer WITHOUT credentials: the pre-auth
 * gates the web shell reads before it knows whether to show a login page.
 *
 *  * `/api/setup-status` — true until the first (admin) account exists.
 *  * `/api/profile-status` — true until a profile is active.
 *  * `/api/kiosk` — whether the kiosk view is on, so the login page can offer it.
 *
 * Anything added here widens the unauthenticated surface. It is a list, not a
 * prefix rule: a prefix would silently adopt the next route mounted under it.
 */
export const PUBLIC_LABELS: readonly string[] = [
  "GET /api/setup-status",
  "GET /api/profile-status",
  "GET /api/kiosk",
];

const PUBLIC_SET = new Set(PUBLIC_LABELS);

/**
 * The routes that check credentials carried in their body: sign-up and login.
 * Anyone may call them, and their refusal (a wrong password, a closed sign-up)
 * is the check answering, not a gate, so the sweep only asks that they answer.
 * The core's own tests hold what each answers to whom.
 */
export const CREDENTIAL_LABELS: readonly string[] = [
  "POST /api/auth/sign-up",
  "POST /api/auth/login",
];

/** Whether `METHOD /path` is declared public. Exact match — never a prefix. */
export const isPublicLabel = (label: string): boolean => PUBLIC_SET.has(label);

/**
 * The closed list of routes a PLAIN SIGNED-IN USER must be able to reach.
 *
 * Read in both directions: a route ON it that refuses a non-admin is
 * over-gated, and a route NOT on it that answers a non-admin is under-gated. A
 * newly mounted route therefore defaults to admin-only, the fail-safe
 * direction.
 */
export const SESSION_LABELS: readonly string[] = [
  "DELETE /api/auth/session",
  "GET /api/auth/session",
  "GET /api/capabilities",
  "GET /api/history/recent",
  "GET /api/history/rollup",
  "GET /api/profile",
  "GET /api/sources",
];

const SESSION_SET = new Set(SESSION_LABELS);

/** Whether `METHOD /path` must be reachable by any signed-in user. */
export const isSessionLabel = (label: string): boolean => SESSION_SET.has(label);

/**
 * The closed list of routes a stranger reaches while the kiosk view is on: the
 * dashboard's reads. `/ws` opens with them. Every other route still refuses.
 */
export const KIOSK_LABELS: readonly string[] = [
  "GET /api/capabilities",
  "GET /api/history/recent",
  "GET /api/history/rollup",
  "GET /api/profile",
];

const KIOSK_SET = new Set(KIOSK_LABELS);

/** What a gate looks like from outside: it refused, without running the handler. */
const REFUSALS = new Set([401, 403]);

/**
 * The status that means THE SCHEMA answered, not the gate: a validator that runs
 * before the guard refuses the payload without consulting it. A gated and an
 * ungated write answer it identically, so it is never a pass:
 * {@link Probe.gateBody} gets past it, and where no body can be synthesised the
 * verdict is {@link unprovenVerdict}.
 *
 * Only meaningful for a probe that carried a body: a GET's 422 came from past
 * the gate and is a leak.
 */
const SCHEMA_BEFORE_GATE = 422;

const pass = (label: string, detail: string): ProbeResult => ({
  label,
  ok: true,
  detail,
});
const fail = (label: string, detail: string): ProbeResult => ({
  label,
  ok: false,
  detail,
});

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

/** A route asked WITHOUT credentials while the kiosk view is on. */
function kioskVerdict(label: string, status: number, sentBody: boolean): ProbeResult {
  if (!KIOSK_SET.has(label)) return anonymousVerdict(label, status, sentBody);
  return REFUSALS.has(status)
    ? fail(label, `${status} — a dashboard read refused a stranger with the kiosk view on`)
    : pass(label, `${status}`);
}

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
 * A gated route asked WITH the harness's admin session.
 *
 * This pass keeps sending `{}` rather than {@link Probe.gateBody}: it is the
 * only pass whose requests would actually be EXECUTED, and a valid payload here
 * would change the core's settings. So its claim is the narrow one — no gate
 * refused these credentials — and the proof
 * that a write's guard refuses everyone else lives in the anonymous and member
 * passes, which send a payload the schema accepts precisely because nothing of
 * theirs is meant to run.
 */
const authenticatedVerdict = (label: string, status: number): ProbeResult =>
  REFUSALS.has(status)
    ? fail(
        label,
        `${status} — refused the harness's admin session. Either the sweep's ` +
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
  if (CREDENTIAL_LABELS.includes(label)) return pass(label, `${status}`);
  if (isPublicLabel(label)) return publicVerdict(label, status);
  const sentBody = probe.body !== undefined;
  if (mode === "anonymous") return anonymousVerdict(label, status, sentBody);
  if (mode === "kiosk") return kioskVerdict(label, status, sentBody);
  if (mode === "member") return memberVerdict(label, status, sentBody);
  return authenticatedVerdict(label, status);
}

/**
 * `/ws` is not in the OpenAPI listing, so the sweep asks for it by name: a real
 * upgrade request, once per credential set. A stranger must be refused; any
 * session, plain or admin, and a stranger with the kiosk view on must get
 * `101 Switching Protocols`.
 */
export const UPGRADE_LABEL = "GET /ws";

const SWITCHING_PROTOCOLS = 101;

const MODE_TEXT_SHORT: Record<Exclude<AuthMode, "anonymous">, string> = {
  kiosk: "a stranger with the kiosk view on",
  member: "a plain signed-in session",
  authenticated: "the admin session",
};

export function classifyUpgrade(response: ProbeResponse, mode: AuthMode): ProbeResult {
  const status = response.status;
  if (status === undefined) {
    return fail(UPGRADE_LABEL, `no response: ${response.error ?? "unknown error"}`);
  }
  if (mode === "anonymous") {
    return REFUSALS.has(status)
      ? pass(UPGRADE_LABEL, `${status}`)
      : fail(UPGRADE_LABEL, `${status} — upgraded a request with NO CREDENTIALS`);
  }
  return status === SWITCHING_PROTOCOLS
    ? pass(UPGRADE_LABEL, `${status}`)
    : fail(UPGRADE_LABEL, `${status} — refused ${MODE_TEXT_SHORT[mode]}; it must be upgraded`);
}

export interface SmokeVerdict {
  ok: boolean;
  exitCode: number;
  text: string;
}

/** How a mode's sweep describes itself in its own verdict. */
const MODE_TEXT: Record<AuthMode, string> = {
  anonymous: "anonymously (no credentials)",
  kiosk: "anonymously with the kiosk view on",
  member: "as a plain signed-in NON-ADMIN session",
  authenticated: "as the admin session",
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
  return {
    ok: true,
    exitCode: 0,
    text: `${results.length} routes probed, none answered 5xx`,
  };
}
