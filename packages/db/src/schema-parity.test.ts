import { describe, expect, test } from "bun:test";
import { doublePrecision, pgMaterializedView, text, timestamp } from "drizzle-orm/pg-core";
import { declaredColumns, diffColumns } from "./schema-parity";
import { metricsRaw } from "./schema/metrics";

const view = pgMaterializedView("hourly_rollups", {
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  inverterId: text("inverter_id").notNull(),
  avgValue: doublePrecision("avg_value"),
}).existing();

describe("declaredColumns", () => {
  test("reads a table's columns as Postgres names and types", () => {
    // Declaration ORDER, which is the physical column order: the two 8-byte
    // fields, the 4-byte, then the two 2-byte, so the row packs without padding
    // (48 B against 56 B for the worst order — see ./schema/metrics.ts).
    expect(declaredColumns(metricsRaw)).toEqual([
      { name: "time", dataType: "timestamp with time zone" },
      { name: "value", dataType: "double precision" },
      { name: "dur_ms", dataType: "integer" },
      { name: "device_id", dataType: "smallint" },
      { name: "metric_id", dataType: "smallint" },
    ]);
  });

  // A view keeps its columns behind a symbol rather than as own properties, so
  // the accessor differs from a table's — the whole point of this helper.
  test("reads a declared view's columns the same way", () => {
    expect(declaredColumns(view)).toEqual([
      { name: "bucket", dataType: "timestamp with time zone" },
      { name: "inverter_id", dataType: "text" },
      { name: "avg_value", dataType: "double precision" },
    ]);
  });
});

describe("diffColumns", () => {
  const declared = [
    { name: "bucket", dataType: "timestamp with time zone" },
    { name: "avg_value", dataType: "double precision" },
  ];

  test("no mismatches when the database agrees", () => {
    expect(diffColumns("hourly_rollups", declared, declared)).toEqual([]);
  });

  // Column ORDER is not part of the contract: a `select` names its columns, and
  // a continuous aggregate's ordinal positions are an implementation detail.
  test("ignores column order", () => {
    expect(diffColumns("hourly_rollups", declared, [...declared].reverse())).toEqual([]);
  });

  test("reports a column the declaration claims but the database lacks", () => {
    const actual = [{ name: "bucket", dataType: "timestamp with time zone" }];
    const problems = diffColumns("hourly_rollups", declared, actual);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("avg_value");
    expect(problems[0]).toContain("hourly_rollups");
  });

  // The dangerous direction: reads keep working, so nothing fails — while the
  // declaration silently stops describing the relation.
  test("reports a column the database has that the declaration omits", () => {
    const actual = [...declared, { name: "weight", dataType: "double precision" }];
    const problems = diffColumns("hourly_rollups", declared, actual);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("weight");
  });

  test("reports a type that drifted", () => {
    const actual = [
      { name: "bucket", dataType: "timestamp without time zone" },
      { name: "avg_value", dataType: "double precision" },
    ];
    const problems = diffColumns("hourly_rollups", declared, actual);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("bucket");
    expect(problems[0]).toContain("timestamp without time zone");
  });

  // A relation the declaration describes but that does not exist at all is the
  // loudest possible drift and must not read as "no mismatches".
  test("reports an absent relation rather than passing vacuously", () => {
    const problems = diffColumns("hourly_rollups", declared, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("does not exist");
  });

  test("collects every mismatch rather than stopping at the first", () => {
    const actual = [
      { name: "bucket", dataType: "date" },
      { name: "extra", dataType: "text" },
    ];
    expect(diffColumns("hourly_rollups", declared, actual)).toHaveLength(3);
  });
});
