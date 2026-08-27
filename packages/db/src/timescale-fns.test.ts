import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pg-proxy";
import { metricsRaw } from "./schema/metrics";
import { bucketEpoch, interval, last, timeBucket } from "./timescale-fns";

/** Render a fragment the way a real query would, so casts and params are visible. */
function render(fragment: ReturnType<typeof timeBucket>) {
  const db = drizzle(async () => ({ rows: [] }));
  return db
    .select({ x: fragment.as("x") })
    .from(metricsRaw)
    .toSQL();
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

describe("interval", () => {
  test("renders a whole-second width as a literal, never a bound parameter", () => {
    const { sql: text, params } = render(timeBucket(interval(60), metricsRaw.time));
    expect(flat(text)).toContain("make_interval(secs => 60)");
    expect(params).toEqual([]);
  });

  test("rejects a width that is not a positive whole number of seconds", () => {
    // A literal is only safe because it is proven to be an integer first.
    expect(() => interval(1.5)).toThrow();
    expect(() => interval(0)).toThrow();
    expect(() => interval(-1)).toThrow();
    expect(() => interval(Number.NaN)).toThrow();
    expect(() => interval(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe("timeBucket", () => {
  // The bug this wrapper exists to make unrepresentable. Postgres overloads
  // time_bucket on its second argument, so a bound parameter arrives typed
  // `unknown` and the planner rejects the whole statement with
  // `function time_bucket(interval, unknown) is not unique`.
  test("casts a bound instant to timestamptz", () => {
    const { sql: text } = render(timeBucket(interval(1), new Date("2026-08-27T08:00:00Z")));
    expect(flat(text)).toMatch(/time_bucket\(make_interval\(secs => 1\), \$\d+::timestamptz\)/);
  });

  // A column carries its own type, so casting it would be noise — and would
  // change nothing about which overload is chosen.
  test("does not cast a column, which already carries its type", () => {
    const { sql: text } = render(timeBucket(interval(1), metricsRaw.time));
    expect(flat(text)).toContain('time_bucket(make_interval(secs => 1), "time")');
    expect(flat(text)).not.toContain("::timestamptz");
  });

  test("casts a raw SQL instant too, since a fragment carries no type either", () => {
    const { sql: text } = render(timeBucket(interval(1), sql`now()`));
    expect(flat(text)).toContain("::timestamptz");
  });
});

describe("bucketEpoch", () => {
  test("yields epoch seconds as a bigint", () => {
    const { sql: text } = render(bucketEpoch(interval(1), metricsRaw.time));
    expect(flat(text)).toContain("extract(epoch from time_bucket(");
    expect(flat(text)).toContain("::bigint");
  });

  // Postgres renders bigint as TEXT. A bare `sql<number>` would be an unchecked
  // assertion the compiler believes, and arithmetic on it concatenates.
  test("maps the driver's text back to a number", async () => {
    const db = drizzle(async () => ({ rows: [["1787799369"]] }));
    const rows = await db
      .select({ bucket: bucketEpoch(interval(1), metricsRaw.time).as("bucket") })
      .from(metricsRaw);
    expect(rows[0]?.bucket).toBe(1_787_799_369);
    expect(typeof rows[0]?.bucket).toBe("number");
  });

  test("carries the same instant-casting rule as timeBucket", () => {
    const { sql: text } = render(bucketEpoch(interval(5), new Date()));
    expect(flat(text)).toMatch(/\$\d+::timestamptz/);
  });
});

describe("last", () => {
  test("renders the hyperfunction over both columns", () => {
    const { sql: text } = render(last(metricsRaw.value, metricsRaw.time));
    expect(flat(text)).toContain('last("value", "time")');
  });

  // double precision already arrives as a number; the mapper is here so a
  // caller never has to know which Postgres types the driver renders as text.
  test("maps its result to a number whatever the driver sends", async () => {
    const db = drizzle(async () => ({ rows: [["13.5"]] }));
    const rows = await db
      .select({ value: last(metricsRaw.value, metricsRaw.time).as("value") })
      .from(metricsRaw);
    expect(rows[0]?.value).toBe(13.5);
  });
});
