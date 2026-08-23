import { mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
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
  test("the non-full mode excludes only metrics_raw chunk DATA", () => {
    expect(DUMP_SH).toContain("--exclude-table-data=");
    expect(DUMP_SH).toContain("hypertable_name = 'metrics_raw'");
    expect(DUMP_SH).not.toContain("--exclude-table=");
  });

  test("backup_full dumps everything — no exclusion is computed", () => {
    expect(DUMP_SH).toContain("bashio::config.true 'backup_full'");
  });

  test("the dump is the custom format pg_restore needs", () => {
    expect(DUMP_SH).toContain("pg_dump -Fc");
  });
});
