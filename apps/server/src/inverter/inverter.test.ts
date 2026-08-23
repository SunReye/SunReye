import type { InverterConfig } from "@SunReye/db/inverter-config";
import {
  defineProfile,
  hydrateProfile,
  metric,
  registerProfile,
  tryGetProfile,
  unregisterProfile,
  type ProfileData,
} from "@SunReye/inverter-core";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

// initProfiles reads the active-profile id from app_settings and the installed
// profiles from the DB. Mock both so we can drive the boot path without a DB.
//
// The spreads are load-bearing, not tidiness: `mock.module` is process-global
// and permanent, so a mock returning only the exports THIS suite needs deletes
// the rest for every test file that runs afterwards. One that omitted a single
// export broke a later file's import chain outright ("Export named ... not
// found"), which took that file's own mocks down with it and failed four
// unrelated tests. Override what the suite stubs; keep everything else real.
const realAppSettings = await import("../settings/app-settings");
const realProfiles = await import("./profiles");
const realDb = await import("@SunReye/db");

// A module namespace is LIVE: once a stub below is installed, reading
// `realAppSettings.readSetting` yields the stub, so the namespace cannot be used
// to undo the mock (`() => realAppSettings` would reinstall it). Snapshot the
// real exports by value here, before any mock is registered, and hand those back
// in `afterAll` — app-settings and profiles both have their own unit suites, and
// they would otherwise assert against these doubles in the full run.
const realAppSettingsExports = { ...realAppSettings };
const realProfilesExports = { ...realProfiles };
const realDbExports = { ...realDb };

let activeId = "";
mock.module("../settings/app-settings", () => ({
  ...realAppSettings,
  readSetting: async () => ({ id: activeId }),
}));
mock.module("./profiles", () => ({
  ...realProfiles,
  dropLegacyDefaultSource: async () => {},
}));
/** The `installed_profiles` rows this process would read at boot. */
interface InstalledRow {
  id: string;
  data: unknown;
}
let installedRows: InstalledRow[] = [];
/** Reads of `installed_profiles` — so "did this reach the database?" is assertable. */
let selects = 0;

const TABLE_NAME = Symbol.for("drizzle:Name");
const tableOf = (table: unknown): string | undefined =>
  (table as Record<symbol, string | undefined>)[TABLE_NAME];

/** The bound value of a single-column drizzle `eq(column, value)` condition. */
function eqValue(condition: unknown): string | undefined {
  const chunks = (condition as { queryChunks?: { value?: unknown }[] }).queryChunks ?? [];
  for (const chunk of chunks) if (typeof chunk.value === "string") return chunk.value;
  return undefined;
}

/**
 * `loadInstalledProfiles` awaits `db.select().from(t)` while `resolveProfileById`
 * awaits `db.select().from(t).where(eq(id))`, so `from()` has to be both a
 * promise and a query builder.
 */
const fakeDb = {
  select: () => ({
    from: (table: unknown) => {
      selects++;
      const rows = tableOf(table) === "installed_profiles" ? installedRows : [];
      const query = Promise.resolve(rows) as Promise<InstalledRow[]> & {
        where(condition: unknown): Promise<InstalledRow[]>;
      };
      query.where = (condition) => Promise.resolve(rows.filter((r) => r.id === eqValue(condition)));
      return query;
    },
  }),
};

mock.module("@SunReye/db", () => ({ ...realDb, db: fakeDb }));

// `mock.module` is permanent and keyed by the resolved path, so without this the
// stubs above stay installed for the rest of the process — including for
// `../settings/app-settings`'s own suite and `./profiles`'s own suite, which
// would then test these doubles instead of the real modules (green alone, red or
// silently vacuous in the full run). Root-scope `afterAll`, so it runs after
// every describe in this file — including the one below that reboots
// `initProfiles` through the fake database.
afterAll(() => {
  mock.module("../settings/app-settings", () => ({ ...realAppSettingsExports }));
  mock.module("./profiles", () => ({ ...realProfilesExports }));
  mock.module("@SunReye/db", () => ({ ...realDbExports }));
});

const { buildProfileContext, buildSource, initProfiles, resolveProfileById } =
  await import("./inverter");

const profile: ProfileData = {
  schemaVersion: 1,
  id: "installed-one",
  name: "Installed",
  manufacturer: "Test",
  version: "1.0.0",
  metrics: [
    {
      key: "battery.soc",
      topic: "battery/soc",
      label: "SOC",
      unit: "%",
      group: "battery",
      type: "U_WORD",
      addresses: [1],
      scale: 1,
      access: "r",
      role: "battery.soc",
    },
  ],
};

/** The same profile with a different id, so a row can be a *second* install. */
const profileAs = (id: string): ProfileData => ({ ...profile, id });

beforeEach(() => {
  activeId = "";
  installedRows = [];
  selects = 0;
});

describe("initProfiles", () => {
  // `activeProfile` is module state in ./inverter and outlives this file, so a
  // suite that runs later and expects "nothing is active" (onboarding's
  // testInverter) would otherwise pass or fail purely on the order the runner
  // walked the files in. Leave the module as we found it. The registry is
  // process-wide too, so anything this file installs is removed again.
  afterAll(async () => {
    activeId = "";
    installedRows = [];
    for (const id of ["installed-one", "installed-two", "installed-three", "fresh-install"]) {
      unregisterProfile(id);
    }
    await initProfiles();
  });

  test("boots onboarding-only (null) when the saved id is no longer installed", async () => {
    // Regression: an upgrade that dropped a formerly built-in package leaves a
    // stale active-profile id in app_settings. Boot must degrade, not crash.
    activeId = "gone-with-the-upgrade";
    await expect(initProfiles()).resolves.toBeNull();
  });

  test("resolves the active profile when it is registered", async () => {
    registerProfile(hydrateProfile(profile));
    activeId = "installed-one";
    const result = await initProfiles();
    expect(result?.id).toBe("installed-one");
  });

  test("boots onboarding-only (null) when nothing has been chosen yet", async () => {
    // A fresh install: no saved id, no INVERTER_PROFILE seed. The server must
    // come up so the admin can pick a profile in the UI.
    await expect(initProfiles()).resolves.toBeNull();
  });

  test("registers a DB-installed profile so it can become the active one", async () => {
    // Nothing ships in the box; a downloaded profile only becomes usable
    // because boot loads it out of `installed_profiles` into the registry.
    installedRows = [{ id: "installed-two", data: profileAs("installed-two") }];
    activeId = "installed-two";

    const result = await initProfiles();

    expect(result?.id).toBe("installed-two");
    expect(tryGetProfile("installed-two")?.name).toBe("Installed");
  });

  test("skips an installed profile whose stored data no longer validates", async () => {
    // One bad download — or a row written before a schema change — may never
    // take the whole server down with it.
    installedRows = [
      { id: "corrupt", data: { schemaVersion: 1, id: "corrupt", metrics: "not-an-array" } },
      { id: "installed-three", data: profileAs("installed-three") },
    ];
    activeId = "installed-three";

    const result = await initProfiles();

    expect(result?.id).toBe("installed-three");
    expect(tryGetProfile("corrupt")).toBeUndefined();
  });
});

describe("resolveProfileById", () => {
  test("hydrates a freshly installed profile this boot has not registered yet", async () => {
    // Onboarding test-reads a profile the moment it is downloaded, before the
    // restart that would register it.
    installedRows = [{ id: "fresh-install", data: profileAs("fresh-install") }];

    const resolved = await resolveProfileById("fresh-install");

    expect(resolved?.id).toBe("fresh-install");
    expect(resolved?.metrics.map((m) => m.key)).toEqual(["battery.soc"]);
    // Resolving must not register it — that stays a boot concern.
    expect(tryGetProfile("fresh-install")).toBeUndefined();
  });

  test("prefers the registered profile and never touches the database", async () => {
    registerProfile(hydrateProfile(profile));

    const resolved = await resolveProfileById("installed-one");

    expect(resolved?.id).toBe("installed-one");
    expect(selects).toBe(0);
  });

  test("reports null for an id that is neither registered nor installed", async () => {
    await expect(resolveProfileById("never-heard-of-it")).resolves.toBeNull();
  });

  test("surfaces the validation error for an installed row that is corrupt", async () => {
    // Silently reporting "unknown profile" would send the admin hunting for a
    // missing install instead of a broken one.
    installedRows = [{ id: "corrupt", data: { schemaVersion: 1, id: "corrupt" } }];

    await expect(resolveProfileById("corrupt")).rejects.toThrow();
  });
});

describe("buildSource", () => {
  const config = (over: Partial<InverterConfig> = {}): InverterConfig => ({
    host: "10.0.0.5",
    port: 502,
    transport: "tcp",
    unitId: 1,
    timeoutMs: 2000,
    pollIntervalMs: 1000,
    ...over,
  });

  /**
   * The connection the source was actually constructed with. It lives on the
   * source's `DeviceTransport` — the connection details are Modbus's business,
   * not the profile wrapper's.
   */
  const connectionOf = (source: unknown) =>
    (source as { transport?: { conn?: Record<string, unknown> } }).transport?.conn ?? {};

  test("binds the source to the profile and the saved connection", () => {
    const hydrated = hydrateProfile(profile);

    const source = buildSource(hydrated, config());

    expect(source.profile).toBe(hydrated);
    expect(connectionOf(source)).toMatchObject({
      host: "10.0.0.5",
      port: 502,
      unitId: 1,
      timeoutMs: 2000,
      transport: "tcp",
    });
  });

  test("an unconfigured inverter yields an empty host rather than undefined", () => {
    // Onboarding builds a source before a host is saved; the connect then fails
    // in the poll loop, which is handled — an undefined host would not be.
    const source = buildSource(hydrateProfile(profile), config({ host: undefined }));

    expect(connectionOf(source).host).toBe("");
  });

  test("carries the RTU-over-TCP framing through, not just the default", () => {
    // RS485→Ethernet gateways need it; dropping it yields silent frame errors.
    const source = buildSource(
      hydrateProfile(profile),
      config({ transport: "rtu-over-tcp", unitId: 0, port: 8899 }),
    );

    expect(connectionOf(source)).toMatchObject({
      transport: "rtu-over-tcp",
      unitId: 0,
      port: 8899,
    });
  });

  test("each call yields its own source, so a reconnect never shares a socket", () => {
    const hydrated = hydrateProfile(profile);

    expect(buildSource(hydrated, config())).not.toBe(buildSource(hydrated, config()));
  });

  /**
   * The id the built source will stamp its samples with. Reached through the
   * private field for the same reason `connectionOf` is: the observable proof
   * is a sample, and taking one means dialling a real socket.
   */
  const deviceIdOf = (source: unknown) => (source as { deviceId?: string }).deviceId;

  test("the device id reaches the source, through the real construction chain", () => {
    // buildSource → createInverter → ModbusInverter, not a recorded argument.
    // Two inverters of one model differ only here, and `inverter_id` is the key
    // every reading is stored under.
    expect(deviceIdOf(buildSource(hydrateProfile(profile), config(), "barn"))).toBe("barn");
  });

  test("without one, the source stamps the profile id — every install today", () => {
    expect(deviceIdOf(buildSource(hydrateProfile(profile), config()))).toBe(profile.id);
  });
});

describe("validateWrite", () => {
  const controls = hydrateProfile(
    defineProfile({
      id: "context-test",
      name: "Context Test",
      manufacturer: "Test",
      version: "1.0.0",
      metrics: [
        metric("battery/soc", {
          label: "SOC",
          unit: "%",
          group: "battery",
          addr: 1,
          role: "battery.soc",
        }),
        metric("setting/max_charge_current", {
          label: "Max charge current",
          unit: "A",
          group: "setting",
          addr: 2,
          access: "rw",
          range: { min: 0, max: 100 },
        }),
        metric("setting/export_limit", {
          label: "Export limit",
          unit: "W",
          group: "setting",
          addr: 3,
          type: "S_WORD",
          access: "rw",
          range: { min: -5000, max: 5000 },
        }),
        metric("setting/work_mode", {
          label: "Work mode",
          unit: null,
          group: "setting",
          addr: 4,
          access: "rw",
          enumLabels: { 0: "Selling first", 1: "Zero export", 2: "Limited to load" },
        }),
        metric("setting/timer", {
          label: "Timer",
          unit: null,
          group: "setting",
          addr: 5,
          access: "rw",
        }),
        metric("setting/raw_block", {
          label: "Raw block",
          unit: null,
          group: "setting",
          addr: [6, 7],
          type: "RAW",
          access: "rw",
        }),
      ],
    }),
  );
  const ctx = buildProfileContext(controls);

  test("rejects a key the profile does not describe", () => {
    expect(ctx.validateWrite("setting.not_a_register", 1)).toBe(
      "Unknown entity: setting.not_a_register",
    );
  });

  test("rejects a write to a read-only measurement", () => {
    expect(ctx.validateWrite("battery.soc", 50)).toBe("Entity is not writable: battery.soc");
  });

  test("rejects a write to a raw register block, which has no numeric meaning", () => {
    expect(ctx.validateWrite("setting.raw_block", 1)).toBe(
      "Entity is not writable: setting.raw_block",
    );
  });

  test("accepts an enum value the profile lists, including zero", () => {
    // 0 is "Selling first", a real mode — never "no value".
    expect(ctx.validateWrite("setting.work_mode", 0)).toBeNull();
    expect(ctx.validateWrite("setting.work_mode", 2)).toBeNull();
  });

  test("rejects an enum value the profile does not list, naming the ones it does", () => {
    expect(ctx.validateWrite("setting.work_mode", 3)).toBe("Value must be one of: 0, 1, 2");
    expect(ctx.validateWrite("setting.work_mode", -1)).toBe("Value must be one of: 0, 1, 2");
  });

  test("an enum ignores range talk entirely — a value between the labels is still invalid", () => {
    expect(ctx.validateWrite("setting.work_mode", 1.5)).toBe("Value must be one of: 0, 1, 2");
  });

  test("accepts the bounds themselves — the range is inclusive", () => {
    expect(ctx.validateWrite("setting.max_charge_current", 0)).toBeNull();
    expect(ctx.validateWrite("setting.max_charge_current", 100)).toBeNull();
  });

  test("rejects a value below the minimum, naming the bound", () => {
    expect(ctx.validateWrite("setting.max_charge_current", -1)).toBe("Value -1 is below minimum 0");
  });

  test("rejects a value above the maximum, naming the bound", () => {
    expect(ctx.validateWrite("setting.max_charge_current", 101)).toBe(
      "Value 101 is above maximum 100",
    );
  });

  test("accepts a negative setpoint when the profile allows one", () => {
    // Export/discharge limits are signed; a blanket "must be positive" would
    // break them.
    expect(ctx.validateWrite("setting.export_limit", -5000)).toBeNull();
    expect(ctx.validateWrite("setting.export_limit", 0)).toBeNull();
    expect(ctx.validateWrite("setting.export_limit", -5001)).toBe(
      "Value -5001 is below minimum -5000",
    );
  });

  test("accepts anything numeric when the profile declares no range", () => {
    expect(ctx.validateWrite("setting.timer", 0)).toBeNull();
    expect(ctx.validateWrite("setting.timer", -9999)).toBeNull();
    expect(ctx.validateWrite("setting.timer", 65535)).toBeNull();
  });
});

describe("buildProfileContext", () => {
  test("indexes the profile's metrics by key for the transports to look up", () => {
    const hydrated = hydrateProfile(profile);

    const ctx = buildProfileContext(hydrated);

    expect(ctx.profile).toBe(hydrated);
    expect(ctx.manifest.id).toBe("installed-one");
    expect(ctx.defByKey.get("battery.soc")?.topic).toBe("battery/soc");
    expect(ctx.metaByKey.get("battery.soc")?.unit).toBe("%");
    // Against the profile's own keys, not against `manifest.metrics` — the map
    // is built from that list, so comparing the two would restate the
    // construction and hold whatever the index was keyed by.
    expect([...ctx.defByKey.keys()]).toEqual(["battery.soc"]);
    expect([...ctx.metaByKey.keys()]).toEqual(["battery.soc"]);
  });
});
