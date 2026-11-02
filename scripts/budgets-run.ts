/**
 * The budget DRIVER: a release build with the real SPA, a booted core polling the simulator, and
 * repeated logins with its resident memory read after each. The verdicts are in
 * `./budgets-plan.ts`, proved in `./budgets.test.ts`; running this is its own test.
 *
 * The sequence:
 *
 *  1. the static SPA through turbo (cached, so a warm run replays it), mirrored into a directory
 *     of its own so an unchanged SPA leaves cargo's build script alone.
 *  2. `cargo build --release` of the core and the simulator, then the binary's size.
 *  3. the simulator replaying an oracle case, the core on a scratch data directory, the admin, a
 *     saved connection to the simulator.
 *  4. `logins` rounds of a sign-in and the dashboard's history read, one at a time, each followed
 *     by a read of `/proc/<pid>/status`; the first `WARMUP_LOGINS` are not fitted.
 *  5. a hold, with a `/ws` client subscribed, until the simulator has answered `POLL_SAMPLES` more poll cycles, one read of
 *     `/proc/<pid>/status` as each begins; the first `POLL_WARMUP` are not fitted. The hold ends
 *     on the simulator's request count, never on a clock, so the poll path is exercised however
 *     fast the logins ran.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CycleCounter,
  LOGIN_READINGS,
  POLL_READINGS,
  POLL_SAMPLES,
  POLL_WARMUP,
  WARMUP_LOGINS,
  judge,
  loginPhase,
  parseBudgets,
  parseProcStatus,
  parseSimLine,
  pollPhase,
  render,
} from "./budgets-plan";
import { boot, requireOk, signIn } from "./core-boot";
import { mirrorDir } from "./mirror-dir";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
const CORE = join(TARGET, "release", "sunreye");
const SIM = join(TARGET, "release", "sunreye-sim");
const SPA = join(TARGET, "budgets-spa");

const ADMIN = {
  name: "Budgets",
  email: "budgets@soak.invalid",
  password: "budgets-soak-pw-1",
};
const PROFILE = "deye-sg05lp3";

/** Fails a hold in which no poll cycle ended for this long; never part of a verdict. */
const STALL_MS = 60_000;

const log = (message: string) => console.log(`[budgets] ${message}`);

async function exec(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
}

async function build() {
  log("building the SPA and the release binaries");
  rmSync(join(ROOT, "apps/web/build"), { recursive: true, force: true });
  await exec(["bunx", "turbo", "run", "build:static", "-F", "web", "--ui=stream"], {
    SKIP_ENV_VALIDATION: "1",
  });
  mirrorDir(join(ROOT, "apps/web/build"), SPA);
  await exec(["cargo", "build", "--release", "-p", "sunreye", "-p", "sunreye-sim"], {
    SUNREYE_SPA_DIR: SPA,
  });
}

async function eachLine(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of stream) {
    pending += decoder.decode(chunk);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(onLine);
  }
}

/** The simulator on a free port, telling the poll cycles apart in the requests it answers. */
async function startSim() {
  const oracle = join(ROOT, "fixtures/oracle");
  const proc = Bun.spawn([SIM, oracle, PROFILE, "ramp"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const counter = new CycleCounter();
  const sim = { port: 0, onCycle: undefined as (() => void) | undefined };
  const ready = Promise.withResolvers<void>();
  void eachLine(proc.stdout, (line) => {
    const event = parseSimLine(line);
    if (event && "port" in event) {
      sim.port = event.port;
      ready.resolve();
    } else if (event && counter.record(event.start)) sim.onCycle?.();
  });
  await Promise.race([
    ready.promise,
    proc.exited.then(() => Promise.reject(new Error("the simulator exited"))),
  ]);
  return { proc, sim };
}

/** An admin session that polls the simulator through the profile; its cookie. */
async function setUp(base: string, simPort: number) {
  const cookie = await signIn(base, "/api/auth/sign-up", ADMIN, "admin sign-up");
  const put = async (path: string, body: object) => {
    const response = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin: base },
      body: JSON.stringify(body),
    });
    await requireOk(response, `PUT ${path}`);
  };
  await put("/api/settings/inverter", {
    host: "127.0.0.1",
    port: simPort,
    transport: "tcp",
    unitId: 1,
    timeoutMs: 3000,
    pollIntervalMs: 1000,
    simulate: false,
  });
  await put("/api/settings/active-profile", { id: PROFILE });
  return cookie;
}

type Session = { base: string; cookie: string };

async function login({ base }: Session) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  await requireOk(response, "login");
  await response.arrayBuffer();
}

/** The dashboard's seed read: an hour of every metric. */
async function recentHistory({ base, cookie }: Session) {
  const response = await fetch(`${base}/api/history/recent?seconds=3600`, {
    headers: { cookie },
  });
  await requireOk(response, "GET /api/history/recent");
  await response.arrayBuffer();
}

/** What each soak step sends. Add a request here and every step sends it, in order. */
const SOAK_REQUESTS: ((session: Session) => Promise<void>)[] = [login, recentHistory];

/** A dashboard's live socket, held open for the poll phase, counting what it receives. */
async function openFeed({ base, cookie }: Session) {
  const socket = new WebSocket(`${base.replace("http", "ws")}/ws`, {
    headers: { cookie, origin: base },
  } as unknown as string[]);
  const opened = Promise.withResolvers<void>();
  socket.onopen = () => opened.resolve();
  socket.onerror = () => opened.reject(new Error("the /ws socket failed to open"));
  let messages = 0;
  socket.onmessage = () => messages++;
  await opened.promise;
  socket.send(JSON.stringify({ t: "sub", topics: ["metrics", "plant"] }));
  return { socket, messages: () => messages };
}

const readStatus = (pid: number) => parseProcStatus(readFileSync(`/proc/${pid}/status`, "utf8"));

async function soakLogins(session: Session, pid: number, logins: number) {
  const readings: number[] = [];
  for (let i = 0; i < logins; i++) {
    for (const request of SOAK_REQUESTS) await request(session);
    readings.push(readStatus(pid).rssBytes);
  }
  return readings;
}

/** One reading as each of the next `POLL_SAMPLES` poll cycles begins. */
function soakPolls(sim: { onCycle: (() => void) | undefined }, pid: number) {
  return new Promise<number[]>((resolve, reject) => {
    const readings: number[] = [];
    let stalled: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(stalled);
      stalled = setTimeout(() => {
        sim.onCycle = undefined;
        reject(
          new Error(
            `${readings.length} of ${POLL_SAMPLES} poll cycles ended, none in the last ${STALL_MS} ms: the core is not polling the simulator`,
          ),
        );
      }, STALL_MS);
    };
    arm();
    sim.onCycle = () => {
      readings.push(readStatus(pid).rssBytes);
      if (readings.length < POLL_SAMPLES) return arm();
      clearTimeout(stalled);
      sim.onCycle = undefined;
      resolve(readings);
    };
  });
}

export async function run(logins: number): Promise<number> {
  await build();
  const budgets = parseBudgets(readFileSync(join(ROOT, "scripts/budgets.json"), "utf8"));
  const dataDir = mkdtempSync(join(tmpdir(), "sunreye-budgets-"));
  const children: { kill: () => void; exited: Promise<unknown> }[] = [];
  try {
    const sim = await startSim();
    children.push(sim.proc);
    const { core, base } = await boot(CORE, dataDir);
    children.push(core);
    const session = { base, cookie: await setUp(base, sim.sim.port) };
    log(`signing in ${logins} times, fitting the last ${LOGIN_READINGS} after ${WARMUP_LOGINS}`);
    const loginTrend = loginPhase(await soakLogins(session, core.pid, logins));
    log(
      `holding for ${POLL_SAMPLES} poll cycles, fitting the last ${POLL_READINGS} after ${POLL_WARMUP}`,
    );
    const feed = await openFeed(session);
    const pollReadings = await soakPolls(sim.sim, core.pid).finally(() => feed.socket.close());
    const pollTrend = pollPhase(pollReadings);
    const measured = {
      binaryBytes: statSync(CORE).size,
      steadyBytes: Math.max(loginTrend.steadyBytes, pollTrend.steadyBytes),
      peakBytes: readStatus(core.pid).peakBytes,
      logins,
      loginBytesPerOp: loginTrend.bytesPerOp,
      polls: pollTrend.polls,
      pollBytesPerOp: pollTrend.bytesPerOp,
      feedMessages: feed.messages(),
    };
    console.log(render(measured, budgets));
    const failures = judge(measured, budgets);
    for (const failure of failures) console.error(`[budgets] FAIL ${failure}`);
    return failures.length === 0 ? 0 : 1;
  } finally {
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exited));
    rmSync(dataDir, { recursive: true, force: true });
  }
}
