/**
 * The route-smoke DRIVER: a built core, a booted binary, the sweep.
 *
 * Split out of `./route-smoke-plan.ts` on purpose. Everything provable without
 * a running core lives there and is unit-tested; everything here is processes
 * and sockets, which no unit test can stand in for — running it IS its test,
 * and keeping it out of the suite's import graph keeps it out of the coverage
 * report where it would read as neglected code.
 *
 * The sequence:
 *
 *  1. `cargo build` the core, then boot it on a scratch data directory and
 *     port 0, reading the port from its "sunreye listening" line, so slots
 *     running this at once never collide.
 *  2. the admin, through the first sign-up.
 *  3. a PLAIN account, created by the admin. Without it, over-gating is
 *     invisible: every other pass carries an admin session.
 *  4. an API key for the admin, which only the admin pass carries: `/api/v1`
 *     answers a key, never a session.
 *  5. the sweeps over whatever `/openapi/json` lists, plus the `/ws` upgrade,
 *     which the listing does not carry: no credentials, no credentials with the
 *     kiosk view switched on, the plain account, the admin.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type AuthMode,
  type OpenApiDoc,
  type Probe,
  type ProbeResponse,
  type ProbeResult,
  type StatusAllowList,
  UPGRADE_LABEL,
  classify,
  classifyAuth,
  classifyUpgrade,
  planProbes,
  summarize,
  summarizeAuth,
} from "./route-smoke-plan";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
const BINARY = join(TARGET, "debug", "sunreye");

const ADMIN = { name: "Route Smoke", email: "smoke@route.invalid", password: "route-smoke-pw-1" };
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

async function build() {
  log("building the core");
  const proc = Bun.spawn(["cargo", "build", "-p", "sunreye", "--bin", "sunreye"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error("cargo build -p sunreye failed");
}

/** The core on a free port; resolves once it logs the address it listens on. */
async function boot(dataDir: string) {
  const core = Bun.spawn(
    [BINARY, "--listen", "127.0.0.1:0", "--log-level", "info", "--data-dir", dataDir],
    { stdout: "ignore", stderr: "pipe" },
  );
  const reader = core.stderr.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`the core exited before listening:\n${seen}`);
    seen += decoder.decode(value);
    // Colour codes sit between the field name and the address.
    const port = /sunreye listening.*?127\.0\.0\.1:(\d+)/.exec(seen)?.[1];
    if (port) {
      // Keep draining, or a full pipe would stall the core's logging.
      void (async () => {
        while (!(await reader.read()).done);
      })();
      return { core, base: `http://127.0.0.1:${port}` };
    }
  }
}

/** `name=value` of the session cookie a sign-in answer set. */
function sessionCookie(response: Response, what: string): string {
  const cookie = response.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (cookie.length === 0) throw new Error(`${what} returned no session cookie`);
  return cookie.join("; ");
}

async function signIn(base: string, path: string, body: object, what: string): Promise<string> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${what} failed (${response.status}): ${await response.text()}`);
  return sessionCookie(response, what);
}

/** An admin request on the core's own origin; throws unless it answered 2xx. */
async function asAdmin(
  base: string,
  cookie: string,
  path: string,
  body: object,
  what: string,
  method: "POST" | "PUT" = "POST",
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, origin: base, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${what} failed (${response.status}): ${await response.text()}`);
  return (await response.json()) as Record<string, unknown>;
}

async function probeOnce(base: string, probe: Probe, headers: HeadersInit): Promise<ProbeResponse> {
  try {
    const response = await fetch(`${base}${probe.path}`, {
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
 * A WebSocket upgrade on a raw socket: `fetch` cannot send one, and a
 * WebSocket client hides the refusal's status. Resolves to the status line's code.
 */
function probeUpgrade(base: string, headers: Record<string, string>): Promise<ProbeResponse> {
  const { hostname, port, host } = new URL(base);
  const lines = [
    "GET /ws HTTP/1.1",
    `host: ${host}`,
    "connection: Upgrade",
    "upgrade: websocket",
    "sec-websocket-version: 13",
    "sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==",
    `origin: ${base}`,
    ...Object.entries(headers)
      .filter(([name]) => name !== "origin")
      .map(([name, value]) => `${name}: ${value}`),
  ];
  return new Promise((resolve) => {
    const socket = connect(Number(port), hostname);
    let seen = "";
    const done = (response: ProbeResponse) => {
      socket.destroy();
      resolve(response);
    };
    socket.setTimeout(30_000, () => done({ error: "timed out" }));
    socket.on("error", (error) => done({ error: error.message }));
    socket.on("data", (chunk) => {
      seen += chunk.toString("latin1");
      const status = /^HTTP\/1\.1 (\d{3})/.exec(seen)?.[1];
      if (status) done({ status: Number(status), body: seen });
    });
    socket.write(`${lines.join("\r\n")}\r\n\r\n`);
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
 * One pass with credentials: each write carries the payload its schema
 * accepts, so the guard answers instead of the validator.
 */
const gatePass = (base: string, probes: readonly Probe[], headers: HeadersInit) =>
  passOver(
    base,
    probes.map((probe) => (probe.gateBody ? { ...probe, body: probe.gateBody } : probe)),
    headers,
  );

/**
 * A browser's request on the core's own origin: the cookie, and the Origin
 * the core requires beside a cookie on every write.
 */
const asBrowser = (base: string, cookie?: string): Record<string, string> =>
  cookie ? { cookie, origin: base } : {};

/** One access pass. */
async function accessPass(
  base: string,
  probes: readonly Probe[],
  mode: AuthMode,
  cookie?: string,
): Promise<ProbeResult[]> {
  // Before the pass: its last probe ends the session.
  const upgrade = classifyUpgrade(await probeUpgrade(base, asBrowser(base, cookie)), mode);
  const answers =
    mode === "authenticated"
      ? await passOver(base, probes, asBrowser(base, cookie))
      : await gatePass(base, probes, asBrowser(base, cookie));
  return [...answers.map((a) => classifyAuth(a.probe, a.response, mode)), upgrade];
}

/**
 * The anonymous, kiosk and non-admin passes run first: every one of their write
 * probes is expected to be refused before it reaches a handler, so none can
 * disturb the state the admin pass then reads. Within a pass, ending the
 * session sorts last (a DELETE), so no probe after it loses its cookie.
 */
async function sweep(base: string, adminCookie: string, memberCookie: string, apiKey: string) {
  const doc = (await fetch(`${base}/openapi/json`).then((r) => r.json())) as OpenApiDoc;
  const probes = planProbes(doc, Date.now());
  const access: { mode: AuthMode; results: ProbeResult[] }[] = [];

  log(`probing ${probes.length} routes and ${UPGRADE_LABEL} with no credentials`);
  access.push({
    mode: "anonymous",
    results: report(await accessPass(base, probes, "anonymous")),
  });
  await asAdmin(
    base,
    adminCookie,
    "/api/settings/kiosk",
    { enabled: true },
    "kiosk view on",
    "PUT",
  );
  log(`probing ${probes.length} routes and ${UPGRADE_LABEL} with no credentials, kiosk view on`);
  access.push({ mode: "kiosk", results: report(await accessPass(base, probes, "kiosk")) });
  log(`probing ${probes.length} routes as a plain signed-in NON-ADMIN session`);
  const member = await accessPass(base, probes, "member", memberCookie);
  access.push({ mode: "member", results: report(member) });
  log(`probing ${probes.length} routes as the admin session`);
  const adminUpgrade = await probeUpgrade(base, asBrowser(base, adminCookie));
  const admin = await passOver(base, probes, {
    ...asBrowser(base, adminCookie),
    "x-api-key": apiKey,
  });
  const adminAccess = [
    ...admin.map((a) => classifyAuth(a.probe, a.response, "authenticated")),
    classifyUpgrade(adminUpgrade, "authenticated"),
  ];
  access.push({ mode: "authenticated", results: report(adminAccess) });

  return { execution: report(admin.map((a) => classify(a.probe, a.response, ALLOW))), access };
}

export async function run(): Promise<number> {
  await build();
  const dataDir = mkdtempSync(join(tmpdir(), "sunreye-route-smoke-"));
  let core: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const booted = await boot(dataDir);
    core = booted.core;
    const { base } = booted;
    const adminCookie = await signIn(base, "/api/auth/sign-up", ADMIN, "admin sign-up");
    await asAdmin(
      base,
      adminCookie,
      "/api/admin/users",
      { ...MEMBER, admin: false },
      "plain account",
    );
    const memberCookie = await signIn(base, "/api/auth/login", MEMBER, "plain account login");
    const me = await fetch(`${base}/api/auth/session`, { headers: { cookie: adminCookie } });
    const { id } = (await me.json()) as { id: number };
    const key = await asAdmin(
      base,
      adminCookie,
      "/api/admin/api-keys",
      { userId: id, name: "route smoke" },
      "API key",
    );
    const swept = await sweep(base, adminCookie, memberCookie, String(key.key));
    // Every verdict is printed before any of them decides the exit code.
    const verdicts = [
      summarize(swept.execution),
      ...swept.access.map(({ mode, results }) => summarizeAuth(results, mode)),
    ];
    for (const verdict of verdicts) console.log(`[route-smoke] ${verdict.text}`);
    return verdicts.some((v) => !v.ok) ? 1 : 0;
  } finally {
    core?.kill();
    await core?.exited;
    rmSync(dataDir, { recursive: true, force: true });
  }
}
