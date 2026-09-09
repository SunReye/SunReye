import { describe, expect, test } from "bun:test";

import { noMigration } from "@SunReye/db/upgrade-state";

import { migrationRecordFrom, readMigrationRecord } from "./record";

describe("migrationRecordFrom", () => {
  test("no row at all reads back as 'never migrated'", () => {
    // A fresh 2.0.0 install has no such row, and that is the overwhelmingly
    // common case. It must not look like a migration in progress.
    expect(migrationRecordFrom([])).toEqual(noMigration);
  });

  test("a plain jsonb object is read", () => {
    const record = migrationRecordFrom([{ value: { stage: "cutover", sourceId: "deye" } }]);
    expect(record.stage).toBe("cutover");
    expect(record.sourceId).toBe("deye");
  });

  test("a DOUBLE-ENCODED value is unwrapped", () => {
    // bun's `SQL` writes a JS string into a jsonb column as a JSON *string*
    // whose content is the document, which is how the migration record itself is
    // written (`upgrade-120-run.ts`). Reading one as "not an object" would report
    // a migration in progress as no migration at all.
    const record = migrationRecordFrom([{ value: JSON.stringify({ stage: "deferred" }) }]);
    expect(record.stage).toBe("deferred");
  });

  test("an unparseable value degrades to 'never migrated' rather than throwing", () => {
    // The boot chain must not die on a bookkeeping document.
    expect(migrationRecordFrom([{ value: "not json at all" }]).stage).toBe("none");
  });

  test("a NULL value degrades the same way", () => {
    expect(migrationRecordFrom([{ value: null }]).stage).toBe("none");
  });

  test("an unknown stage degrades to 'none' but the fields around it survive", () => {
    // The whole reason the schema is a flat tagged record: one bad field must not
    // erase the document that decides whether history may be dropped.
    const record = migrationRecordFrom([
      { value: { stage: "from-the-future", sourceId: "deye-sg05lp3" } },
    ]);
    expect(record.stage).toBe("none");
    expect(record.sourceId).toBe("deye-sg05lp3");
  });
});

describe("readMigrationRecord", () => {
  test("reads the row and hands it to the parser, so a live read degrades the same way", async () => {
    // The read and the parse are separated so the parse can be proved above; this
    // is the half that says the two are actually joined up.
    const record = await readMigrationRecord({
      execute: async () => ({ rows: [{ value: { stage: "carried", sourceId: "deye-sg05lp3" } }] }),
    });
    expect(record.stage).toBe("carried");
    expect(record.sourceId).toBe("deye-sg05lp3");
  });

  test("an instance with no such row reads back as 'never migrated'", async () => {
    expect(await readMigrationRecord({ execute: async () => ({ rows: [] }) })).toEqual(noMigration);
  });
});
