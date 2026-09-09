import { describe, expect, test } from "bun:test";
import { getTableName, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { devices, metricKeys } from "@SunReye/db/schema/plants";

import {
  deviceIdOf,
  deviceScope,
  metricIdOf,
  metricIdsOf,
  metricKeyColumn,
  metricKeyJoin,
} from "./identity-sql";

/**
 * The identity boundary is a pure SQL composition, so it is asserted as one:
 * `render` runs the real drizzle dialect, so what is checked is the statement the
 * database would actually receive — including which values are BOUND rather than
 * interpolated, which is the half a source-text grep cannot see.
 *
 * The semantic half (that the ids these expressions resolve are the ids the
 * writer wrote) is proved against a real TimescaleDB in
 * `apps/server/db-tests/history.test.ts`.
 */
const dialect = new PgDialect();
const render = (fragment: ReturnType<typeof deviceIdOf>) => {
  const query = dialect.sqlToQuery(sql`select ${fragment}`);
  return { sql: query.sql.replace(/\s+/g, " ").trim(), params: query.params };
};

describe("deviceIdOf", () => {
  test("resolves the slug first and the profile id only as a fallback", () => {
    const { sql: text } = render(deviceIdOf("deye-1"));
    expect(text.indexOf("slug =")).toBeGreaterThan(-1);
    expect(text.indexOf("profile_id =")).toBeGreaterThan(text.indexOf("slug ="));
    expect(text).toContain("coalesce(");
  });

  test("reads the devices table under the name the declaration gives it", () => {
    expect(render(deviceIdOf("x")).sql).toContain(`from ${getTableName(devices)}`);
  });

  test("binds the source id as a parameter rather than interpolating it", () => {
    // Both arms take the same value; a literal here would be an injection point
    // reachable from `?inverterId=`.
    const { sql: text, params } = render(deviceIdOf("deye-1"));
    expect(params).toEqual(["deye-1", "deye-1"]);
    expect(text).not.toContain("deye-1");
  });

  test("the profile arm resolves ONLY when exactly one device carries the profile", () => {
    // Two inverters on the same profile used to resolve to `min(id)` — an
    // arbitrary device, silently. A profile shared by several devices names none
    // of them; the caller has to use a slug.
    const { sql: text } = render(deviceIdOf("deye-sun"));
    const profileArm = text.slice(text.indexOf("profile_id ="));
    expect(profileArm).toContain("having count(*) = 1");
    // The slug arm is per plant and stays unconditional.
    expect(text.slice(0, text.indexOf("profile_id ="))).not.toContain("having");
  });

  test("aggregates with min(), so a slug repeated across plants cannot raise at runtime", () => {
    // `devices.slug` is unique per PLANT. A bare scalar sub-select would raise
    // "more than one row returned by a subquery" the day a second plant exists —
    // on a query that used to work.
    const { sql: text } = render(deviceIdOf("x"));
    expect(text.match(/min\(id\)/g)).toHaveLength(2);
  });
});

describe("metricIdOf", () => {
  test("resolves a key against metric_keys and binds it", () => {
    const { sql: text, params } = render(metricIdOf("pv.power"));
    expect(text).toContain(`from ${getTableName(metricKeys)} where key =`);
    expect(params).toEqual(["pv.power"]);
  });

  test("is a single scalar sub-select, so it can sit in an `=` predicate", () => {
    expect(render(metricIdOf("pv.power")).sql).toMatch(/^select \(select min\(id\)/);
  });
});

describe("metricIdsOf", () => {
  test("renders an IN list of every key, each bound", () => {
    const { sql: text, params } = render(metricIdsOf(["a.b", "c.d"]));
    expect(text).toContain("key in ($1, $2)");
    expect(params).toEqual(["a.b", "c.d"]);
  });

  test("an EMPTY key set renders `where false`, never the syntax error `in ()`", () => {
    // The boundary that only bites on the one install whose profile maps none of
    // the roles the caller asked for.
    const { sql: text, params } = render(metricIdsOf([]));
    expect(text).toContain("where false");
    expect(text).not.toContain("in ()");
    expect(params).toEqual([]);
  });

  test("a single key is still a set, not an equality", () => {
    expect(render(metricIdsOf(["only.one"])).sql).toContain("key in ($1)");
  });
});

describe("projecting the id back to a name", () => {
  test("joins metric_keys on the id column and names the key `metric`", () => {
    const { sql: text } = render(sql`0 from x ${metricKeyJoin("x")}, ${metricKeyColumn()}`);
    expect(text).toContain(`join ${getTableName(metricKeys)} mk on mk.id = x.metric_id`);
    expect(text).toContain("mk.key as metric");
  });

  test("the join alias is caller-chosen, so a query already using `mk` can pick another", () => {
    const { sql: text } = render(sql`0 ${metricKeyJoin("r", "k")} ${metricKeyColumn("k")}`);
    expect(text).toContain("k on k.id = r.metric_id");
    expect(text).toContain("k.key as metric");
  });
});

describe("deviceScope", () => {
  const members = [
    { id: 3, slug: "a", weight: 1 },
    { id: 7, slug: "b", weight: 1 },
  ];

  test("a slug is the single-device equality, resolved by name", () => {
    const { sql: text, params } = render(deviceScope("inv-1"));
    expect(text).toContain("device_id = coalesce(");
    expect(params).toEqual(["inv-1", "inv-1"]);
  });

  test("a plant is an IN list of bound ids", () => {
    const { sql: text, params } = render(deviceScope({ plant: members }));
    expect(text).toContain("device_id in ($1, $2)");
    expect(params).toEqual([3, 7]);
  });

  test("a plant of no members is `false`, never `in ()`", () => {
    expect(render(deviceScope({ plant: [] })).sql).toContain("select false");
  });

  test("an alias qualifies the column", () => {
    expect(render(deviceScope({ plant: members }, "r")).sql).toContain("r.device_id in");
    expect(render(deviceScope("x", "r")).sql).toContain("r.device_id = coalesce(");
  });
});
