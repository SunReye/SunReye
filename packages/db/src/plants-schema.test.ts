import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { DEVICE_CLASSES } from "@SunReye/inverter-core/device-class";
// Lives beside the other `*-schema.test.ts` files, not under `./schema/`: that
// directory is drizzle-kit's schema glob, and a test file there breaks `generate`.
import { devices } from "./schema/plants";

const dialect = new PgDialect();

function renderedCheck(name: string): string {
  const check = getTableConfig(devices).checks.find((c) => c.name === name);
  if (!check) throw new Error(`no check named ${name}`);
  return dialect.sqlToQuery(check.value.inlineParams()).sql;
}

describe("devices_role_check", () => {
  // The constraint is DERIVED from the shared device-class list, so a sixth
  // class cannot be admitted by the engine and unknown to the read layer.
  test("admits every catalogued device class and nothing else", () => {
    const list = DEVICE_CLASSES.map((c) => `'${c}'`).join(", ");
    expect(renderedCheck("devices_role_check")).toBe(`"devices"."role" in (${list})`);
  });

  // Rendering must be byte-identical to the shipped migration, or drizzle-kit
  // would see a changed constraint and emit a DROP/ADD nobody asked for.
  test("renders exactly what migration 0003 shipped", () => {
    const sql = readFileSync(
      new URL("./migrations/0003_rapid_galactus.sql", import.meta.url),
      "utf8",
    );
    const shipped = /"devices_role_check" CHECK \((.+?)\);/.exec(sql)?.[1];
    expect(shipped).toBeDefined();
    expect(renderedCheck("devices_role_check")).toBe(shipped!);
  });
});
