import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import { z } from "zod";

// `app_settings` is the one place runtime configuration lives, so these tests
// run against a real drizzle instance on the pg-proxy driver: it builds the real
// SQL and parameters and hands them to the callback below instead of a socket.
// The callback keeps a Map that behaves like the table (primary key on `key`,
// jsonb value), so a write really is readable afterwards and an upsert really
// does replace rather than duplicate — assertions are on behaviour, not on a
// mock's call log.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a factory returning only `db` would delete every other `@SunReye/db` export
// for each test file that runs after this one.
const realDb = await import("@SunReye/db");
// Snapshotted BY VALUE, before the mock below is installed: a module namespace is
// live, so afterwards `realDb.db` IS the proxy and handing `realDb` back would
// restore the stub.
const realDbExports = { ...realDb };

interface Query {
  sql: string;
  params: unknown[];
}

/** Rows currently in `app_settings`, keyed by the primary key. */
const table = new Map<string, { value: unknown; updatedAt: Date }>();
/** Every statement the module under test actually sent, in order. */
const queries: Query[] = [];
/** When set, the next write fails the way a dropped connection would. */
let writeFailure: Error | null = null;

const proxy = drizzle(async (sql: string, params: unknown[]) => {
  queries.push({ sql, params });
  if (sql.startsWith("select")) {
    const row = table.get(String(params[0]));
    return { rows: row ? [[String(params[0]), row.value, row.updatedAt]] : [] };
  }
  if (writeFailure) throw writeFailure;
  // Upsert parameters are [key, inserted value, updated value, updated_at]; the
  // insert path leaves updated_at to the column default.
  const key = String(params[0]);
  table.set(key, {
    value: JSON.parse(String(params[1])),
    updatedAt: table.has(key) ? new Date(String(params[3])) : new Date(),
  });
  return { rows: [] };
});
mock.module("@SunReye/db", () => ({ ...realDb, db: proxy }));

// The mock is permanent and keyed by the resolved specifier, so the pg-proxy
// handle above would stand in for the real `db` in every test file that loads
// after this one — including the suites that talk to the database for real.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

const { cachedSetting, readSetting, writeSetting } = await import("./app-settings");

const selects = () => queries.filter((q) => q.sql.startsWith("select"));
const writes = () => queries.filter((q) => q.sql.startsWith("insert"));

/** Put a row in the table the way an earlier release would have written it. */
const seed = (key: string, value: unknown) =>
  table.set(key, { value, updatedAt: new Date("2026-01-01T00:00:00Z") });

const pricingSchema = z.object({
  currency: z.string().default("EUR"),
  pricePerKwh: z.number().default(0),
});
type Pricing = z.infer<typeof pricingSchema>;
const neutralPricing: Pricing = { currency: "EUR", pricePerKwh: 0 };

beforeEach(() => {
  table.clear();
  queries.length = 0;
  writeFailure = null;
});

describe("readSetting — nothing saved yet", () => {
  test("hands back the default when the key has never been written", async () => {
    const value = await readSetting("pricing", pricingSchema, neutralPricing);
    expect(value).toBe(neutralPricing);
  });

  test("looks the key up by primary key, as one bound parameter", async () => {
    await readSetting("pricing", pricingSchema, neutralPricing);
    const [query] = selects();
    expect(query?.sql).toContain('from "app_settings"');
    expect(query?.params[0]).toBe("pricing");
    expect(query?.params[1]).toBe(1);
  });

  test("a key that looks like SQL is still only a parameter", async () => {
    const key = "'; drop table app_settings; --";
    await readSetting(key, pricingSchema, neutralPricing);
    const [query] = selects();
    expect(query?.sql).not.toContain("drop table");
    expect(query?.params[0]).toBe(key);
  });
});

describe("readSetting — a saved value", () => {
  test("returns what was stored, filling in fields the schema defaults", async () => {
    seed("pricing", { pricePerKwh: 0.32 });
    expect(await readSetting("pricing", pricingSchema, neutralPricing)).toEqual({
      currency: "EUR",
      pricePerKwh: 0.32,
    });
  });

  test("a stored 0 is a price, not a missing setting", async () => {
    seed("price", 0);
    expect(await readSetting("price", z.number(), 0.42)).toBe(0);
  });

  test("a stored negative number is a price too — rebates and negative spot hours exist", async () => {
    seed("price", -0.05);
    expect(await readSetting("price", z.number(), 0.42)).toBe(-0.05);
  });

  test("a stored false is a decision, not an absent one", async () => {
    seed("flag", false);
    expect(await readSetting("flag", z.boolean(), true)).toBe(false);
  });

  test("an empty list is a saved emptiness, not the default list", async () => {
    const fallback = [{ name: "night" }];
    seed("bands", []);
    expect(await readSetting("bands", z.array(z.object({ name: z.string() })), fallback)).toEqual(
      [],
    );
  });
});

describe("readSetting — a saved value the schema no longer accepts", () => {
  // The silent reset this pins is the trap of the whole settings layer: the row
  // is parsed with `safeParse` and a failure is indistinguishable, to the
  // caller, from "never configured". A schema change that rejects rows an older
  // release wrote therefore reverts users to defaults with no log line.
  test("resets to the default without throwing or logging", async () => {
    seed("pricing", { currency: "EUR", pricePerKwh: "0.32" }); // was a string once
    expect(await readSetting("pricing", pricingSchema, neutralPricing)).toBe(neutralPricing);
  });

  test("a stored null reads as unset for an object setting", async () => {
    seed("pricing", null);
    expect(await readSetting("pricing", pricingSchema, neutralPricing)).toBe(neutralPricing);
  });

  test("…but null is kept when the schema allows it — validity decides, not emptiness", async () => {
    seed("limit", null);
    expect(await readSetting("limit", z.number().nullable(), 42)).toBeNull();
  });

  test("a value of the wrong shape falls back rather than reaching the caller", async () => {
    seed("price", { amount: 0.32 }); // a price that used to be an object
    expect(await readSetting("price", z.number(), 0.42)).toBe(0.42);
  });

  test("the reset is not written back — the row survives a rejecting read", async () => {
    seed("pricing", { currency: "EUR", pricePerKwh: "0.32" });
    await readSetting("pricing", pricingSchema, neutralPricing);
    expect(writes()).toHaveLength(0);
    // A later release that accepts the old shape again gets the value back.
    const lenient = z.object({ currency: z.string(), pricePerKwh: z.coerce.number() });
    expect(await readSetting("pricing", lenient, { currency: "EUR", pricePerKwh: 0 })).toEqual({
      currency: "EUR",
      pricePerKwh: 0.32,
    });
  });
});

describe("writeSetting", () => {
  test("creates the row for a key that has never been written", async () => {
    await writeSetting("pricing", { currency: "EUR", pricePerKwh: 0.32 });
    expect(await readSetting("pricing", pricingSchema, neutralPricing)).toEqual({
      currency: "EUR",
      pricePerKwh: 0.32,
    });
  });

  test("writing the same key again replaces the row instead of adding one", async () => {
    await writeSetting("pricing", { currency: "EUR", pricePerKwh: 0.32 });
    await writeSetting("pricing", { currency: "EUR", pricePerKwh: 0.41 });
    expect(table.size).toBe(1);
    expect(await readSetting("pricing", pricingSchema, neutralPricing)).toEqual({
      currency: "EUR",
      pricePerKwh: 0.41,
    });
    expect(writes()[1]?.sql).toContain("on conflict");
  });

  test("stamps updatedAt on the replacing write, so a save is dateable", async () => {
    await writeSetting("pricing", neutralPricing);
    const before = Date.now();
    await writeSetting("pricing", { currency: "EUR", pricePerKwh: 0.41 });
    expect(table.get("pricing")?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("key and value travel as bound parameters, never as interpolated SQL", async () => {
    await writeSetting("'; drop table app_settings; --", { note: "');--" });
    const [write] = writes();
    expect(write?.sql).not.toContain("drop table");
    expect(write?.params[0]).toBe("'; drop table app_settings; --");
  });

  test("falsy values are persisted, not skipped", async () => {
    await writeSetting("flag", false);
    await writeSetting("price", 0);
    await writeSetting("note", "");
    expect(await readSetting("flag", z.boolean(), true)).toBe(false);
    expect(await readSetting("price", z.number(), 0.42)).toBe(0);
    expect(await readSetting("note", z.string(), "unset")).toBe("");
  });
});

describe("cachedSetting", () => {
  test("reads the row once and serves every later read from memory", async () => {
    seed("pricing", { pricePerKwh: 0.32 });
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    expect(await setting.get()).toEqual({ currency: "EUR", pricePerKwh: 0.32 });
    expect(await setting.get()).toEqual({ currency: "EUR", pricePerKwh: 0.32 });
    expect(selects()).toHaveLength(1);
  });

  test("a cached false stays cached — it is a value, not an empty cache", async () => {
    seed("flag", false);
    const setting = cachedSetting("flag", z.boolean(), true);
    expect(await setting.get()).toBe(false);
    expect(await setting.get()).toBe(false);
    expect(selects()).toHaveLength(1);
  });

  test("the default is cached too: a row appearing later is not picked up until a write", async () => {
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    expect(await setting.get()).toBe(neutralPricing);
    seed("pricing", { pricePerKwh: 0.32 });
    expect(await setting.get()).toBe(neutralPricing);
    expect(selects()).toHaveLength(1);
  });

  test("a setting whose value is legitimately null is re-read on every access", async () => {
    // `??=` cannot tell a cached null from an empty cache. Harmless (the value
    // is stable), but it means such a setting keeps hitting the database.
    seed("limit", null);
    const setting = cachedSetting("limit", z.number().nullable(), 42);
    expect(await setting.get()).toBeNull();
    expect(await setting.get()).toBeNull();
    expect(selects()).toHaveLength(2);
  });

  test("two concurrent first reads both go to the database and agree", async () => {
    seed("pricing", { pricePerKwh: 0.32 });
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    const [a, b] = await Promise.all([setting.get(), setting.get()]);
    expect(a).toEqual(b);
    expect(selects()).toHaveLength(2);
  });

  test("settings on different keys keep their own value and their own cache", async () => {
    seed("a", { pricePerKwh: 0.1 });
    seed("b", { pricePerKwh: 0.2 });
    const first = cachedSetting("a", pricingSchema, neutralPricing);
    const second = cachedSetting("b", pricingSchema, neutralPricing);
    expect((await first.get()).pricePerKwh).toBe(0.1);
    expect((await second.get()).pricePerKwh).toBe(0.2);
  });

  test("set validates before it writes: a rejected value never reaches the table", async () => {
    seed("pricing", { pricePerKwh: 0.32 });
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    await setting.get();
    await expect(setting.set({ pricePerKwh: "free" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect(await setting.get()).toEqual({ currency: "EUR", pricePerKwh: 0.32 });
  });

  test("set persists the parsed value — defaults filled in, unknown fields dropped", async () => {
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    await setting.set({ pricePerKwh: 0.41, sneaky: true });
    expect(table.get("pricing")?.value).toEqual({ currency: "EUR", pricePerKwh: 0.41 });
  });

  test("set refreshes the cache, so the next read needs no query", async () => {
    seed("pricing", { pricePerKwh: 0.32 });
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    await setting.get();
    const saved = await setting.set({ pricePerKwh: 0.41 });
    expect(saved.pricePerKwh).toBe(0.41);
    queries.length = 0;
    expect((await setting.get()).pricePerKwh).toBe(0.41);
    expect(selects()).toHaveLength(0);
  });

  test("a write that fails leaves nothing cached — the next read comes from the table", async () => {
    // Otherwise a save that never landed would go on being served as the active
    // configuration until the process restarts, and the UI would show a value
    // the database does not have.
    seed("pricing", { pricePerKwh: 0.32 });
    const setting = cachedSetting("pricing", pricingSchema, neutralPricing);
    writeFailure = new Error("connection terminated");
    await expect(setting.set({ pricePerKwh: 0.99 })).rejects.toThrow();
    writeFailure = null;
    expect((await setting.get()).pricePerKwh).toBe(0.32);
  });
});
