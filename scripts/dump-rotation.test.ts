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

    writeFileSync(
      join(bin, "psql"),
      `#!/usr/bin/env bash\nprintf '%s\\n' ${chunkRows.map((r) => `'${r}'`).join(" ") || "''"}\nexit 0\n`,
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

  test("data is excluded, never the table itself — the schema must survive", () => {
    // --exclude-table would drop the chunk's definition, so a restore would
    // rebuild a hypertable missing its chunks rather than an empty one.
    expect(DUMP_SH).not.toContain("--exclude-table=");
  });
});
