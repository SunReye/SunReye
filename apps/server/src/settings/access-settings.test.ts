import { ACCESS_KEY } from "@SunReye/db/access";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";

// Who may look at the dashboard without logging in is decided by one row in
// `app_settings`, so these tests run the real accessor against a real drizzle
// instance on the pg-proxy driver: the callback below stands in for the table
// (primary key on `key`, jsonb value) and records every statement, so the read
// fallback, the cache and the write are all asserted as behaviour.
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

type AccessSettings = typeof import("./access-settings");

// The preference is cached for the lifetime of the process, so a scenario that
// needs an unread instance takes a fresh copy of the module: the query suffix
// resolves to a new instance of the same file. Loading the plain instance — the
// one the routes and the guard import — first keeps those copies last, which is
// what the coverage report follows.
await import("./access-settings");

let instances = 0;
const freshInstance = async () =>
  (await import(`./access-settings?${++instances}`)) as AccessSettings;

beforeEach(() => {
  table.clear();
  queries.length = 0;
});

describe("reading the public dashboard preference", () => {
  test("a fresh install is private — anonymous reads are off until someone opts in", async () => {
    const { getAccess, isPublicDashboard } = await freshInstance();
    expect(await getAccess()).toEqual({ publicDashboard: false });
    expect(await isPublicDashboard()).toBe(false);
  });

  test("a row written before the flag existed leaves the dashboard private", async () => {
    table.set(ACCESS_KEY, {});
    const { isPublicDashboard } = await freshInstance();
    expect(await isPublicDashboard()).toBe(false);
  });

  test("reports the saved preference once it has been turned on", async () => {
    table.set(ACCESS_KEY, { publicDashboard: true });
    const { isPublicDashboard } = await freshInstance();
    expect(await isPublicDashboard()).toBe(true);
  });

  test("a stored preference the schema rejects fails closed — the dashboard stays private", async () => {
    // The read falls back silently, so a row an older build or a hand edit left
    // behind must never be able to open an instance up by accident.
    table.set(ACCESS_KEY, { publicDashboard: "yes" });
    const { isPublicDashboard } = await freshInstance();
    expect(await isPublicDashboard()).toBe(false);
  });

  test("the preference is read once, not once per anonymous request", async () => {
    table.set(ACCESS_KEY, { publicDashboard: true });
    const { isPublicDashboard } = await freshInstance();
    await isPublicDashboard();
    await isPublicDashboard();
    await isPublicDashboard();
    expect(selects()).toHaveLength(1);
  });

  test("the exported readers work detached from the accessor they came from", async () => {
    // `getAccess`/`setAccess` are exported as bare references, so the routes and
    // the guard hold them without a receiver; nothing in them may rely on `this`.
    const { getAccess } = await freshInstance();
    const detached = getAccess;
    expect(await detached()).toEqual({ publicDashboard: false });
  });
});

describe("changing the public dashboard preference", () => {
  test("a preference that is not a boolean is rejected and the instance stays as it was", async () => {
    table.set(ACCESS_KEY, { publicDashboard: true });
    const { isPublicDashboard, setAccess } = await freshInstance();
    await expect(setAccess({ publicDashboard: "true" })).rejects.toThrow();
    expect(writes()).toHaveLength(0);
    expect(await isPublicDashboard()).toBe(true);
  });

  test("saving stores only the known flag, whatever else the request carried", async () => {
    const { setAccess } = await freshInstance();
    await setAccess({ publicDashboard: true, adminBypass: true });
    expect(table.get(ACCESS_KEY)).toEqual({ publicDashboard: true });
  });

  test("locking it down again is a save, not the absence of one", async () => {
    table.set(ACCESS_KEY, { publicDashboard: true });
    const { isPublicDashboard, setAccess } = await freshInstance();
    expect(await isPublicDashboard()).toBe(true);
    await setAccess({ publicDashboard: false });
    expect(table.get(ACCESS_KEY)).toEqual({ publicDashboard: false });
    expect(await isPublicDashboard()).toBe(false);
  });

  // Deliberately the last test in the file: bun attributes a file's coverage to
  // the last instance of it loaded in the process, so the final instance loaded
  // here is the one that has to exercise the whole module.
  test("opening the dashboard is persisted under the access key and takes effect at once", async () => {
    const { getAccess, isPublicDashboard, setAccess } = await freshInstance();
    expect(await isPublicDashboard()).toBe(false);

    expect(await setAccess({ publicDashboard: true })).toEqual({ publicDashboard: true });
    expect(table.get(ACCESS_KEY)).toEqual({ publicDashboard: true });
    expect(writes().at(-1)?.params[0]).toBe(ACCESS_KEY);

    queries.length = 0;
    expect(await getAccess()).toEqual({ publicDashboard: true });
    expect(await isPublicDashboard()).toBe(true);
    expect(selects()).toHaveLength(0); // served from the cache the save refreshed
  });
});
