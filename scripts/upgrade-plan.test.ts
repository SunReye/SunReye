/**
 * The upgrade rehearsal's pure half — and above all its TARGET PINNING.
 *
 * `scripts/upgrade-rehearsal.ts` DROPs its target database. Two of this host's
 * ports must never be dropped: 5432 is the developer's dev database, SHARED WITH
 * A LIVE GRID-TIED INVERTER, and 5433 is the addon-1.2.0 fixture, expensive to
 * rebuild and read-only. Nothing else in the repo would stop a copy-pasted
 * `DATABASE_URL` from reaching either, which is why these assertions exist before
 * any of the ones about phases and problem strings.
 *
 * The rest is the reasoning the script does BETWEEN database calls: which phases
 * an argument list means, what makes the post-rename schema "serving", and
 * whether the rename preserved every bucket. All of it decides whether two months
 * of an operator's only history may be dropped, and none of it needs Postgres to
 * be tested.
 */
import { describe, expect, test } from "bun:test";

import {
  ALLOWED_PORTS,
  DEFAULT_OPTIONS,
  DEV_DB_PORT,
  FIXTURE_PORT,
  PHASES,
  type ServingState,
  assertUpgradeTarget,
  parseArgs,
  phasesToRun,
  renamePreservedProblems,
  report,
  servingProblems,
} from "./upgrade-plan";

const url = (port: number, database = "sunreye_upgrade_200") =>
  `postgres://postgres:fixture@localhost:${port}/${database}`;

describe("assertUpgradeTarget", () => {
  test("the dev database is refused, and told apart from a merely wrong port", () => {
    // The one mistake here a rebuild cannot undo, so it gets its own message.
    expect(() => assertUpgradeTarget(url(DEV_DB_PORT))).toThrow(/live inverter/);
  });

  test("the 1.2.0 fixture container is refused as READ-ONLY", () => {
    expect(() => assertUpgradeTarget(url(FIXTURE_PORT))).toThrow(/READ-ONLY/);
  });

  test("a port that is neither is still refused — the allowlist is the rule", () => {
    // The default-deny is what makes an ambient DATABASE_URL harmless: a new
    // rehearsal port has to be added deliberately.
    expect(() => assertUpgradeTarget(url(5435))).toThrow(/may only run on/);
  });

  test("every allowed port is actually allowed", () => {
    for (const port of ALLOWED_PORTS) {
      expect(() => assertUpgradeTarget(url(port))).not.toThrow();
    }
  });

  test("an allowed port with the WRONG database name is refused", () => {
    // The port allowlist is not enough on its own: a rehearsal container can hold
    // other databases (the db-test layer's, for one) and this script drops what it
    // is pointed at.
    expect(() => assertUpgradeTarget(url(5440, "sunreye_dbtest"))).toThrow(/sunreye_upgrade/);
  });

  test("a URL naming no database at all is refused rather than defaulted", () => {
    expect(() => assertUpgradeTarget("postgres://postgres:fixture@localhost:5440")).toThrow(
      /no database/,
    );
  });

  test("the dev port is refused even when the database name would be allowed", () => {
    // Order matters: the port check has to come first, or a plausible-looking
    // name would talk the script onto the live database.
    expect(() => assertUpgradeTarget(url(DEV_DB_PORT, "sunreye_upgrade_200"))).toThrow(
      /live inverter/,
    );
  });
});

describe("parseArgs", () => {
  test("no arguments is the documented default", () => {
    expect(parseArgs([])).toEqual(DEFAULT_OPTIONS);
  });

  test("an unknown flag is REJECTED, so a typo cannot silently mean 'all'", () => {
    // `--phas=verify` parsed leniently would run every phase, including the drop.
    expect(() => parseArgs(["--phas=verify"])).toThrow(/unknown argument/);
    expect(() => parseArgs(["--dry-run"])).toThrow(/unknown argument/);
  });

  test("an unknown phase names the ones that exist", () => {
    expect(() => parseArgs(["--phase=backfil"])).toThrow(/not one of/);
  });

  test("each phase parses", () => {
    for (const phase of PHASES) {
      expect(parseArgs([`--phase=${phase}`]).phase).toBe(phase);
    }
  });

  test("--stop-after takes a non-negative integer and refuses anything else", () => {
    expect(parseArgs(["--stop-after=8"]).stopAfter).toBe(8);
    expect(parseArgs(["--stop-after=0"]).stopAfter).toBe(0);
    expect(() => parseArgs(["--stop-after=-1"])).toThrow(/non-negative/);
    expect(() => parseArgs(["--stop-after=2.5"])).toThrow(/non-negative/);
    expect(() => parseArgs(["--stop-after=lots"])).toThrow(/non-negative/);
  });

  test("--port refuses a non-integer rather than dialling NaN", () => {
    expect(() => parseArgs(["--port=54x40"])).toThrow(/not an integer/);
  });

  test("--fast and --full are last-wins, not sticky", () => {
    expect(parseArgs(["--fast"]).mode).toBe("fast");
    expect(parseArgs(["--fast", "--full"]).mode).toBe("full");
  });

  test("--help is a flag, and both spellings work", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("the value flags land where they are named", () => {
    const options = parseArgs([
      "--container=c",
      "--database=sunreye_upgrade_x",
      "--dump=/tmp/x.dump",
      "--password=p",
      "--refresh-chunk-days=3",
    ]);
    expect(options.container).toBe("c");
    expect(options.database).toBe("sunreye_upgrade_x");
    expect(options.dump).toBe("/tmp/x.dump");
    expect(options.password).toBe("p");
    expect(options.refreshChunkDays).toBe(3);
  });
});

describe("phasesToRun", () => {
  test("'all' runs the upgrade in the only order that works", () => {
    // Not alphabetical and not arbitrary: provision needs the blocking step's
    // migration record, the backfill needs the device provision created, verify
    // needs the backfill, and the drop needs verify to have recorded `verified`.
    expect(phasesToRun("all")).toEqual([
      "restore",
      "blocking",
      "provision",
      "backfill",
      "verify",
      "drop",
    ]);
  });

  test("any single phase runs alone — the resumability story depends on it", () => {
    // A killed run has to be resumable from a NEW process, so each phase must be
    // separately invocable.
    expect(phasesToRun("backfill")).toEqual(["backfill"]);
  });
});

const serving = (over: Partial<ServingState> = {}): ServingState => ({
  rawColumns: ["time", "value", "dur_ms", "device_id", "metric_id"],
  aggregates: [
    "minute_rollups",
    "hourly_rollups",
    "daily_rollups",
    "legacy_minute_rollups",
    "legacy_hourly_rollups",
    "legacy_daily_rollups",
  ],
  jobs: ["policy_retention:metrics_raw", "policy_refresh_continuous_aggregate:minute_rollups"],
  legacyRelations: ["metrics_raw_legacy", "legacy_minute_rollups"],
  ...over,
});

describe("servingProblems", () => {
  test("the state the blocking step should leave has no problems", () => {
    expect(servingProblems(serving())).toEqual([]);
  });

  test("a metrics_raw still carrying inverter_id means the rename did not happen", () => {
    const problems = servingProblems(
      serving({ rawColumns: ["time", "value", "inverter_id", "metric"] }),
    );
    expect(problems.join(" ")).toContain("inverter_id");
    // And the new columns are reported missing too, each on its own: a half-shaped
    // table is addressable by every query and answerable by none.
    expect(problems.join(" ")).toContain("device_id");
  });

  test("a MISSING legacy aggregate is a problem — those buckets are the history", () => {
    const problems = servingProblems(
      serving({
        aggregates: ["minute_rollups", "hourly_rollups", "daily_rollups", "legacy_hourly_rollups"],
      }),
    );
    expect(problems.join(" ")).toMatch(/legacy_minute_rollups is missing/);
  });

  test("a missing NEW aggregate is a problem too", () => {
    const problems = servingProblems(
      serving({
        aggregates: [
          "minute_rollups",
          "hourly_rollups",
          "legacy_minute_rollups",
          "legacy_hourly_rollups",
          "legacy_daily_rollups",
        ],
      }),
    );
    expect(problems.join(" ")).toMatch(/daily_rollups was not created/);
  });

  test("THE DECISIVE ONE: a job still pointing at a legacy relation is reported", () => {
    // The old minute tier's 90-day retention is what would keep eating the
    // history while the operator decides whether to migrate, and it is invisible
    // until a chunk is already gone.
    const problems = servingProblems(serving({ jobs: ["policy_retention:legacy_minute_rollups"] }));
    expect(problems.join(" ")).toMatch(/will eat the history/);
  });

  test("a job on metrics_raw_legacy itself is caught as well", () => {
    const problems = servingProblems(serving({ jobs: ["policy_retention:metrics_raw_legacy"] }));
    expect(problems).toHaveLength(1);
  });

  test("a missing metrics_raw_legacy means there is NO ROLLBACK", () => {
    const problems = servingProblems(serving({ legacyRelations: [] }));
    expect(problems.join(" ")).toMatch(/no rollback/);
  });
});

describe("renamePreservedProblems", () => {
  const tier = { count: 9_072_000, digest: "abc" };

  test("identical tiers are no problem", () => {
    expect(renamePreservedProblems("minute_rollups", tier, tier)).toEqual([]);
  });

  test("a changed bucket count is reported as a rename that lost data", () => {
    const problems = renamePreservedProblems("minute_rollups", tier, {
      count: 9_071_999,
      digest: "abc",
    });
    expect(problems).not.toHaveLength(0);
    expect(problems.join(" ")).toMatch(/bit for bit/);
  });

  test("a changed DIGEST is reported even when the count matches", () => {
    // The count alone would miss a bucket whose value changed, which is exactly
    // what a rename must never do.
    const problems = renamePreservedProblems("daily_rollups", tier, {
      count: 9_072_000,
      digest: "def",
    });
    expect(problems).not.toHaveLength(0);
  });
});

describe("report", () => {
  test("no problems is exit 0", () => {
    expect(report([])).toBe(0);
  });

  test("any problem is exit 1 — a rehearsal that found something must not pass", () => {
    expect(report(["something is wrong"])).toBe(1);
  });

  test("a flood of problems still exits 1 and does not throw while truncating", () => {
    expect(report(Array.from({ length: 100 }, (_, i) => `problem ${i}`))).toBe(1);
  });
});
