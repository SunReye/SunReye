import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import { devices, sources } from "./devices";

const config = (table: Parameters<typeof getTableConfig>[0]) => getTableConfig(table);

const columns = (table: Parameters<typeof getTableConfig>[0]) =>
  new Map(config(table).columns.map((c) => [c.name, c]));

const foreignKeys = (table: Parameters<typeof getTableConfig>[0]) =>
  config(table).foreignKeys.map((fk) => {
    const ref = fk.reference();
    return {
      column: ref.columns[0]?.name,
      foreignTable: getTableConfig(ref.foreignTable).name,
      foreignColumn: ref.foreignColumns[0]?.name,
      onDelete: fk.onDelete,
    };
  });

describe("the source → device split", () => {
  test("a device belongs to a source", () => {
    // One connection yields many devices: N loadpoints behind one EVCC, a house
    // behind one Home Assistant, several unit ids on one RS485 gateway.
    expect(foreignKeys(devices)).toEqual([
      { column: "source_id", foreignTable: "sources", foreignColumn: "id", onDelete: "restrict" },
    ]);
  });

  test("deleting a source cannot silently take its devices' history with it", () => {
    // `restrict`, not `cascade`: a device id is the key metrics_raw rows are
    // written under, and that column has no FK to clean up after it. A cascade
    // would leave years of readings addressed by an id nothing describes any
    // more, and it would do it without a word.
    expect(foreignKeys(devices)[0]?.onDelete).toBe("restrict");
  });

  test("both ids are text, so a device id can be a profile slug", () => {
    // The first device inherits the active profile's id, because that string is
    // already the `inverter_id` of every historical row and the HA entity
    // registry key. A generated uuid here would orphan both.
    expect(columns(sources).get("id")?.dataType).toBe("string");
    expect(columns(devices).get("id")?.dataType).toBe("string");
    expect(columns(devices).get("id")?.primary).toBe(true);
    expect(columns(sources).get("id")?.primary).toBe(true);
  });

  test("looking a source's devices up is indexed", () => {
    expect(config(devices).indexes.map((i) => i.config.name)).toContain("devices_source_id_idx");
  });

  test("timestamps carry their zone on both tables", () => {
    // The app-owned flavour. The naive builders exist only for Better Auth's
    // committed migrations.
    for (const table of [sources, devices]) {
      for (const name of ["created_at", "updated_at"]) {
        expect(columns(table).get(name)?.getSQLType()).toBe("timestamp with time zone");
      }
    }
  });

  test("a device names the source it is reached through and the profile that decodes it", () => {
    const device = columns(devices);

    expect(device.get("source_id")?.notNull).toBe(true);
    expect(device.get("profile_id")?.notNull).toBe(true);
    expect(device.get("device_class")?.notNull).toBe(true);
    // How to pick this device out of the ones sharing that connection — a
    // Modbus unit id, an EVCC loadpoint index, an entity prefix. Shapeless
    // here on purpose: the source's kind decides what it means.
    expect(device.get("address")?.notNull).toBe(true);
  });

  test("both a source and a device can be switched off without being deleted", () => {
    // Deleting is what loses history. Disabling is what a user actually wants
    // when an inverter is off for the winter.
    for (const table of [sources, devices]) {
      const enabled = columns(table).get("enabled");
      expect(enabled?.notNull).toBe(true);
      expect(enabled?.hasDefault).toBe(true);
    }
  });
});
