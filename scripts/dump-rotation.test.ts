import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

/**
 * `dump.sh` runs under `with-contenv bashio` inside the addon, so it cannot be
 * executed here — but its rotation half is pure shell over a directory. These
 * tests lift the sanitizer and the rotation loop *out of the shipped file* and
 * run them, so they assert the code that ships rather than a copy of it: edit
 * dump.sh and these go red.
 */

const DUMP_SH = readFileSync(
  join(import.meta.dir, "../sunreye/rootfs/usr/lib/sunreye/dump.sh"),
  "utf8",
);

/** The `case`/`esac` block that sanitizes `backups_keep`, verbatim. */
function sanitizerBlock(): string {
  const match = DUMP_SH.match(/case "\$\{keep\}" in[\s\S]*?esac/);
  if (!match) throw new Error("dump.sh no longer has a backups_keep case block");
  return match[0];
}

/** The rotation pipeline line, verbatim, retargeted at a temp directory. */
function rotationBlock(dir: string): string {
  const start = DUMP_SH.indexOf("ls -1t /data/backups");
  if (start === -1) throw new Error("dump.sh no longer rotates with `ls -1t /data/backups`");
  const end = DUMP_SH.indexOf("done", start);
  return DUMP_SH.slice(start, end + 4)
    .replaceAll("/data/backups", dir)
    .replaceAll("bashio::log.info", "echo");
}

async function sanitize(raw: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "-c", `keep=${JSON.stringify(raw)}\n${sanitizerBlock()}\necho "$keep"`],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

/** Rotate `count` dumps with `keep`, oldest first; returns the survivors. */
async function rotate(count: number, keep: string): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "sunreye-backups-"));
  for (let i = 1; i <= count; i++) {
    const file = join(dir, `dump-${i}.dump`);
    writeFileSync(file, "x");
    // Distinct mtimes so `ls -1t` has a deterministic order (newest = highest i).
    const t = new Date(Date.now() - (count - i) * 60_000);
    utimesSync(file, t, t);
  }
  const script = `set -euo pipefail\nkeep=${JSON.stringify(keep)}\n${sanitizerBlock()}\n${rotationBlock(dir)}`;
  const proc = Bun.spawn(["bash", "-c", script], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
  return readdirSync(dir).sort();
}

describe("dump.sh backups_keep sanitizer", () => {
  test("a plain number is kept", async () => {
    expect(await sanitize("5")).toBe("5");
  });

  test("zero is a number and is honoured, not rewritten", async () => {
    expect(await sanitize("0")).toBe("0");
  });

  test("a non-numeric value falls back to 3", async () => {
    expect(await sanitize("abc")).toBe("3");
  });

  test("an empty value falls back to 3", async () => {
    expect(await sanitize("")).toBe("3");
  });

  test("a negative value falls back to 3 (the minus sign is not a digit)", async () => {
    expect(await sanitize("-1")).toBe("3");
  });

  test("a decimal falls back to 3", async () => {
    expect(await sanitize("2.5")).toBe("3");
  });

  test("whitespace padding falls back to 3 rather than being trimmed silently", async () => {
    expect(await sanitize(" 4 ")).toBe("3");
  });
});

describe("dump.sh rotation", () => {
  test("keeps the newest N and deletes the rest", async () => {
    expect(await rotate(5, "2")).toEqual(["dump-4.dump", "dump-5.dump"]);
  });

  test("keep 0 deletes every dump — the option means what it says", async () => {
    expect(await rotate(3, "0")).toEqual([]);
  });

  test("a non-numeric keep rotates at the default 3, it does not eat everything", async () => {
    expect(await rotate(5, "abc")).toEqual(["dump-3.dump", "dump-4.dump", "dump-5.dump"]);
  });

  test("fewer dumps than keep deletes nothing", async () => {
    expect(await rotate(2, "3")).toEqual(["dump-1.dump", "dump-2.dump"]);
  });

  test("an empty backups directory is a no-op, not an error", async () => {
    expect(await rotate(0, "3")).toEqual([]);
  });
});

describe("CI bashio shim", () => {
  const SHIM = join(import.meta.dir, "ci/bashio-shim.sh");

  async function shim(script: string, env: Record<string, string> = {}): Promise<string> {
    const proc = Bun.spawn(["bash", "-c", `source ${SHIM}\n${script}`], {
      env: { PATH: process.env.PATH ?? "", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  }

  test("backup_full is false unless BACKUP_FULL says otherwise", async () => {
    expect(await shim("bashio::config.true 'backup_full' && echo yes || echo no")).toBe("no");
    expect(
      await shim("bashio::config.true 'backup_full' && echo yes || echo no", {
        BACKUP_FULL: "true",
      }),
    ).toBe("yes");
  });

  test("an unset backups_keep falls through to the caller's default", async () => {
    expect(await shim("bashio::config 'backups_keep' '3'")).toBe("3");
  });

  test("a set backups_keep wins over the default, zero included", async () => {
    expect(await shim("bashio::config 'backups_keep' '3'", { BACKUPS_KEEP: "0" })).toBe("0");
  });
});

describe("dump.sh dump modes", () => {
  /**
   * Runs the *shipped* dump.sh with fake `psql`/`pg_dump` on PATH and the
   * hardcoded /data/backups retargeted at a temp dir, and returns the flags
   * pg_dump was actually handed.
   *
   * The exclusion used to be asserted by grepping dump.sh for a query
   * fragment. That test passed while `backup_full: false` was still dumping
   * every compressed chunk — a source-text assertion cannot see whether the
   * rows the query returns reach pg_dump. This drives the real loop instead.
   */
  async function dumpFlags(
    chunkRows: string[],
    env: Record<string, string> = {},
  ): Promise<{ flags: string[]; code: number }> {
    const dir = mkdtempSync(join(tmpdir(), "sunreye-dumpmode-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "pgdump.log");

    // Query-aware, because the script asks three different questions: the
    // retention policies, whether the minute tier is still refreshed, and then
    // the chunk tables. A fake that answered both
    // with the chunk list made the retention unparseable, which the script
    // correctly reads as "do not exclude anything" — the same class of blind
    // spot the note below this function describes.
    writeFileSync(
      join(bin, "psql"),
      `#!/usr/bin/env bash\n` +
        `case "$*" in\n` +
        `  *policy_retention*) printf '%s\\n' "\${RETENTION_DAYS:-7 90}" ;;\n` +
        `  *policy_refresh_continuous_aggregate*) printf '%s\\n' "\${MINUTE_REFRESHED:-t}" ;;\n` +
        `  *inverter_id*) printf '%s\\n' "\${PRE_2_0_0:-f}" ;;\n` +
        `  *) printf '%s\\n' ${chunkRows.map((r) => `'${r}'`).join(" ") || "''"} ;;\n` +
        `esac\nexit 0\n`,
    );
    writeFileSync(
      join(bin, "pg_dump"),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> ${log}\n` +
        `for a in "$@"; do case "$a" in --file) :;; --file=*) touch "\${a#--file=}";; esac; done\n` +
        `prev=""; for a in "$@"; do [ "$prev" = "--file" ] && touch "$a"; prev="$a"; done\nexit 0\n`,
    );
    chmodSync(join(bin, "psql"), 0o755);
    chmodSync(join(bin, "pg_dump"), 0o755);

    // The shipped file, with only the addon-only bits made runnable here.
    const script = join(dir, "dump.sh");
    writeFileSync(script, DUMP_SH.replaceAll("/data/backups", dir));
    const proc = Bun.spawn(
      ["bash", "-c", `source ${join(import.meta.dir, "ci/bashio-shim.sh")}\n. ${script} probe`],
      {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          DATABASE_URL: "postgresql://u:p@localhost:5432/db",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    const code = await proc.exited;
    let flags: string[] = [];
    try {
      flags = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    } catch {
      flags = [];
    }
    return { flags, code };
  }

  const CHUNK = "_timescaledb_internal._hyper_1_45_chunk";
  const COMPRESSED = "_timescaledb_internal.compress_hyper_5_50_chunk";

  test("every chunk table the query returns becomes an exclusion", async () => {
    const { flags } = await dumpFlags([CHUNK, COMPRESSED]);
    expect(flags).toContain(`--exclude-table-data=${CHUNK}`);
    expect(flags).toContain(`--exclude-table-data=${COMPRESSED}`);
  });

  test("a long raw retention produces no exclusions at all, and still dumps", async () => {
    // The whole point of #133: once raw is the long-horizon tier, the default
    // backup must cover it. Driven through the real script rather than asserted
    // on its source, so a decision that is computed but never consulted fails.
    const { flags, code } = await dumpFlags([CHUNK, COMPRESSED], { RETENTION_DAYS: "1460 90" });
    expect(code).toBe(0);
    expect(flags.some((f) => f.startsWith("--exclude-table-data="))).toBe(false);
    expect(flags).toContain("-Fc");
  });

  test("an unreadable retention answer also keeps the data", async () => {
    const { flags, code } = await dumpFlags([CHUNK], { RETENTION_DAYS: "ERROR: nope" });
    expect(code).toBe(0);
    expect(flags.some((f) => f.startsWith("--exclude-table-data="))).toBe(false);
  });

  test("a frozen minute tier produces no exclusions, whatever the retentions say", async () => {
    // End-to-end proof of the rule the unit tests state: with the minute
    // aggregates no longer refreshed, raw is the only minute-resolution record,
    // so the default backup must carry it even though every retention number
    // still looks safe.
    const { flags, code } = await dumpFlags([CHUNK, COMPRESSED], {
      RETENTION_DAYS: "90 90",
      MINUTE_REFRESHED: "f",
    });
    expect(code).toBe(0);
    expect(flags.some((f) => f.startsWith("--exclude-table-data="))).toBe(false);
    expect(flags).toContain("-Fc");
  });

  test("a compress_hyper_* name is passed through like any other", async () => {
    const { flags } = await dumpFlags([COMPRESSED]);
    expect(flags).toContain(`--exclude-table-data=${COMPRESSED}`);
  });

  // Tripwire, not proof. The fake psql above ignores the query text, so nothing
  // in this file can tell whether the SQL actually *finds* the compressed data
  // tables — and that was the real bug: a compressed chunk's rows live in
  // compress_hyper_*, which timescaledb_information.chunks never names, so
  // `backup_full: false` dumped the whole compressed history while still
  // producing a smaller file than a full dump. Only a real TimescaleDB can
  // catch that, which is what .github/workflows/db-restore.yml asserts
  // ("expected the raw window to be empty after restore"). This just fails
  // loudly if someone drops the join that reaches those tables.
  test("the exclusion query still reaches compressed chunks (see db-restore.yml)", () => {
    // Match the join itself, not the word: an earlier version of this assertion
    // looked for "compressed_chunk_id" and was satisfied by the *comment* above
    // the query, so sabotaging the join did not turn it red.
    expect(DUMP_SH).toContain("cc.id = c.compressed_chunk_id");
  });

  test("backup_full excludes nothing at all", async () => {
    const { flags } = await dumpFlags([CHUNK, COMPRESSED], { BACKUP_FULL: "true" });
    expect(flags.filter((f) => f.startsWith("--exclude-table-data="))).toEqual([]);
  });

  test("no chunks at all is a clean dump, not a broken flag list", async () => {
    const { flags, code } = await dumpFlags([]);
    expect(code).toBe(0);
    expect(flags.filter((f) => f.startsWith("--exclude-table-data="))).toEqual([]);
  });

  test("the dump is the custom format pg_restore needs", async () => {
    const { flags } = await dumpFlags([CHUNK]);
    expect(flags).toContain("-Fc");
  });

  test("a PRE-2.0.0 schema produces no exclusions — this dump is a migration's rollback", async () => {
    // End to end through the real script, because a decision that is computed and
    // never consulted is exactly how the compressed-chunk bug shipped. Every
    // retention number here says "excludable"; the pending schema change is what
    // must override them.
    const { flags, code } = await dumpFlags([CHUNK, COMPRESSED], {
      RETENTION_DAYS: "7 90",
      MINUTE_REFRESHED: "t",
      PRE_2_0_0: "t",
    });
    expect(code).toBe(0);
    expect(flags.some((f) => f.startsWith("--exclude-table-data="))).toBe(false);
    expect(flags).toContain("-Fc");
  });

  test("a 2.0.0 schema still excludes, so the flag keeps working after the upgrade", async () => {
    const { flags } = await dumpFlags([CHUNK, COMPRESSED], {
      RETENTION_DAYS: "7 90",
      MINUTE_REFRESHED: "t",
      PRE_2_0_0: "f",
    });
    expect(flags).toContain(`--exclude-table-data=${CHUNK}`);
  });

  test("data is excluded, never the table itself — the schema must survive", () => {
    // --exclude-table would drop the chunk's definition, so a restore would
    // rebuild a hypertable missing its chunks rather than an empty one.
    expect(DUMP_SH).not.toContain("--exclude-table=");
  });
});

/**
 * The raw-exclusion decision, lifted out of the shipped file the same way the
 * rotation block is — so these assert the code that ships, not a copy of it.
 *
 * What is being pinned is a premise with an expiry date. `dump.sh` excludes the
 * raw hypertable's chunk data by default because raw is a short window fully
 * materialized into the rollups. When raw becomes the long-horizon tier, that
 * comment is still readable, still sounds right, and the default backup silently
 * stops covering years of history. The decision is now derived from the live
 * retention policy, and every answer that is not "a small window" — including a
 * failure to ask — keeps the data.
 */
function exclusionDecisionBlock(): string {
  const start = DUMP_SH.indexOf("safe_to_exclude_raw() {");
  // The function's own closing brace, at column 0 — `indexOf("}")` would stop
  // inside the awk program's `BEGIN { … }`.
  const end = DUMP_SH.indexOf("\n}", DUMP_SH.indexOf("safe_to_exclude_raw() {"));
  if (start === -1 || end === -1) {
    throw new Error("dump.sh no longer derives the raw exclusion from retention");
  }
  return DUMP_SH.slice(start, end + 2);
}

/**
 * True when the shipped decision says raw chunk data may be excluded.
 * `rollupDays` defaults to the 90 days `minute_rollups` keeps — the shortest
 * aggregate retention the app ships.
 */
async function safeToExclude(
  days: string,
  rollupDays = "90",
  minuteRefreshed = "1",
  pre200 = "0",
): Promise<boolean> {
  const proc = Bun.spawn(
    [
      "bash",
      "-c",
      `${exclusionDecisionBlock()}\nif safe_to_exclude_raw ${JSON.stringify(days)} ${JSON.stringify(rollupDays)} ${JSON.stringify(minuteRefreshed)} ${JSON.stringify(pre200)}; then echo yes; else echo no; fi`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim() === "yes";
}

describe("dump.sh raw-exclusion decision", () => {
  test("a raw span the aggregates still materialize is excludable", async () => {
    // Every raw row's bucket is still in every aggregate, so excluding raw loses
    // resolution on restore and no coverage. The regression proof that this
    // check did not make every backup a full one.
    expect(await safeToExclude("90", "90")).toBe(true);
    expect(await safeToExclude("7", "90")).toBe(true);
  });

  test("a frozen minute tier makes raw unexcludable at any retention", async () => {
    // The premise of the whole exclusion is that raw is redundant. Once the
    // minute aggregates stopped being refreshed, raw became the ONLY
    // minute-resolution record: a backup without it restores an hourly-only
    // history, silently, and no comparison of retention numbers would notice —
    // hourly's 3650 days covers the span at its own bucket width.
    expect(await safeToExclude("90", "90", "0")).toBe(false);
    expect(await safeToExclude("1825", "3650", "0")).toBe(false);
    expect(await safeToExclude("7", "-1", "0")).toBe(false);
  });

  test("an unreadable refresh state keeps the data", async () => {
    // Same rule as every other input here: a question that could not be answered
    // is not an answer of \"probably fine\".
    expect(await safeToExclude("90", "90", "")).toBe(false);
    expect(await safeToExclude("90", "90", "maybe")).toBe(false);
  });

  test("raw outliving the shortest aggregate keeps the data", async () => {
    // One day past it is enough: that day exists only in raw, and excluding it
    // drops a time range from the backup silently.
    expect(await safeToExclude("91", "90")).toBe(false);
    expect(await safeToExclude("1460", "90")).toBe(false);
  });

  test("aggregates kept forever make any finite raw retention safe", async () => {
    // `-1` on the rollup side means no aggregate has a retention policy at all.
    expect(await safeToExclude("1460", "-1")).toBe(true);
  });

  test("raw kept forever is never safe to exclude", async () => {
    // The most dangerous case, and the one a hardcoded premise gets wrong: there
    // is no horizon at which the rollups have caught up.
    expect(await safeToExclude("-1", "-1")).toBe(false);
    expect(await safeToExclude("-1", "90")).toBe(false);
  });

  test("a query that could not run keeps the data", async () => {
    // Empty output means psql failed. Guessing "probably still fine" here is how
    // a backup tool loses history it was asked to protect.
    expect(await safeToExclude("", "90")).toBe(false);
    expect(await safeToExclude("90", "")).toBe(false);
  });

  test("an unparseable answer keeps the data", async () => {
    expect(await safeToExclude("ERROR:  relation does not exist", "90")).toBe(false);
    expect(await safeToExclude("abc", "90")).toBe(false);
    expect(await safeToExclude("90", "oops")).toBe(false);
  });

  test("fractional retentions compare on their real values", async () => {
    // `extract(epoch …) / 86400` on a 36-hour policy is not an integer, and a
    // string comparison would order "90.5" before "9".
    expect(await safeToExclude("1.5", "90")).toBe(true);
    expect(await safeToExclude("90.5", "90")).toBe(false);
  });

  test("the retentions are read from the policies, not from constants", async () => {
    // A hardcoded interval here would make the whole check decorative.
    expect(DUMP_SH).toContain("timescaledb_information.jobs");
    expect(DUMP_SH).toContain("policy_retention");
    expect(DUMP_SH).toContain("hypertable_name <> 'metrics_raw'");
  });

  test("the refresh state is read from the policies too", async () => {
    expect(DUMP_SH).toContain("policy_refresh_continuous_aggregate");
    expect(DUMP_SH).toContain("minute_rollups");
  });

  test("when the data is kept, the reason names both retentions", async () => {
    const warning = DUMP_SH.slice(DUMP_SH.indexOf("bashio::log.warning"));
    expect(warning).toContain("INCLUDED");
    expect(warning).toContain("backup_full");
    expect(warning).toContain("rollup retention");
  });
});

/**
 * The one upgrade whose backup MUST be full, and the reason it cannot be a
 * comment.
 *
 * On a 1.2.0 instance every number the exclusion consults says "excludable": raw
 * keeps 7 days, the shortest aggregate retention is 90, the minute tier is
 * refreshed. What none of those numbers can see is that the next thing to happen
 * is a SCHEMA CHANGE — `metrics_raw` re-keyed, its aggregates renamed out of the
 * way, two months of buckets replayed forward — and that this dump is its ONLY
 * rollback: there is no intermediate release and no user-performed export. A
 * default dump without raw makes a mid-migration restore silently lose the last
 * 7 days of SECOND-resolution data, which nothing regenerates, while the file
 * still looks like a successful smaller backup.
 */
describe("dump.sh: a pending 1.x → 2.0.0 migration forces a full backup", () => {
  test("a pre-2.0.0 schema is never excludable, whatever the numbers say", async () => {
    // The exact state of the one production instance today.
    expect(await safeToExclude("7", "90", "1", "1")).toBe(false);
    expect(await safeToExclude("90", "90", "1", "1")).toBe(false);
    expect(await safeToExclude("1", "-1", "1", "1")).toBe(false);
  });

  test("a 2.0.0 schema is decided by the retention numbers as before", async () => {
    expect(await safeToExclude("7", "90", "1", "0")).toBe(true);
    expect(await safeToExclude("91", "90", "1", "0")).toBe(false);
  });

  test("an unreadable schema answer keeps the data", async () => {
    // Same rule as every other input: a question that could not be answered is
    // not an answer of "probably fine".
    expect(await safeToExclude("7", "90", "1", "")).toBe(false);
    expect(await safeToExclude("7", "90", "1", "maybe")).toBe(false);
  });

  test("the schema is read from the catalog, using the migration's own discriminator", () => {
    // Both generations have a `metrics_raw`, so its existence says nothing — the
    // text `inverter_id` column is what only 1.x has. A check on the table name
    // would be decorative.
    expect(DUMP_SH).toContain("column_name = 'inverter_id'");
    expect(DUMP_SH).toContain("table_name = 'metrics_raw'");
  });
});
