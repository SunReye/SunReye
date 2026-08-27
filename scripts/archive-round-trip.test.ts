/**
 * The round-trip harness's own decisions — chiefly the TARGET PINNING, which is
 * the one part of a script that drops databases that must not be discovered to be
 * wrong by running it.
 *
 * Port 5432 is the developer's dev database, SHARED WITH A LIVE GRID-TIED
 * INVERTER, and port 5433 is the fixture container the whole wave depends on.
 * Both are refused; the reporting helpers are here because a wrong figure in the
 * report is how a slow feature gets called fast.
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULTS,
  DEV_DB_PORT,
  HELP,
  SHARED_FIXTURE_PORT,
  assertRoundTripTarget,
  humanBytes,
  parseArgs,
  throughput,
} from "./archive-round-trip";

const url = (port: number, db = "sunreye_archive_target") =>
  `postgres://postgres:postgres@localhost:${port}/${db}`;

describe("assertRoundTripTarget", () => {
  test("REFUSES the dev database's port — it is shared with a live inverter", () => {
    expect(() => assertRoundTripTarget(url(DEV_DB_PORT))).toThrow(/live grid-tied inverter/);
  });

  test("REFUSES the shared fixture's port — it is read-only and expensive to rebuild", () => {
    expect(() => assertRoundTripTarget(url(SHARED_FIXTURE_PORT))).toThrow(/read-only/);
  });

  test("refuses the dev port whatever the database is called", () => {
    // The port is the fact, not the name: `postgres` on 5432 is the same server.
    expect(() => assertRoundTripTarget(url(DEV_DB_PORT, "anything"))).toThrow();
  });

  test("allows a port of the operator's own", () => {
    expect(() => assertRoundTripTarget(url(5441))).not.toThrow();
    expect(() => assertRoundTripTarget(url(5555))).not.toThrow();
  });

  test("the default port is not one of the refused ones", () => {
    expect(DEFAULTS.port).not.toBe(DEV_DB_PORT);
    expect(DEFAULTS.port).not.toBe(SHARED_FIXTURE_PORT);
    expect(() => assertRoundTripTarget(url(DEFAULTS.port))).not.toThrow();
  });

  test("the help text names both refused ports, so nobody has to read the source", () => {
    expect(HELP).toContain(String(DEV_DB_PORT));
    expect(HELP).toContain(String(SHARED_FIXTURE_PORT));
  });
});

describe("parseArgs", () => {
  test("no arguments is the documented default", () => {
    expect(parseArgs([])).toEqual(DEFAULTS);
  });

  test("--port, --source and --target are read", () => {
    const options = parseArgs(["--port", "5442", "--source", "src", "--target", "dst"]);
    expect(options.port).toBe(5442);
    expect(options.sourceDb).toBe("src");
    expect(options.targetDb).toBe("dst");
  });

  test("--mode accepts fast and falls back to full for anything else", () => {
    expect(parseArgs(["--mode", "fast"]).mode).toBe("fast");
    expect(parseArgs(["--mode", "nonsense"]).mode).toBe("full");
  });

  test("--keep is a flag and does not swallow the next argument", () => {
    const options = parseArgs(["--keep", "--port", "5442"]);
    expect(options.keep).toBe(true);
    expect(options.port).toBe(5442);
  });

  test("the source and target must be different databases by default", () => {
    // Exporting from and importing into one database would compare a database
    // against itself and pass over anything.
    expect(DEFAULTS.sourceDb).not.toBe(DEFAULTS.targetDb);
  });
});

describe("humanBytes", () => {
  test("bytes stay bytes", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(512)).toBe("512 B");
  });

  test("the real measured archive reads as tens of megabytes, not as a raw integer", () => {
    expect(humanBytes(55_617_590)).toBe("53 MB");
  });

  test("a small value keeps two decimals so a ratio is not rounded to nothing", () => {
    expect(humanBytes(1536)).toBe("1.50 kB");
  });

  test("gigabytes are the ceiling — nothing here produces terabytes", () => {
    expect(humanBytes(1_421_583_309)).toEndWith(" GB");
  });
});

describe("throughput", () => {
  test("rows per second, rounded", () => {
    expect(throughput(9_072_000, 52_200)).toBe(173_793);
  });

  test("zero elapsed is null rather than Infinity — a report must not print Infinity", () => {
    expect(throughput(100, 0)).toBeNull();
    expect(throughput(100, -1)).toBeNull();
  });

  test("zero rows is zero, not null", () => {
    expect(throughput(0, 1000)).toBe(0);
  });
});
