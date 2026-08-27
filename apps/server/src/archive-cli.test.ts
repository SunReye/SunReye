/**
 * THE `sunreye export` / `sunreye import` ARGUMENT SURFACE.
 *
 * A CLI is where a wrong default becomes an operator's bad afternoon, and two of
 * the decisions here are load-bearing:
 *
 *  * THE SUBCOMMAND NAMES MUST NOT COLLIDE WITH ANY FLAG. `apps/server/src/main.ts`
 *    routes on a bare `process.argv.includes("export")`, so a flag named
 *    `--export` anywhere — or a subcommand called `healthcheck` — would silently
 *    reroute a server boot into a data export. That is checked here rather than
 *    left to reading.
 *  * `--legacy` IS A SOURCE SELECTION, NOT A HINT. Reading a 1.2.0 database as if
 *    it were 2.0.0 finds no `devices` table and exports nothing, successfully. So
 *    the source is DETECTED from the schema, and the flag only overrides.
 */
import { describe, expect, test } from "bun:test";

import {
  ARCHIVE_SUBCOMMANDS,
  EXPORT_HELP,
  KNOWN_FLAGS,
  defaultArchiveName,
  parseDeviceMap,
  parseExportArgs,
  parseImportArgs,
  sourceForShape,
} from "./archive-cli";

describe("the subcommand names are safe for main.ts's bare argv.includes", () => {
  test("no subcommand starts with a dash", () => {
    for (const name of ARCHIVE_SUBCOMMANDS) expect(name).not.toStartWith("-");
  });

  test("no subcommand collides with a flag the binary already understands", () => {
    // `main.ts` does `process.argv.includes("export")` on the WHOLE argv, so a
    // collision would reroute a normal boot.
    for (const name of ARCHIVE_SUBCOMMANDS) {
      expect(KNOWN_FLAGS).not.toContain(name);
      expect(KNOWN_FLAGS).not.toContain(`--${name}`);
    }
  });

  test("the subcommands are distinct from each other and from `migrate`", () => {
    expect(new Set(ARCHIVE_SUBCOMMANDS).size).toBe(ARCHIVE_SUBCOMMANDS.length);
    expect(ARCHIVE_SUBCOMMANDS).not.toContain("migrate");
  });
});

describe("sourceForShape", () => {
  test("a database with a devices table is read as 2.0.0", () => {
    expect(sourceForShape({ hasDevices: true }, undefined)).toBe("native");
  });

  test("a database WITHOUT a devices table is read as 1.x, never as an empty 2.0.0", () => {
    // The failure this prevents: a native read of a 1.2.0 database joins `devices`,
    // finds nothing, and writes a perfectly valid archive containing no history.
    expect(sourceForShape({ hasDevices: false }, undefined)).toBe("legacy");
  });

  test("an explicit choice always wins over detection", () => {
    expect(sourceForShape({ hasDevices: true }, "legacy")).toBe("legacy");
    expect(sourceForShape({ hasDevices: false }, "native")).toBe("native");
  });
});

describe("parseExportArgs", () => {
  test("no arguments is a full export to a dated default name", () => {
    const options = parseExportArgs([]);
    expect(options.tiers).toBeUndefined();
    expect(options.source).toBeUndefined();
    expect(options.out).toBeNull();
  });

  test("--out names the file", () => {
    expect(parseExportArgs(["export", "--out", "/share/x.tar.gz"]).out).toBe("/share/x.tar.gz");
  });

  test("--legacy and --native select the source", () => {
    expect(parseExportArgs(["--legacy"]).source).toBe("legacy");
    expect(parseExportArgs(["--native"]).source).toBe("native");
  });

  test("--tiers narrows the sources, and the order is kept (finest first matters)", () => {
    expect(parseExportArgs(["--tiers", "raw,minute"]).tiers).toEqual(["raw", "minute"]);
  });

  test("an unknown tier is refused rather than silently ignored", () => {
    // Silently ignoring it would export less history than the operator asked for.
    expect(() => parseExportArgs(["--tiers", "weekly"])).toThrow(/weekly/);
  });

  test("--tiers with nothing after it is refused", () => {
    expect(() => parseExportArgs(["--tiers"])).toThrow(/--tiers/);
  });

  test("--out with nothing after it is refused rather than writing to the empty path", () => {
    expect(() => parseExportArgs(["--out"])).toThrow(/--out/);
  });

  test("an unrecognised flag is refused — a typo must not become a full-history default", () => {
    expect(() => parseExportArgs(["--tier", "raw"])).toThrow(/--tier/);
  });

  test("secrets are OFF by default and only an explicit flag turns them on", () => {
    // The MQTT password is stored in plaintext and the REST API refuses to return
    // it; an export that carried it by default would be a credential leak into a
    // file designed to be copied around.
    expect(parseExportArgs([]).includeSecrets).toBe(false);
    expect(parseExportArgs(["--tiers", "raw"]).includeSecrets).toBe(false);
    expect(parseExportArgs(["--include-secrets"]).includeSecrets).toBe(true);
  });

  test("the help text warns what --include-secrets does", () => {
    expect(EXPORT_HELP).toMatch(/--include-secrets/);
    expect(EXPORT_HELP).toMatch(/credential|LAN|Samba/);
  });
});

describe("parseImportArgs", () => {
  test("a bare path is the file", () => {
    expect(parseImportArgs(["import", "/share/x.tar.gz"]).file).toBe("/share/x.tar.gz");
  });

  test("--file names it too", () => {
    expect(parseImportArgs(["--file", "/share/x.tar.gz"]).file).toBe("/share/x.tar.gz");
  });

  test("no file at all is refused", () => {
    expect(() => parseImportArgs([])).toThrow(/file/i);
  });

  test("the subcommand word is not mistaken for the file", () => {
    expect(() => parseImportArgs(["import"])).toThrow(/file/i);
  });

  test("--force and --no-refresh are off by default", () => {
    const options = parseImportArgs(["/x.tar.gz"]);
    expect(options.force).toBe(false);
    expect(options.refresh).toBe(true);
  });

  test("--force is opt-in and nothing else turns it on", () => {
    expect(parseImportArgs(["/x.tar.gz", "--force"]).force).toBe(true);
  });

  test("--no-refresh turns the manual aggregate refresh OFF, and that is the dangerous one", () => {
    // Without the refresh the hypertable is full and every chart is empty, because
    // the refresh POLICIES only reach three hours back. It has to be explicit.
    expect(parseImportArgs(["/x.tar.gz", "--no-refresh"]).refresh).toBe(false);
  });

  test("--device-map builds the rename table", () => {
    expect(parseImportArgs(["/x", "--device-map", "old=new,a=b"]).deviceMap).toEqual({
      old: "new",
      a: "b",
    });
  });

  test("an unrecognised flag is refused", () => {
    expect(() => parseImportArgs(["/x", "--forse"])).toThrow(/--forse/);
  });
});

describe("parseDeviceMap", () => {
  test("empty input is an empty map", () => {
    expect(parseDeviceMap("")).toEqual({});
  });

  test("a single pair", () => {
    expect(parseDeviceMap("a=b")).toEqual({ a: "b" });
  });

  test("whitespace around the pairs is tolerated", () => {
    expect(parseDeviceMap(" a = b , c=d ")).toEqual({ a: "b", c: "d" });
  });

  test("a pair with no '=' is refused rather than dropped", () => {
    // Dropping it would import under the ORIGINAL slug, which is the outcome the
    // operator was trying to avoid.
    expect(() => parseDeviceMap("a=b,oops")).toThrow(/oops/);
  });

  test("an empty side is refused", () => {
    expect(() => parseDeviceMap("=b")).toThrow();
    expect(() => parseDeviceMap("a=")).toThrow();
  });
});

describe("defaultArchiveName", () => {
  test("carries the date so two exports do not overwrite each other", () => {
    const name = defaultArchiveName(new Date("2026-08-27T19:41:58.476Z"));
    expect(name).toContain("2026-08-27");
    expect(name).toEndWith(".tar.gz");
  });

  test("has no colon or space — it has to survive Samba and a Windows share", () => {
    const name = defaultArchiveName(new Date("2026-08-27T19:41:58.476Z"));
    expect(name).not.toMatch(/[:\s]/);
  });

  test("two exports in the same second still differ by nothing — the date is the contract", () => {
    const at = new Date("2026-08-27T19:41:58.476Z");
    expect(defaultArchiveName(at)).toBe(defaultArchiveName(at));
  });
});
