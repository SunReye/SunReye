/**
 * The two statements, in that order, and the close that has to happen anyway.
 *
 * The two callers' suites (`scripts/archive-round-trip.test.ts`,
 * `scripts/replay-rehearsal.test.ts`) prove the happy path through their own
 * io doubles. What they do not prove is the failure: a maintenance connection
 * left open by a failed DROP is what makes the NEXT run's DROP hang, which is
 * the exact symptom both scripts document.
 */

import { describe, expect, test } from "bun:test";
import { recreateDatabase, type AdminSql } from "./recreate-database";

function fakeAdmin(fail?: (query: string) => boolean) {
  const ran: string[] = [];
  let ended = 0;
  const admin: AdminSql = {
    async unsafe(query) {
      ran.push(query);
      if (fail?.(query)) throw new Error("boom");
      return undefined;
    },
    async end() {
      ended++;
    },
  };
  return { admin, ran, ended: () => ended };
}

describe("recreateDatabase", () => {
  test("drops with FORCE, then creates, then closes", async () => {
    const { admin, ran, ended } = fakeAdmin();
    await recreateDatabase(admin, "sunreye_target");
    expect(ran).toEqual([
      "DROP DATABASE IF EXISTS sunreye_target WITH (FORCE)",
      "CREATE DATABASE sunreye_target",
    ]);
    expect(ended()).toBe(1);
  });

  test("closes the maintenance connection even when the DROP fails", async () => {
    const { admin, ran, ended } = fakeAdmin((q) => q.startsWith("DROP"));
    await expect(recreateDatabase(admin, "sunreye_target")).rejects.toThrow("boom");
    // Not created — and not left connected, which is what would wedge the next run.
    expect(ran).toEqual(["DROP DATABASE IF EXISTS sunreye_target WITH (FORCE)"]);
    expect(ended()).toBe(1);
  });

  test("and when the CREATE fails", async () => {
    const { admin, ended } = fakeAdmin((q) => q.startsWith("CREATE"));
    await expect(recreateDatabase(admin, "sunreye_target")).rejects.toThrow("boom");
    expect(ended()).toBe(1);
  });
});
