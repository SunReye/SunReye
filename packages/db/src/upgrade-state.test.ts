import { describe, expect, test } from "bun:test";

import {
  MIGRATION_KEY,
  backfillOutstanding,
  type MigrationRecord,
  describeMissingHistory,
  mayDropLegacy,
  migrationHorizonFrom,
  migrationRecordSchema,
  needsMigrationOnboarding,
  noMigration,
} from "./upgrade-state";

const CUTOVER = "2026-08-27T09:00:00.000Z";

function record(partial: Partial<MigrationRecord> = {}): MigrationRecord {
  return migrationRecordSchema.parse({ ...partial });
}

describe("migrationRecordSchema", () => {
  test("an absent row parses to 'no migration ever happened here'", () => {
    expect(migrationRecordSchema.parse({})).toEqual(noMigration);
  });

  test("the key is a settings key, not a table", () => {
    expect(MIGRATION_KEY).toBe("migration.v2");
  });

  test("every field has a default, so one bad field cannot reset the record", () => {
    // The whole reason this is a FLAT tagged record and not a discriminated
    // union: `readSetting` safeParses to the DEFAULT with no log line, so a
    // schema that can reject the document loses the operator's migration state
    // silently — and this document is what decides whether the legacy history
    // may be dropped.
    const parsed = migrationRecordSchema.safeParse({
      stage: "carried",
      cutoverAt: CUTOVER,
      sourceId: "deye-sg05lp3",
      legacyRawFrom: "not a date at all",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.stage).toBe("carried");
    expect(parsed.data?.cutoverAt).toBe(CUTOVER);
    expect(parsed.data?.legacyRawFrom).toBeNull();
  });

  test("an unknown stage falls back to none rather than rejecting the document", () => {
    const parsed = migrationRecordSchema.safeParse({ stage: "halfway", cutoverAt: CUTOVER });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.stage).toBe("none");
    expect(parsed.data?.cutoverAt).toBe(CUTOVER);
  });
});

describe("migrationHorizonFrom", () => {
  test("a cutover with no backfill withholds everything before it", () => {
    expect(migrationHorizonFrom(record({ stage: "cutover", cutoverAt: CUTOVER }))).toEqual(
      new Date(CUTOVER),
    );
  });

  test("once the raw window is carried the horizon moves back to where raw began", () => {
    // The carry is the cheap half and it recovers seven days. Reporting the
    // cutover afterwards would refuse a week of data that is actually there.
    expect(
      migrationHorizonFrom(
        record({
          stage: "carried",
          cutoverAt: CUTOVER,
          legacyRawFrom: "2026-08-20T00:00:00.000Z",
        }),
      ),
    ).toEqual(new Date("2026-08-20T00:00:00.000Z"));
  });

  test("a deferred migration still withholds — deferring is not finishing", () => {
    expect(migrationHorizonFrom(record({ stage: "deferred", cutoverAt: CUTOVER }))).not.toBeNull();
  });

  test("a finished backfill withholds nothing", () => {
    for (const stage of ["backfilled", "verified", "dropped"] as const) {
      expect(migrationHorizonFrom(record({ stage, cutoverAt: CUTOVER }))).toBeNull();
    }
  });

  test("no migration withholds nothing", () => {
    expect(migrationHorizonFrom(noMigration)).toBeNull();
  });

  test("a stage that claims a cutover without recording one withholds nothing", () => {
    // Refusing every read on an unparseable date would take the dashboard down
    // over a bookkeeping field. Nothing is claimed missing that cannot be named.
    expect(migrationHorizonFrom(record({ stage: "cutover" }))).toBeNull();
  });
});

describe("describeMissingHistory", () => {
  test("the banner NAMES the boundary rather than saying 'some data'", () => {
    const text = describeMissingHistory(record({ stage: "cutover", cutoverAt: CUTOVER }));
    expect(text).toContain("2026-08-27");
  });

  test("a finished migration has no banner", () => {
    expect(describeMissingHistory(record({ stage: "verified", cutoverAt: CUTOVER }))).toBeNull();
  });
});

describe("mayDropLegacy", () => {
  test("only a VERIFIED migration may drop the legacy objects", () => {
    // They are not a read source, they are THE ROLLBACK — the only thing between
    // a failed migration and data loss, because there is no intermediate release
    // and no user-performed export beforehand.
    for (const stage of ["none", "cutover", "carried", "deferred", "backfilled"] as const) {
      expect(mayDropLegacy(record({ stage }))).toBe(false);
    }
    expect(mayDropLegacy(record({ stage: "verified" }))).toBe(true);
  });

  test("an already-dropped migration does not drop again", () => {
    expect(mayDropLegacy(record({ stage: "dropped" }))).toBe(false);
  });
});

describe("needsMigrationOnboarding", () => {
  test("a 1.x upgrade with no confirmed names must ask, and holds discovery", () => {
    for (const stage of ["cutover", "carried", "deferred", "backfilled", "verified"] as const) {
      expect(needsMigrationOnboarding(record({ stage, cutoverAt: CUTOVER }))).toBe(true);
    }
  });

  test("confirmed names end it, whatever the stage", () => {
    expect(
      needsMigrationOnboarding(
        record({ stage: "deferred", cutoverAt: CUTOVER, namesConfirmedAt: CUTOVER }),
      ),
    ).toBe(false);
  });

  test("an install that never ran a 1.x upgrade is never asked", () => {
    // The failure this prevents: holding Home Assistant discovery forever on a
    // healthy install, which is indistinguishable from a broken MQTT bridge.
    expect(needsMigrationOnboarding(noMigration)).toBe(false);
  });

  test("a finished-and-dropped migration is never asked again", () => {
    expect(needsMigrationOnboarding(record({ stage: "dropped" }))).toBe(false);
  });
});

describe("backfillOutstanding", () => {
  test("a deferred migration is still outstanding — deferring is not finishing", () => {
    expect(backfillOutstanding(record({ stage: "deferred", cutoverAt: CUTOVER }))).toBe(true);
  });

  test("cutover and carried are outstanding", () => {
    expect(backfillOutstanding(record({ stage: "cutover" }))).toBe(true);
    expect(backfillOutstanding(record({ stage: "carried" }))).toBe(true);
  });

  test("a finished backfill is not", () => {
    for (const stage of ["backfilled", "verified", "dropped", "none"] as const) {
      expect(backfillOutstanding(record({ stage }))).toBe(false);
    }
  });
});
