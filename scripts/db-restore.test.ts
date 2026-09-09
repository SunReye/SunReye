import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

/**
 * `scripts/db-restore.sh` is the one implementation of the restore sequence
 * DOCS.md points at, so it is exercised here rather than only in the CI job
 * that has a real database: a temp `bin/` shadows `psql` and `pg_restore` on
 * PATH, records every invocation, and answers the guard's queries with canned
 * values. That covers the ordering and the refusals without touching a
 * database — the value comparisons live in `db-parity.test.ts`, and the real
 * dump/restore round trip in `.github/workflows/db-restore.yml`.
 */

const REPO = join(import.meta.dir, "..");
const SCRIPT = join(REPO, "scripts/db-restore.sh");

type Fakes = {
  /** `max(created_at)` the fake psql reports for drizzle.__drizzle_migrations. */
  journalLatest?: string;
  /** What the fake psql reports for the "does this database hold app data" probe. */
  appTables?: string;
  /** Make pg_restore exit non-zero. */
  restoreFails?: boolean;
};

type Run = { code: number; stdout: string; stderr: string; calls: string[] };

async function runRestore(
  args: string[],
  fakes: Fakes = {},
  env: Record<string, string> = {},
): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), "sunreye-restore-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");

  // The fake psql answers the two probes by matching the query text; every
  // other invocation is recorded and succeeds.
  writeFileSync(
    join(bin, "psql"),
    `#!/usr/bin/env bash
printf 'psql %s\\n' "$*" >> ${log}
for a in "$@"; do
  case "$a" in
    *__drizzle_migrations*) echo '${fakes.journalLatest ?? ""}'; exit 0 ;;
    *app_table_probe*) echo '${fakes.appTables ?? "f"}'; exit 0 ;;
  esac
done
exit 0
`,
  );
  writeFileSync(
    join(bin, "pg_restore"),
    `#!/usr/bin/env bash
printf 'pg_restore %s\\n' "$*" >> ${log}
exit ${fakes.restoreFails ? 1 : 0}
`,
  );
  chmodSync(join(bin, "psql"), 0o755);
  chmodSync(join(bin, "pg_restore"), 0o755);

  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  let calls: string[] = [];
  try {
    calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    calls = [];
  }
  return { code, stdout, stderr, calls };
}

/** A dump file that exists on disk — the script must not care about contents. */
function dumpFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "sunreye-dump-"));
  const file = join(dir, "ha-backup-1.dump");
  writeFileSync(file, "PGDMP-fake");
  return file;
}

describe("db-restore.sh sequence", () => {
  test("runs pre_restore, then pg_restore --no-owner, then post_restore", async () => {
    const run = await runRestore([dumpFile()]);
    expect(run.code).toBe(0);
    const order = run.calls.filter(
      (c) =>
        c.includes("timescaledb_pre_restore") ||
        c.startsWith("pg_restore") ||
        c.includes("timescaledb_post_restore"),
    );
    expect(order).toHaveLength(3);
    expect(order[0]).toContain("timescaledb_pre_restore");
    expect(order[1]).toStartWith("pg_restore");
    expect(order[1]).toContain("--no-owner");
    expect(order[2]).toContain("timescaledb_post_restore");
  });

  // A fresh `CREATE DATABASE` target has no timescaledb extension: the database
  // image is postgres + the extension debs, and nothing installs it into
  // template1. Without this the very first statement of the restore fails with
  // `function timescaledb_pre_restore() does not exist` — which is what a user
  // following DOCS.md hits on any stock Postgres too, not a CI artefact.
  test("creates the timescaledb extension before pre_restore", async () => {
    const run = await runRestore([dumpFile()]);
    expect(run.code).toBe(0);
    const create = run.calls.findIndex((c) =>
      c.includes("CREATE EXTENSION IF NOT EXISTS timescaledb"),
    );
    const pre = run.calls.findIndex((c) => c.includes("timescaledb_pre_restore"));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(create).toBeLessThan(pre);
  });

  // The extension is a write: it must land on the far side of both refusals, or
  // a refused restore has already modified the database it refused to touch.
  test("the extension is not created when the restore is refused", async () => {
    const run = await runRestore([dumpFile()], { appTables: "t" });
    expect(run.code).not.toBe(0);
    expect(run.calls.join("\n")).not.toContain("CREATE EXTENSION");
  });

  test("passes the dump path and the target database url to pg_restore", async () => {
    const file = dumpFile();
    const run = await runRestore([file]);
    const call = run.calls.find((c) => c.startsWith("pg_restore"))!;
    expect(call).toContain(file);
    expect(call).toContain("postgresql://u:p@localhost:5432/db");
  });

  test("post_restore still runs when pg_restore fails, and the script exits non-zero", async () => {
    const run = await runRestore([dumpFile()], { restoreFails: true });
    expect(run.code).not.toBe(0);
    expect(run.calls.join("\n")).toContain("timescaledb_post_restore");
  });

  test("a missing dump file fails before touching the database", async () => {
    const run = await runRestore(["/nonexistent/nope.dump"]);
    expect(run.code).not.toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.stderr).toContain("nope.dump");
  });

  test("no argument is a usage error", async () => {
    const run = await runRestore([]);
    expect(run.code).not.toBe(0);
    expect(run.stderr.toLowerCase()).toContain("usage");
  });

  test("an unset DATABASE_URL is refused rather than defaulted", async () => {
    const run = await runRestore([dumpFile()], {}, { DATABASE_URL: "" });
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("DATABASE_URL");
  });
});

describe("db-restore.sh guard", () => {
  test("a target migrated by a newer release is refused before any restore", async () => {
    const run = await runRestore([dumpFile()], { journalLatest: "9999999999999" });
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("newer");
    expect(run.calls.join("\n")).not.toContain("pg_restore");
    expect(run.calls.join("\n")).not.toContain("timescaledb_pre_restore");
  });

  test("a target at the shipped schema version is allowed", async () => {
    const journal = JSON.parse(
      readFileSync(join(REPO, "packages/db/src/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: { when: number }[] };
    const shipped = Math.max(...journal.entries.map((e) => e.when));
    const run = await runRestore([dumpFile()], { journalLatest: String(shipped) });
    expect(run.code).toBe(0);
  });

  test("an empty (never migrated) database is allowed", async () => {
    const run = await runRestore([dumpFile()], { journalLatest: "" });
    expect(run.code).toBe(0);
  });

  test("a target that already holds app data is refused without --force", async () => {
    const run = await runRestore([dumpFile()], { appTables: "t" });
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("not empty");
    expect(run.calls.join("\n")).not.toContain("pg_restore");
  });

  test("--force restores over a populated target", async () => {
    const run = await runRestore(["--force", dumpFile()], { appTables: "t" });
    expect(run.code).toBe(0);
    expect(run.calls.join("\n")).toContain("pg_restore");
  });

  test("--force does NOT lift the newer-schema refusal", async () => {
    const run = await runRestore(["--force", dumpFile()], { journalLatest: "9999999999999" });
    expect(run.code).not.toBe(0);
    expect(run.calls.join("\n")).not.toContain("pg_restore");
  });

  test("the shipped journal path can be overridden for the compiled addon layout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sunreye-journal-"));
    writeFileSync(join(dir, "_journal.json"), JSON.stringify({ entries: [{ when: 10 }] }));
    const run = await runRestore(
      [dumpFile()],
      { journalLatest: "11" },
      { SUNREYE_JOURNAL: join(dir, "_journal.json") },
    );
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("newer");
  });
});

describe("DOCS.md and dump.sh reference the script instead of duplicating it", () => {
  const docs = readFileSync(join(REPO, "sunreye/DOCS.md"), "utf8");

  test("DOCS.md names the script", () => {
    expect(docs).toContain("db-restore.sh");
  });

  test("DOCS.md no longer spells the raw sequence out", () => {
    expect(docs).not.toContain("timescaledb_pre_restore");
    expect(docs).not.toContain("pg_restore -d");
  });

  test("the script is the only place the sequence lives", () => {
    const script = readFileSync(SCRIPT, "utf8");
    expect(script).toContain("timescaledb_pre_restore");
    expect(script).toContain("timescaledb_post_restore");
  });
});
