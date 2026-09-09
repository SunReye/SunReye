import { describe, expect, test } from "bun:test";

import {
  MIGRATION_NOTICE_KEY,
  defaultMigrationNotice,
  migrationNoticeSchema,
} from "./migration-notice";

describe("the migration notice record", () => {
  test("an install that has never snoozed is SHOWING the banner", () => {
    expect(defaultMigrationNotice).toEqual({ snoozedUntil: null });
  });

  test("an empty row parses to the default rather than failing", () => {
    expect(migrationNoticeSchema.parse({})).toEqual({ snoozedUntil: null });
  });

  test("a snooze instant round-trips", () => {
    expect(migrationNoticeSchema.parse({ snoozedUntil: "2026-09-08T12:00:00.000Z" })).toEqual({
      snoozedUntil: "2026-09-08T12:00:00.000Z",
    });
  });

  test("a snoozedUntil of the WRONG TYPE degrades to showing, not to a parse failure", () => {
    // `readSetting` safeParses to the default with no log line, so a schema that
    // threw here would report "never snoozed" anyway — but by way of losing the
    // whole record. `catch` keeps the degradation local and in one direction: the
    // banner is shown, which is the side that cannot hide missing data.
    expect(migrationNoticeSchema.parse({ snoozedUntil: 7 })).toEqual({ snoozedUntil: null });
  });

  test("an unknown field is refused, so a typo cannot become a silent no-op", () => {
    expect(() =>
      migrationNoticeSchema.parse({ snoozeUntil: "2026-09-08T12:00:00.000Z" }),
    ).toThrow();
  });

  test("the key is stable — it is the row on disk", () => {
    expect(MIGRATION_NOTICE_KEY).toBe("migrationNotice");
  });
});
