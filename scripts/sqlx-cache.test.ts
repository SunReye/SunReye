import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `scripts/sqlx-cache` keeps the committed `.sqlx` query cache honest (ADR 0004). A stand-in `cargo`
 * records what it was asked and fails on request, so what is proven is the script's own contract: the
 * scratch database the queries are checked against, the order of the steps, the regenerate command a
 * stale cache is told to run, and a missing `sqlx-cli` naming the setup script.
 */

let dir: string;
let bin: string;

async function stub(name: string, body: string) {
  const path = join(bin, name);
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`);
  await chmod(path, 0o755);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sqlx-cache-"));
  bin = join(dir, "bin");
  await mkdir(bin);
  await stub(
    "cargo",
    'echo "$* DATABASE_URL=$DATABASE_URL" >> "$CARGO_LOG"\n[[ "$*" == *"${FAIL_ON:-@@}"* ]] && exit 7\nexit 0',
  );
  await stub("cargo-sqlx", "exit 0");
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function run(args: string[] = [], env: { failOn?: string } = {}, withSqlx = true) {
  if (!withSqlx) await rm(join(bin, "cargo-sqlx"));
  const log = join(dir, "log");
  const proc = Bun.spawn(["scripts/sqlx-cache", ...args], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: join(dir, "home"),
      CARGO_LOG: log,
      FAIL_ON: env.failOn ?? "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  const calls = await readFile(log, "utf8").then(
    (text) => text.trim().split("\n"),
    () => [],
  );
  return { code, calls, stderr };
}

const verbs = (calls: string[]) => calls.map((call) => call.replace(/ DATABASE_URL=.*/, ""));

describe("scripts/sqlx-cache", () => {
  test("regenerates: creates a scratch database, migrates it, prepares the workspace", async () => {
    const { code, calls } = await run();
    expect(code).toBe(0);
    expect(verbs(calls)).toEqual([
      "sqlx database create",
      "sqlx migrate run --source crates/sunreye/migrations",
      "sqlx prepare --workspace -- --all-targets",
    ]);
  });

  test("--check runs the same steps with prepare --check", async () => {
    const { code, calls } = await run(["--check"]);
    expect(code).toBe(0);
    expect(verbs(calls)).toEqual([
      "sqlx database create",
      "sqlx migrate run --source crates/sunreye/migrations",
      "sqlx prepare --workspace --check -- --all-targets",
    ]);
  });

  test("every step uses one scratch database outside the repository", async () => {
    const { calls } = await run();
    const urls = new Set(calls.map((call) => call.replace(/^.* DATABASE_URL=/, "")));
    expect(urls.size).toBe(1);
    const [url] = [...urls];
    expect(url).toMatch(/^sqlite:\/\/\/.+\/prepare\.db$/);
    expect(url).not.toContain(process.cwd());
  });

  test("a stale cache fails and names the regenerate command", async () => {
    const { code, stderr } = await run(["--check"], { failOn: "prepare" });
    expect(code).not.toBe(0);
    expect(stderr).toContain("scripts/sqlx-cache");
    expect(stderr).toContain(".sqlx");
  });

  test("a failed regeneration does not claim the cache is stale", async () => {
    const { code, stderr } = await run([], { failOn: "migrate" });
    expect(code).not.toBe(0);
    expect(stderr).not.toContain("stale");
  });

  test("a missing sqlx-cli names scripts/setup-targets and runs nothing", async () => {
    const { code, calls, stderr } = await run(["--check"], {}, false);
    expect(code).not.toBe(0);
    expect(stderr).toContain("scripts/setup-targets");
    expect(calls).toEqual([]);
  });

  test("an unknown argument is refused", async () => {
    const { code, stderr, calls } = await run(["--bogus"]);
    expect(code).not.toBe(0);
    expect(stderr).toContain("usage");
    expect(calls).toEqual([]);
  });
});
