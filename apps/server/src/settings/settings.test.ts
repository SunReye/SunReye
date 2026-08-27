import { TARIFF_KEY, defaultTariff } from "@SunReye/db/tariff";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// The tariff is what turns kWh into money, so these tests run the real accessor
// against a real drizzle instance on the pg-proxy driver: the callback below
// stands in for the `app_settings` table (primary key on `key`, jsonb value) and
// records every statement, so the fallback, the cache and the write are all
// asserted as behaviour rather than as calls into a mock.
//
// The spread is load-bearing: `mock.module` is process-global and permanent, so
// a factory returning only `db` would delete every other `@SunReye/db` export
// for each test file that runs after this one.
const realDb = await import("@SunReye/db");
// Snapshotted BY VALUE, before the mock below is installed: a module namespace is
// live, so afterwards `realDb.db` IS the proxy and handing `realDb` back would
// restore the stub.
const realDbExports = { ...realDb };

const table = new Map<string, unknown>();
const queries: { sql: string; params: unknown[] }[] = [];

const proxy = drizzle(async (sql: string, params: unknown[]) => {
  queries.push({ sql, params });
  if (sql.startsWith("select")) {
    const key = String(params[0]);
    return {
      rows: table.has(key) ? [[key, table.get(key), new Date("2026-01-01T00:00:00Z")]] : [],
    };
  }
  table.set(String(params[0]), JSON.parse(String(params[1])));
  return { rows: [] };
});
mock.module("@SunReye/db", () => ({ ...realDb, db: proxy }));

// The mock is permanent and keyed by the resolved specifier, so the pg-proxy
// handle above would stand in for the real `db` in every test file that loads
// after this one — including the suites that talk to the database for real.
afterAll(() => {
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

const selects = () => queries.filter((q) => q.sql.startsWith("select"));
const writes = () => queries.filter((q) => q.sql.startsWith("insert"));

type Settings = typeof import("./settings");

// The tariff is cached for the lifetime of the process (the cost engine reads it
// per row), so a scenario that needs an unread instance takes a fresh copy of
// the module: the query suffix resolves to a new instance of the same file.
// Loading the plain instance — the one the rest of the server imports — first
// keeps those copies last, which is what the coverage report follows.
await import("./settings");

let instances = 0;
const freshInstance = async () => (await import(`./settings?${++instances}`)) as Settings;

/** A tariff as an installation that predates market pricing wrote it. */
const legacyTariff = {
  currency: "EUR",
  standingChargeMonthly: 12.5,
  import: {
    defaultPricePerKwh: 0.32,
    bands: [{ name: "night", pricePerKwh: 0.22, startHour: 22, endHour: 6 }],
  },
  export: { feedInPerKwh: 0.082 },
};

beforeEach(() => {
  table.clear();
  queries.length = 0;
});

describe("reading the tariff", () => {
  test("before a tariff is configured, energy is priced at nothing at all", async () => {
    const { getTariff } = await freshInstance();
    expect(await getTariff()).toBe(defaultTariff);
    expect(defaultTariff.import.defaultPricePerKwh).toBe(0);
    expect(defaultTariff.export.feedInPerKwh).toBe(0);
  });

  test("a tariff saved before market pricing existed keeps every price it had", async () => {
    // The row on disk has no `import.spot` / `export.spot` at all. It must parse
    // and gain defaults, not fail and take the household's prices down with it.
    table.set(TARIFF_KEY, legacyTariff);
    const { getTariff } = await freshInstance();
    const tariff = await getTariff();
    expect(tariff.import.defaultPricePerKwh).toBe(0.32);
    expect(tariff.import.bands[0]?.name).toBe("night");
    expect(tariff.export.feedInPerKwh).toBe(0.082);
    expect(tariff.standingChargeMonthly).toBe(12.5);
    expect(tariff.import.mode).toBe("static");
    expect(tariff.export.spot.marketingModel).toBe("none");
  });

  test("a stored tariff the schema rejects silently reprices the household at zero", async () => {
    // `readSetting` cannot tell "never configured" from "no longer parses", so a
    // schema tightening — or a hand-edited row like this negative feed-in rate —
    // makes every cost and every revenue figure read 0 with nothing logged.
    table.set(TARIFF_KEY, { ...legacyTariff, export: { feedInPerKwh: -0.08 } });
    const { getTariff } = await freshInstance();
    expect(await getTariff()).toBe(defaultTariff);
    expect(table.get(TARIFF_KEY)).toBeDefined(); // the row itself is left intact
  });

  test("negative prices survive the round trip — rebates and negative spot hours are real", async () => {
    table.set(TARIFF_KEY, {
      currency: "EUR",
      import: {
        mode: "spot",
        defaultPricePerKwh: -0.05,
        bands: [{ name: "rebate", pricePerKwh: -0.02, startHour: 11, endHour: 15 }],
        spot: { supplierMarkupPerKwh: -0.01, vatPercent: 19 },
      },
    });
    const { getTariff } = await freshInstance();
    const tariff = await getTariff();
    expect(tariff.import.defaultPricePerKwh).toBe(-0.05);
    expect(tariff.import.bands[0]?.pricePerKwh).toBe(-0.02);
    expect(tariff.import.spot.supplierMarkupPerKwh).toBe(-0.01);
  });

  test("the tariff is read once and then served from memory, not per priced row", async () => {
    table.set(TARIFF_KEY, legacyTariff);
    const { getTariff } = await freshInstance();
    await getTariff();
    await getTariff();
    await getTariff();
    expect(selects()).toHaveLength(1);
  });
});

describe("saving the tariff", () => {
  test("a tariff the schema rejects never reaches the table and leaves the active one alone", async () => {
    table.set(TARIFF_KEY, legacyTariff);
    const { getTariff, setTariff } = await freshInstance();
    await getTariff();
    // A band restricted to no days at all would price nothing.
    await expect(
      setTariff({
        ...legacyTariff,
        import: {
          defaultPricePerKwh: 0.4,
          bands: [{ name: "never", pricePerKwh: 1, startHour: 0, endHour: 24, days: [] }],
        },
      }),
    ).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect((await getTariff()).import.defaultPricePerKwh).toBe(0.32);
  });

  test("an unparseable currency is refused rather than stored", async () => {
    const { setTariff } = await freshInstance();
    await expect(setTariff({ ...legacyTariff, currency: "EURO" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
  });

  test("the saved row is the complete parsed tariff, market-pricing defaults included", async () => {
    const { setTariff } = await freshInstance();
    await setTariff(legacyTariff);
    expect(table.get(TARIFF_KEY)).toEqual({
      currency: "EUR",
      standingChargeMonthly: 12.5,
      import: {
        mode: "static",
        defaultPricePerKwh: 0.32,
        bands: [{ name: "night", pricePerKwh: 0.22, startHour: 22, endHour: 6 }],
        spot: {
          supplierMarkupPerKwh: 0,
          gridFeesPerKwh: 0,
          leviesPerKwh: 0,
          vatPercent: 0,
          clampToZero: false,
        },
      },
      export: {
        mode: "static",
        feedInPerKwh: 0.082,
        spot: { marketingModel: "none", managementFeePerKwh: 0 },
      },
    });
  });

  test("zero is a price a household can be on — it is stored, not read as unset", async () => {
    const { getTariff, setTariff } = await freshInstance();
    await setTariff({
      currency: "EUR",
      standingChargeMonthly: 0,
      import: { defaultPricePerKwh: 0 },
      export: { feedInPerKwh: 0 },
    });
    expect(table.get(TARIFF_KEY)).toMatchObject({ standingChargeMonthly: 0 });
    expect((await getTariff()).import.defaultPricePerKwh).toBe(0);
  });

  test("a band that wraps midnight is a valid night rate", async () => {
    const { setTariff } = await freshInstance();
    const saved = await setTariff({
      ...legacyTariff,
      import: {
        defaultPricePerKwh: 0.32,
        bands: [{ name: "night", pricePerKwh: 0.18, startHour: 22, endHour: 6, days: [1, 2, 3] }],
      },
    });
    expect(saved.import.bands[0]?.days).toEqual([1, 2, 3]);
  });

  // Deliberately the last test in the file: bun attributes a file's coverage to
  // the last instance of it loaded in the process, so the final instance loaded
  // here is the one that has to exercise the whole module.
  test("a saved tariff becomes the active one immediately, without a second read", async () => {
    const { getTariff, setTariff } = await freshInstance();
    expect(await getTariff()).toBe(defaultTariff);

    const saved = await setTariff({
      ...legacyTariff,
      export: { mode: "spot", feedInPerKwh: 0.082, spot: { marketingModel: "eegFeedIn" } },
    });
    expect(saved.export.spot.marketingModel).toBe("eegFeedIn");
    expect(writes().at(-1)?.params[0]).toBe(TARIFF_KEY);

    queries.length = 0;
    expect((await getTariff()).export.spot.marketingModel).toBe("eegFeedIn");
    expect(selects()).toHaveLength(0); // served from the cache the save refreshed
  });
});
