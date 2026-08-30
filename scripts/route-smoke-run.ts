/**
 * The route-smoke DRIVER: containers, migrations, a booted server, the sweep.
 *
 * Split out of `./route-smoke-plan.ts` on purpose. Everything provable without
 * Docker lives there and is unit-tested; everything here is shell, sockets and
 * a real Postgres, which no unit test can stand in for — running it IS its
 * test, and keeping it out of the suite's import graph keeps it out of the
 * coverage report where it would read as neglected code.
 *
 * The sequence, and why each step is there:
 *
 *  1. a throwaway TimescaleDB on {@link SmokeOptions.dbPort} (never 5432 — the
 *     dev database is shared with a live grid-tied inverter). `--network host`
 *     because bridged containers do not work in an unprivileged LXC, which is
 *     also why the port moves with `-c port=` rather than `-p`.
 *  2. `packages/db`'s own migration runner — the shipped one, not a transcript.
 *  3. the committed sample profile, seeded straight into `installed_profiles`
 *     and made active. Without it the server boots ONBOARDING-ONLY and the
 *     entire generated `/api/v1` surface is absent, which is most of the
 *     routes this harness exists to hit. Seeding beats the install flow here
 *     because the install flow clones a git source over the network.
 *  4. the server, `INVERTER_SIMULATE=true`, left running for the warmup so the
 *     simulator has flushed real rows before the history and rollup routes run
 *     their real SQL over them.
 *  5. an admin account (the first sign-up bootstraps one) plus an API key, so
 *     session-guarded and `/api/v1` routes are probed authenticated rather
 *     than all answering 401 — and a second, PLAIN NON-ADMIN account, minted
 *     through the admin plugin because self-registration closes behind the
 *     first user. Without it, over-gating is invisible: every other pass
 *     carries an admin session.
 *  6. the sweep itself, over whatever `/openapi/json` lists — but only once
 *     `generatedSurfaceProblem` confirms the document carries the routes that
 *     step 3 was for. A seeding slip is otherwise invisible: the hand-written
 *     routes mount regardless and would sweep green on their own.
 */
process.env.SKIP_ENV_VALIDATION ??= "1";

import { SQL } from "bun";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AuthMode,
  type Probe,
  type ProbeResponse,
  type ProbeResult,
  type SmokeOptions,
  type StatusAllowList,
  type UpgradeOutcome,
  assertSmokeTarget,
  classify,
  classifyAuth,
  classifyUpgrade,
  generatedSurface,
  generatedSurfaceProblem,
  planProbes,
  summarize,
  summarizeAuth,
} from "./route-smoke-plan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Pinned to the image the compose files and the addon use — toolkit included. */
const IMAGE = "ghcr.io/sunreye/timescaledb:pg17-ts2.28.2";
const CONTAINER = "sunreye-route-smoke-db";
const DB_NAME = "sunreye_route_smoke";
const DB_PASSWORD = "route-smoke";

/** The profile the fixture harness uses too, so no network source is needed. */
const PROFILE_FILE = "packages/profile-sdk/src/__fixtures__/sample-profile.json";

const API_KEY = "route-smoke-api-key";
const ADMIN = { name: "Route Smoke", email: "smoke@route.invalid", password: "route-smoke-pw-1" };
/**
 * A plain, non-admin account — the third pass's whole subject.
 *
 * Self-registration closes after the first account (`packages/auth`: "invite-
 * only after setup"), so this one cannot sign up; it is created THROUGH the
 * admin session with Better Auth's admin plugin, which is how a real second
 * user is made, and then signs in normally for a session of its own.
 */
const MEMBER = {
  name: "Route Smoke User",
  email: "user@route.invalid",
  password: "route-smoke-pw-2",
};

/**
 * Statuses a named route may answer with despite being a 5xx.
 *
 * Empty, and it should stay that way. An entry here is a claim that a route
 * CANNOT answer in this environment for a reason that is not a defect; write
 * the reason next to it or the allowance is indistinguishable from a bug being
 * waved through.
 */
const ALLOW: StatusAllowList = {};

const log = (message: string) => console.log(`[route-smoke] ${message}`);

const sh = async (...argv: string[]) => {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { exitCode: await proc.exited, stdout, stderr };
};

const shOrThrow = async (...argv: string[]) => {
  const result = await sh(...argv);
  if (result.exitCode !== 0) {
    throw new Error(`${argv.join(" ")} failed (${result.exitCode}):\n${result.stderr}`);
  }
  return result;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what: string, timeoutMs: number, probe: () => Promise<boolean>) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe().catch(() => false)) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

/** Start the throwaway, replacing any leftover from an earlier run. */
async function startDatabase(port: number): Promise<string> {
  assertSmokeTarget(port);
  await sh("docker", "rm", "-f", CONTAINER);
  log(`starting ${IMAGE} on port ${port} as ${CONTAINER}`);
  await shOrThrow(
    "docker",
    "run",
    "-d",
    "--name",
    CONTAINER,
    "--network",
    "host",
    "-e",
    `POSTGRES_DB=${DB_NAME}`,
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    `POSTGRES_PASSWORD=${DB_PASSWORD}`,
    IMAGE,
    "postgres",
    "-c",
    `port=${port}`,
    // Throwaway data: durability buys nothing and costs the whole warmup.
    "-c",
    "fsync=off",
    "-c",
    "synchronous_commit=off",
  );
  const deadline = Date.now() + 90_000;
  for (;;) {
    // A container that has already exited will never become ready, and waiting
    // out the timeout hides the reason. The usual one is a port someone else is
    // holding — with `--network host` there is no mapping to hide behind.
    const state = await sh("docker", "inspect", "-f", "{{.State.Running}}", CONTAINER);
    if (state.stdout.trim() !== "true") {
      const logs = await sh("docker", "logs", "--tail", "15", CONTAINER);
      throw new Error(
        `the database container exited. Is something else holding port ${port}?\n${logs.stdout}${logs.stderr}`,
      );
    }
    const ready = await sh(
      "docker",
      "exec",
      CONTAINER,
      "pg_isready",
      "-U",
      "postgres",
      "-p",
      `${port}`,
    );
    if (ready.exitCode === 0) break;
    if (Date.now() > deadline)
      throw new Error("timed out waiting for postgres to accept connections");
    await sleep(500);
  }
  return `postgres://postgres:${DB_PASSWORD}@localhost:${port}/${DB_NAME}`;
}

async function stopDatabase() {
  await sh("docker", "rm", "-f", CONTAINER);
}

async function migrate(databaseUrl: string) {
  log("running migrations");
  const proc = Bun.spawn(["bun", "run", "src/migrate.ts"], {
    cwd: join(ROOT, "packages/db"),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error("migrations failed");
}

/**
 * Install and activate the sample profile. Direct INSERTs rather than the
 * install route: that route clones a git source, and a smoke harness that
 * needs the network to reach its first assertion is a harness that goes red
 * for reasons that are not the code's.
 */
async function seedProfile(databaseUrl: string): Promise<void> {
  const profile = (await Bun.file(join(ROOT, PROFILE_FILE)).json()) as {
    id: string;
    version: string;
  };
  const db = new SQL(databaseUrl);
  try {
    await db.unsafe(
      `INSERT INTO installed_profiles (id, source, version, data) VALUES ($1, 'route-smoke', $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [profile.id, profile.version, JSON.stringify(profile)],
    );
    await db.unsafe(
      `INSERT INTO app_settings (key, value) VALUES ('activeProfile', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ id: profile.id })],
    );
  } finally {
    await db.end();
  }
  log(`seeded profile ${profile.id}@${profile.version} and made it active`);
}

/** Rows the simulator has actually written — the warmup's real success test. */
async function rawRows(databaseUrl: string): Promise<number> {
  const db = new SQL(databaseUrl);
  try {
    const [row] = await db.unsafe(`SELECT count(*)::int AS n FROM metrics_raw`);
    return (row as { n: number } | undefined)?.n ?? 0;
  } finally {
    await db.end();
  }
}

function startServer(databaseUrl: string, port: number) {
  log(`booting the server on port ${port} with INVERTER_SIMULATE=true`);
  return Bun.spawn(["bun", "apps/server/src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      // Empty, not absent: this script sets SKIP_ENV_VALIDATION for its own
      // imports, and inheriting it would let the SERVER boot with a half-valid
      // environment — the one thing a boot smoke must not skip. The env package
      // reads it as a boolean, so "" turns validation back on.
      SKIP_ENV_VALIDATION: "",
      DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "route-smoke-secret-that-is-long-enough-32+",
      BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
      PORT: `${port}`,
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      INVERTER_SIMULATE: "true",
      MQTT_ENABLED: "false",
      HA_DISCOVERY_ENABLED: "false",
      // In production an empty key list fails every /api/v1 request closed,
      // which would turn the whole generated surface into 401s.
      API_KEYS: API_KEY,
      // Record fast: the warmup is wall-clock the run pays for. 1000 ms is the
      // FLOOR the plant's own schema accepts (`pollIntervalMs` minimum) —
      // anything below it fails provisioning, and a server with no device row
      // stores no readings at all.
      POLL_INTERVAL_MS: "1000",
      HISTORY_FLUSH_INTERVAL_MS: "1000",
      LOG_LEVEL: "warning",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
}

/** The first sign-up bootstraps the instance admin; returns its session cookie. */
async function signUp(base: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(ADMIN),
  });
  if (!response.ok) {
    throw new Error(`sign-up failed (${response.status}): ${await response.text()}`);
  }
  return sessionCookie(response, "sign-up");
}

/** The session cookie from any Better Auth response that set one. */
function sessionCookie(response: Response, what: string): string {
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (cookie.length === 0) throw new Error(`${what} returned no session cookie`);
  return cookie.join("; ");
}

/**
 * Create a plain non-admin user with the admin plugin and sign in as them.
 *
 * The admin's own session is the only thing that can mint this account: the
 * first sign-up bootstraps the instance admin and closes registration, so a
 * second `sign-up/email` is answered 403 "Registration is closed".
 */
async function signUpMember(base: string, adminCookie: string): Promise<string> {
  const created = await fetch(`${base}/api/auth/admin/create-user`, {
    method: "POST",
    // Better Auth refuses a cookie-authenticated POST with no `Origin`
    // (MISSING_OR_NULL_ORIGIN) — a browser always sends one, `fetch` here does not.
    headers: { "content-type": "application/json", cookie: adminCookie, origin: base },
    body: JSON.stringify({ ...MEMBER, role: "user" }),
  });
  if (!created.ok) {
    throw new Error(
      `creating the non-admin user failed (${created.status}): ${await created.text()}`,
    );
  }
  const signedIn = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MEMBER.email, password: MEMBER.password }),
  });
  if (!signedIn.ok) {
    throw new Error(`non-admin sign-in failed (${signedIn.status}): ${await signedIn.text()}`);
  }
  return sessionCookie(signedIn, "the non-admin sign-in");
}

/**
 * Real ids for the templated path segments, read back from the running server.
 * A probe against a made-up id proves only the 404 branch; the sample makes the
 * handler do its actual work.
 */
async function discoverSamples(
  base: string,
  headers: HeadersInit,
): Promise<Record<string, string>> {
  const samples: Record<string, string> = {};
  const entities = await fetch(`${base}/api/v1/entities`, { headers })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  const list = (entities as { entities?: { key?: string }[] } | null)?.entities;
  const key = list?.find((e) => typeof e.key === "string")?.key;
  if (key) {
    samples.key = key;
    samples.metric = key;
    samples.entity = key;
  }
  return samples;
}

async function probeOnce(base: string, probe: Probe, headers: HeadersInit): Promise<ProbeResponse> {
  try {
    const response = await fetch(`${base}${probe.url}`, {
      method: probe.method,
      headers: probe.body ? { ...headers, "content-type": "application/json" } : headers,
      body: probe.body,
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, body: await response.text().catch(() => "") };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Try to open the live socket, and say whether the handshake completed.
 *
 * Not a `fetch`: an upgrade cannot be expressed as one (the runtime forbids
 * setting `Connection`/`Upgrade` by hand), and a plain GET to `/ws` is a
 * protocol error rather than an answer. A real client is the only probe that
 * asks the real question. A socket that opens is closed immediately.
 */
async function probeUpgrade(base: string, cookie?: string): Promise<UpgradeOutcome> {
  const url = `${base.replace(/^http/, "ws")}/ws`;
  const socket = new WebSocket(url, cookie ? { headers: { cookie } } : undefined);
  return new Promise<UpgradeOutcome>((resolve) => {
    const settle = (outcome: UpgradeOutcome) => {
      clearTimeout(timer);
      socket.close();
      resolve(outcome);
    };
    // A handshake that neither opens nor errors within the timeout is a refusal
    // for this harness's purposes: nothing was granted.
    const timer = setTimeout(() => settle("refused"), 10_000);
    socket.addEventListener("open", () => settle("opened"));
    socket.addEventListener("error", () => settle("refused"));
    socket.addEventListener("close", () => settle("refused"));
  });
}

/** One pass over the plan: every probe, in order, one request at a time. */
async function passOver(
  base: string,
  probes: readonly Probe[],
  headers: HeadersInit,
): Promise<{ probe: Probe; response: ProbeResponse }[]> {
  const answers: { probe: Probe; response: ProbeResponse }[] = [];
  for (const probe of probes) {
    answers.push({ probe, response: await probeOnce(base, probe, headers) });
  }
  return answers;
}

const report = (results: readonly ProbeResult[]) => {
  for (const verdict of results) {
    if (!verdict.ok) log(`FAIL ${verdict.label} -> ${verdict.detail}`);
    else if (verdict.unproven) log(`UNPROVEN ${verdict.label} -> ${verdict.detail}`);
  }
  return results;
};

/**
 * One pass with credentials: the same plan, but each write carries the payload
 * its schema accepts, so the guard answers instead of the validator. Falls back
 * to the empty body where nothing could be synthesised — that probe's 422 is
 * then reported UNPROVEN and fails the run.
 */
const gatePass = (base: string, probes: readonly Probe[], headers: HeadersInit) =>
  passOver(
    base,
    probes.map((probe) => (probe.gateBody ? { ...probe, body: probe.gateBody } : probe)),
    headers,
  );

/**
 * Everything the harness can prove it is. The session cookie is named
 * separately because the WebSocket handshake needs it on its own — a socket
 * carries no API key.
 */
interface SmokeCredentials {
  cookie: string;
  "x-api-key": string;
}

/** What one full run of the harness concluded. */
interface SweepReport {
  /** Did the handler run — the 5xx sweep, over the AUTHENTICATED pass. */
  execution: ProbeResult[];
  /** Was the caller allowed to make it run, once per set of credentials. */
  access: { mode: AuthMode; results: ProbeResult[] }[];
}

/**
 * Walk the whole listing three times — or refuse to, when the document shows
 * the profile never seeded.
 *
 * The ANONYMOUS and NON-ADMIN passes run first and deliberately so: every one
 * of their write probes is expected to be refused before it reaches a handler,
 * so neither can disturb the state the authenticated pass then reads. They are
 * also the passes that can fail on their own terms — a route that answers a
 * stranger is a leak whether or not it also 500s for an admin, and a dashboard
 * read that refuses an ordinary user is broken whether or not it works for one.
 *
 * Both of them carry {@link Probe.gateBody}: a payload the route's own schema
 * accepts, so a write's guard is what answers rather than its validator. Only
 * the authenticated pass still sends `{}`, because it is the only pass whose
 * requests would actually run.
 */
async function sweep(
  base: string,
  headers: SmokeCredentials,
  memberCookie: string,
): Promise<SweepReport | undefined> {
  const doc = (await fetch(`${base}/openapi/json`, { headers }).then((r) =>
    r.json(),
  )) as Parameters<typeof planProbes>[0];
  const problem = generatedSurfaceProblem(doc);
  if (problem) {
    console.error(`[route-smoke] ${problem}`);
    return undefined;
  }
  const surface = generatedSurface(doc);
  log(
    `the active profile generated ${surface.catalog.length} catalog and ` +
      `${surface.commands.length} command routes`,
  );
  const samples = await discoverSamples(base, headers);
  const probes = planProbes(doc, {
    samples,
    nowMs: Date.now(),
  });

  log(`probing ${probes.length} routes with no credentials`);
  const anonymous = await gatePass(base, probes, {});
  const access: SweepReport["access"] = [
    {
      mode: "anonymous" as const,
      results: report([
        ...anonymous.map((a) => classifyAuth(a.probe, a.response, "anonymous")),
        classifyUpgrade(await probeUpgrade(base), "anonymous"),
      ]),
    },
  ];

  log(`probing ${probes.length} routes as a plain signed-in NON-ADMIN session`);
  const member = await gatePass(base, probes, { cookie: memberCookie });
  access.push({
    mode: "member" as const,
    results: report([
      ...member.map((a) => classifyAuth(a.probe, a.response, "member")),
      classifyUpgrade(await probeUpgrade(base, memberCookie), "member"),
    ]),
  });

  log(`probing ${probes.length} routes as the admin session + API key`);
  const authenticated = await passOver(base, probes, headers);
  access.push({
    mode: "authenticated" as const,
    results: report([
      ...authenticated.map((a) => classifyAuth(a.probe, a.response, "authenticated")),
      classifyUpgrade(await probeUpgrade(base, headers.cookie), "authenticated"),
    ]),
  });

  return {
    execution: report(authenticated.map((a) => classify(a.probe, a.response, ALLOW))),
    access,
  };
}

export async function run(options: SmokeOptions): Promise<number> {
  const base = `http://127.0.0.1:${options.port}`;
  let server: ReturnType<typeof startServer> | undefined;
  let databaseUrl = "";
  try {
    databaseUrl = await startDatabase(options.dbPort);
    await migrate(databaseUrl);
    await seedProfile(databaseUrl);
    server = startServer(databaseUrl, options.port);
    await until("the server to answer /healthz", 90_000, async () => {
      const response = await fetch(`${base}/healthz`);
      return response.ok;
    });
    const cookie = await signUp(base);
    const headers = { cookie, "x-api-key": API_KEY };
    const memberCookie = await signUpMember(base, cookie);
    log(`warming up the simulator for ${options.warmupMs} ms`);
    await sleep(options.warmupMs);
    const rows = await rawRows(databaseUrl);
    log(`simulator wrote ${rows} rows`);
    if (rows === 0) {
      // Not a pass with a note: the history and rollup routes are the ones the
      // shipped 500s were in, and over an empty table they never reach their SQL.
      console.error(
        "[route-smoke] the simulator recorded nothing — history routes would be a no-op",
      );
      return 1;
    }
    const report = await sweep(base, headers, memberCookie);
    // The generated surface was missing: `sweep` already said which half and
    // why, and probing the hand-written remainder would only produce a green
    // report over a listing that proves nothing.
    if (!report) return 1;
    // Every verdict is printed before any of them decides the exit code: a run
    // that both leaks a route and 500s on another should say so once, not hide
    // the second behind whichever check happened to be evaluated first.
    const verdicts = [
      summarize(report.execution),
      ...report.access.map(({ mode, results }) => summarizeAuth(results, mode)),
    ];
    for (const verdict of verdicts) console.log(`[route-smoke] ${verdict.text}`);
    return verdicts.some((v) => !v.ok) ? 1 : 0;
  } finally {
    server?.kill();
    if (options.keep) log(`leaving ${CONTAINER} up (--keep); DATABASE_URL=${databaseUrl}`);
    else await stopDatabase();
  }
}
