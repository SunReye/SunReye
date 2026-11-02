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
 *  4. `logins` sign-ins, one at a time, each followed by a read of `/proc/<pid>/status`.
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WARMUP_LOGINS,
  growthOf,
  judge,
  parseBudgets,
  parseProcStatus,
  render,
} from "./budgets-plan";
import type { Sample } from "./budgets-plan";
import { boot, signIn } from "./core-boot";
import { mirrorDir } from "./mirror-dir";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = process.env.CARGO_TARGET_DIR ?? join(ROOT, "target");
const CORE = join(TARGET, "release", "sunreye");
const SIM = join(TARGET, "release", "sunreye-sim");
const SPA = join(TARGET, "budgets-spa");

const ADMIN = { name: "Budgets", email: "budgets@soak.invalid", password: "budgets-soak-pw-1" };
const PROFILE = "deye-sg05lp3";

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

/** The simulator on a free port, counting the requests it answers. */
async function startSim() {
  const oracle = join(ROOT, "fixtures/oracle");
  const proc = Bun.spawn([SIM, oracle, PROFILE, "ramp"], { stdout: "pipe", stderr: "inherit" });
  const counter = { requests: 0, port: 0 };
  const ready = Promise.withResolvers<void>();
  void (async () => {
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of proc.stdout) {
      pending += decoder.decode(chunk);
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const port = /^listening .*:(\d+)$/.exec(line)?.[1];
        const requests = /^requests (\d+)$/.exec(line)?.[1];
        if (port) {
          counter.port = Number(port);
          ready.resolve();
        }
        if (requests) counter.requests = Number(requests);
      }
    }
  })();
  await Promise.race([
    ready.promise,
    proc.exited.then(() => Promise.reject(new Error("the simulator exited"))),
  ]);
  return { proc, counter };
}

/** An admin session that polls the simulator through the profile. */
async function setUp(base: string, simPort: number) {
  const cookie = await signIn(base, "/api/auth/sign-up", ADMIN, "admin sign-up");
  const put = async (path: string, body: object) => {
    const response = await fetch(`${base}${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin: base },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(`PUT ${path} failed (${response.status}): ${await response.text()}`);
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
}

async function login(base: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  await response.arrayBuffer();
  if (!response.ok) throw new Error(`login failed (${response.status})`);
}

const readStatus = (pid: number) => parseProcStatus(readFileSync(`/proc/${pid}/status`, "utf8"));

async function soak(base: string, pid: number, logins: number) {
  const samples: Sample[] = [];
  const began = performance.now();
  for (let i = 0; i < logins; i++) {
    await login(base);
    samples.push({ atMs: performance.now() - began, rssBytes: readStatus(pid).rssBytes });
  }
  return { samples, peakBytes: readStatus(pid).peakBytes };
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
    await setUp(base, sim.counter.port);
    log(`signing in ${logins} times`);
    const { samples, peakBytes } = await soak(base, core.pid, logins);
    const measured = {
      ...growthOf(samples, WARMUP_LOGINS),
      binaryBytes: statSync(CORE).size,
      peakBytes,
      logins,
      requests: sim.counter.requests,
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
