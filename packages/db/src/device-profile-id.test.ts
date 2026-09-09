import { describe, expect, test } from "bun:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import * as schema from "./schema";
import { devices } from "./schema/plants";
import { ensureDevice, readDevices, updateDevice } from "./plant-repo";

/**
 * The `devices.profile_id` invariant, pinned.
 *
 * `profile_id` is `text NOT NULL` with NO foreign key to `installed_profiles`,
 * and that is a decision rather than an omission (see the note on the column in
 * `./schema/plants.ts`). These tests are the guard on it: adding the FK someone
 * will eventually think is missing turns them red, and the failure message says
 * why it may not be added.
 *
 * They are NOT a SQL-text assertion. The first two read drizzle's own table
 * config — the object the migration is GENERATED from, so it is the declaration
 * itself — and the rest exercise the repo functions that write and read the
 * column with an id no `installed_profiles` row will ever hold.
 */

/**
 * Whatever `getTableConfig` accepts. Each concrete table's type is narrower than
 * `PgTable<TableConfig>` in a way TypeScript will not widen, so the walk over
 * `./schema`'s exports below needs the parameter type itself.
 */
type AnyTable = Parameters<typeof getTableConfig>[0];

/** A device row as the driver hands it over — ids arrive as strings. */
const deviceRow = (over: Record<string, unknown> = {}) => ({
  id: "4",
  slug: "inverter",
  name: "Inverter",
  profileId: "deye-sg05lp3",
  role: "inverter",
  unitId: "1",
  connectionId: "3",
  ...over,
});

function fakeClient(queue: Array<Array<Record<string, unknown>>> = []) {
  const executed: SQL[] = [];
  const client = {
    async execute(query: SQL) {
      executed.push(query);
      return { rows: queue.shift() ?? [] };
    },
  };
  return { client, executed };
}

/**
 * An id that is deliberately NOT in `installed_profiles`. Two real sources of
 * one: a built-in profile, which the registry holds and which
 * `apps/server/src/routes/profiles.ts` identifies precisely by the ABSENCE of an
 * installed row, and the virtual device the optimizer will carry (Phase 4.5).
 */
const NEVER_INSTALLED = "sunreye-builtin-optimizer";

describe("devices.profile_id has no foreign key", () => {
  test("no constraint on the schema's devices table references anything by profile_id", () => {
    const config = getTableConfig(devices);
    const referencing = config.foreignKeys.filter((fk) =>
      fk.reference().columns.some((column) => column.name === "profile_id"),
    );
    expect(referencing).toEqual([]);
  });

  test("no table in the schema references installed_profiles at all", () => {
    // The other half of the same rule, and the one that keeps `uninstallProfile`
    // a plain DELETE: any FK onto `installed_profiles` would either RESTRICT the
    // uninstall (a profile could never be removed once a device used it) or
    // CASCADE into the device rows and take five years of readings with them.
    const offenders: string[] = [];
    for (const value of Object.values(schema) as unknown[]) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value as AnyTable);
      for (const fk of config.foreignKeys) {
        if (getTableConfig(fk.reference().foreignTable).name === "installed_profiles") {
          offenders.push(config.name);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("a device may name a profile that is not installed", () => {
  test("ensureDevice writes an id with no installed_profiles row", async () => {
    // The device writer path never checks, and must never check, whether the id
    // resolves: a built-in profile has no row by design, and the runtime
    // registry — not this table — is what turns the id into a driver.
    const { client } = fakeClient([[], [deviceRow({ profileId: NEVER_INSTALLED })]]);

    const device = await ensureDevice(client, {
      plantId: 7,
      connectionId: null,
      unitId: 1,
      slug: "inverter",
      name: "Optimizer",
      profileId: NEVER_INSTALLED,
      role: "inverter",
    });

    expect(device.profileId).toBe(NEVER_INSTALLED);
  });

  test("readDevices returns the device whose profile was uninstalled, in one statement", async () => {
    // The history outlives the profile: raw retention is five years and a
    // profile can be uninstalled this afternoon. The read must not join, filter
    // or otherwise consult `installed_profiles` — one statement, and the id
    // comes back verbatim for the registry to resolve (or not).
    const { client, executed } = fakeClient([
      [deviceRow({ profileId: "gone-with-the-uninstall" })],
    ]);

    const found = await readDevices(client, 7);

    expect(found).toHaveLength(1);
    expect(found[0]?.profileId).toBe("gone-with-the-uninstall");
    expect(executed).toHaveLength(1);
  });

  test("updateDevice re-points a device onto an uninstalled id, keeping its id", async () => {
    // The profile SWAP this release exists for: the driver changes, the device
    // id — the int2 in every row of `metrics_raw` — does not. The id it swaps
    // TO need not be installed either; onboarding test-reads a freshly chosen
    // profile before the restart that registers it.
    const { client } = fakeClient([[], [deviceRow({ id: "4", profileId: NEVER_INSTALLED })]]);

    const device = await updateDevice(client, 4, { profileId: NEVER_INSTALLED });

    expect(device.id).toBe(4);
    expect(device.profileId).toBe(NEVER_INSTALLED);
  });

  test("an empty profile id is still written — the column has no opinion", async () => {
    // A boundary worth stating rather than discovering: `profile_id` is NOT NULL
    // and nothing more. An import with a blank id produces a device that
    // resolves to no profile and is simply not polled, which is recoverable;
    // rejecting it here would drop the readings instead.
    const { client } = fakeClient([[], [deviceRow({ profileId: "" })]]);

    const device = await ensureDevice(client, {
      plantId: 7,
      connectionId: null,
      unitId: 1,
      slug: "imported",
      name: "Imported",
      profileId: "",
      role: "inverter",
    });

    expect(device.profileId).toBe("");
  });
});
