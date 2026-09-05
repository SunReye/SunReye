import { describe, expect, test } from "bun:test";
import type { PlantDb } from "@SunReye/db/plant-repo";
import {
  type AnnouncedEntity,
  LEGACY_RETIREMENT_KEY,
  type LegacyRetirementState,
  type LegacyRetirementStore,
  type SettingsIo,
  dbLegacyRetirementStore,
  legacyDiscoveryTopics,
  retireLegacyEntities,
} from "./mqtt-legacy-retire";

const announced: AnnouncedEntity[] = [
  { component: "sensor", objectId: "pv_power" },
  { component: "number", objectId: "setting_charge_current" },
];

describe("legacyDiscoveryTopics", () => {
  test("one topic per (component, object) per legacy profile, in the legacy shape", () => {
    expect(
      legacyDiscoveryTopics({
        discoveryPrefix: "homeassistant",
        profileIds: ["deye-sg05lp3"],
        announced,
        keep: new Set(),
      }),
    ).toEqual([
      "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config",
      "homeassistant/number/sunreye_deye-sg05lp3/setting_charge_current/config",
    ]);
  });

  test("a custom discovery prefix moves the whole sweep with it", () => {
    const topics = legacyDiscoveryTopics({
      discoveryPrefix: "ha",
      profileIds: ["deye"],
      announced: [announced[0] as AnnouncedEntity],
      keep: new Set(),
    });
    expect(topics).toEqual(["ha/sensor/sunreye_deye/pv_power/config"]);
  });

  test("every profile this install has ever named gets its own sweep", () => {
    const topics = legacyDiscoveryTopics({
      discoveryPrefix: "homeassistant",
      profileIds: ["deye-sg05lp3", "sofar-hyd-6000"],
      announced: [announced[0] as AnnouncedEntity],
      keep: new Set(),
    });
    expect(topics).toEqual([
      "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config",
      "homeassistant/sensor/sunreye_sofar-hyd-6000/pv_power/config",
    ]);
  });

  test("a repeated profile id is swept once — a clear must not be published twice", () => {
    expect(
      legacyDiscoveryTopics({
        discoveryPrefix: "homeassistant",
        profileIds: ["deye", "deye"],
        announced: [announced[0] as AnnouncedEntity],
        keep: new Set(),
      }),
    ).toHaveLength(1);
  });

  test("A TOPIC WE JUST ANNOUNCED IS NEVER SWEPT", () => {
    // The legacy node is `sunreye_<profileId>` and the new one is
    // `sunreye_<plant>_<device>`; they collide when the slugs happen to spell the
    // profile id. Without this the retirement would delete the entity it had just
    // created, leaving the operator with nothing at all.
    const keep = new Set(["homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config"]);
    expect(
      legacyDiscoveryTopics({
        discoveryPrefix: "homeassistant",
        profileIds: ["deye-sg05lp3"],
        announced,
        keep,
      }),
    ).toEqual(["homeassistant/number/sunreye_deye-sg05lp3/setting_charge_current/config"]);
  });

  test("nothing announced means nothing to sweep — never a wildcard", () => {
    expect(
      legacyDiscoveryTopics({
        discoveryPrefix: "homeassistant",
        profileIds: ["deye"],
        announced: [],
        keep: new Set(),
      }),
    ).toEqual([]);
  });

  test("every topic it emits is under this software's own node", () => {
    // A wildcard sweep of the discovery prefix would delete other integrations'
    // entities. Every topic must name `sunreye_<something>` explicitly.
    for (const topic of legacyDiscoveryTopics({
      discoveryPrefix: "homeassistant",
      profileIds: ["deye", "sofar"],
      announced,
      keep: new Set(),
    })) {
      expect(topic).toMatch(/^homeassistant\/[a-z]+\/sunreye_[^/]+\/[^/]+\/config$/);
      expect(topic).not.toContain("#");
      expect(topic).not.toContain("+");
    }
  });
});

// ---------------------------------------------------------------------------

type Harness = {
  cleared: string[];
  state: LegacyRetirementState | null;
  writes: number;
  store: LegacyRetirementStore;
  held: string | null;
  warnings: string[];
};

function harness(over: { state?: LegacyRetirementState | null; profileIds?: string[] } = {}) {
  const h: Harness = {
    cleared: [],
    state: over.state ?? null,
    writes: 0,
    held: null,
    warnings: [],
    store: {
      readState: async () => h.state,
      writeState: async (s) => {
        h.writes += 1;
        h.state = s;
      },
      legacyProfileIds: async () => over.profileIds ?? ["deye-sg05lp3"],
    },
  };
  return h;
}

const run = (h: Harness, over: Partial<Parameters<typeof retireLegacyEntities>[0]> = {}) =>
  retireLegacyEntities({
    store: h.store,
    discoveryPrefix: "homeassistant",
    announced,
    keep: new Set<string>(),
    clear: (topic) => h.cleared.push(topic),
    held: () => h.held,
    logger: { info: () => {}, warn: (m) => h.warnings.push(m) },
    ...over,
  });

describe("retireLegacyEntities", () => {
  test("clears every legacy topic, then records that it ran", async () => {
    const h = harness();
    expect(await run(h)).toBe(2);
    expect(h.cleared).toEqual([
      "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config",
      "homeassistant/number/sunreye_deye-sg05lp3/setting_charge_current/config",
    ]);
    expect(h.writes).toBe(1);
    expect(h.state?.profileIds).toEqual(["deye-sg05lp3"]);
    expect(h.state?.topics).toBe(2);
    expect(Date.parse(h.state?.at ?? "")).not.toBeNaN();
  });

  test("THE SECOND RUN IS A NO-OP — this is destructive and runs once", async () => {
    const h = harness();
    await run(h);
    h.cleared.length = 0;
    expect(await run(h)).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(1);
  });

  test("a state row from an earlier boot is honoured before anything is read", async () => {
    const h = harness({ state: { at: "2026-08-01T00:00:00.000Z", profileIds: ["x"], topics: 9 } });
    expect(await run(h)).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(0);
  });

  test("A HELD MIGRATION GATE SUPPRESSES IT ENTIRELY, and records nothing", async () => {
    // The gate is held precisely because identity is not settled yet. Clearing
    // under a placeholder identity would delete entities that were never
    // announced — and the state row would then say the job was done.
    const h = harness();
    h.held = "migration onboarding not completed";
    expect(await run(h)).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(0);
  });

  test("a gate re-held during the state read still stops it", async () => {
    // Every guard is re-checked after the awaits: `readState` is a round trip, and
    // a decision taken before it is stale by the time the clears would go out.
    const h = harness();
    h.store.readState = async () => {
      h.held = "migration onboarding not completed";
      return null;
    };
    expect(await run(h)).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(0);
  });

  test("no legacy profile id means nothing to clear and nothing to record", async () => {
    const h = harness({ profileIds: [] });
    expect(await run(h)).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(0);
  });

  test("nothing announced yet means it does not run — never clear before announcing", async () => {
    // The new entities must exist before the old ones go, or the operator is left
    // with no entities at all.
    const h = harness();
    expect(await run(h, { announced: [] })).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(0);
  });

  test("a legacy sweep that is entirely topics we own now records itself as done", async () => {
    // Nothing to clear, but the question has been answered — so it must not be
    // re-asked on every boot forever.
    const h = harness();
    const keep = new Set(
      legacyDiscoveryTopics({
        discoveryPrefix: "homeassistant",
        profileIds: ["deye-sg05lp3"],
        announced,
        keep: new Set<string>(),
      }),
    );
    expect(await run(h, { keep })).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(1);
  });

  test("the state is written AFTER the clears, so a crash retries instead of skipping", async () => {
    const order: string[] = [];
    const h = harness();
    h.store.writeState = async () => {
      order.push("state");
      h.state = { at: "now", profileIds: [], topics: 0 };
    };
    await run(h, { clear: (t) => order.push(`clear:${t}`) });
    expect(order.at(-1)).toBe("state");
    expect(order.filter((o) => o.startsWith("clear:"))).toHaveLength(2);
  });

  test("a failed profile-id read leaves no state row, so the next boot retries", async () => {
    const h = harness();
    h.store.legacyProfileIds = async () => {
      throw new Error("connection refused");
    };
    expect(await run(h)).toBe(0);
    expect(h.cleared).toEqual([]);
    expect(h.writes).toBe(0);
    expect(h.warnings.join(" ")).toContain("legacy");
  });

  test("a failed state WRITE still leaves the broker tidy and warns", async () => {
    // The clears already went out and they are idempotent, so re-running next boot
    // is harmless — but the operator should see why it will.
    const h = harness();
    h.store.writeState = async () => {
      throw new Error("read-only transaction");
    };
    expect(await run(h)).toBe(2);
    expect(h.cleared).toHaveLength(2);
    expect(h.warnings.join(" ")).toContain("legacy");
  });
});

// ---------------------------------------------------------------------------
// The production store. Its two lookups are the only IO in this module, and both
// are load-bearing: a mis-read state row re-runs a destructive sweep, and a
// mis-read device list decides which topics that sweep publishes to.
// ---------------------------------------------------------------------------

const deviceRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  slug: "inverter",
  name: "Deye SG05LP3",
  profileId: "deye-sg05lp3",
  role: "inverter",
  unitId: 1,
  connectionId: 1,
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  retiredAt: null,
  ...over,
});

const plantRow = {
  id: 1,
  name: "Haus Süd",
  slug: "haus-sud",
  timeZone: "Europe/Berlin",
  latitude: null,
  longitude: null,
  label: "",
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  houseLoadW: null,
  smartMeterSince: null,
  biddingZone: null,
  tariffKey: null,
};

/** Answers the plant read first, then the device read — the order the store uses. */
function fakeDb(plants: unknown[], devices: unknown[]): PlantDb & { calls: number } {
  const db = {
    calls: 0,
    execute: async () => {
      db.calls += 1;
      return { rows: db.calls === 1 ? plants : devices };
    },
  };
  return db;
}

function fakeSettings(stored: unknown = undefined) {
  const io = {
    stored,
    written: [] as { key: string; value: unknown }[],
    read: async <T>(
      _key: string,
      schema: { safeParse(v: unknown): { success: boolean; data?: T } },
      fallback: T,
    ) => {
      if (io.stored === undefined) return fallback;
      const parsed = schema.safeParse(io.stored);
      return parsed.success && parsed.data !== undefined ? parsed.data : fallback;
    },
    write: async <T>(key: string, value: T) => {
      io.written.push({ key, value });
    },
  };
  return io as typeof io & SettingsIo;
}

describe("dbLegacyRetirementStore", () => {
  test("no state row reads as 'never ran'", async () => {
    const store = dbLegacyRetirementStore("deye-sg05lp3", fakeDb([], []), fakeSettings());
    expect(await store.readState()).toBeNull();
  });

  test("a stored row is returned as-is, extra fields and all", async () => {
    const settings = fakeSettings({
      at: "2026-08-01T00:00:00.000Z",
      profileIds: ["deye"],
      topics: 8,
      somethingLater: true,
    });
    const store = dbLegacyRetirementStore("x", fakeDb([], []), settings);
    expect(await store.readState()).toMatchObject({ at: "2026-08-01T00:00:00.000Z", topics: 8 });
  });

  test("A ROW THIS SCHEMA CANNOT PARSE READS AS 'NEVER RAN'", async () => {
    // `readSetting` falls back silently, so the only question is WHICH direction
    // the fallback points. "never ran" repeats an idempotent broker no-op; the
    // other direction would skip the sweep forever.
    const store = dbLegacyRetirementStore("x", fakeDb([], []), fakeSettings({ at: "" }));
    expect(await store.readState()).toBeNull();
  });

  test("the state is written under the documented key", async () => {
    const settings = fakeSettings();
    const store = dbLegacyRetirementStore("x", fakeDb([], []), settings);
    const state: LegacyRetirementState = { at: "now", profileIds: ["a"], topics: 3 };
    await store.writeState(state);
    expect(settings.written).toEqual([{ key: LEGACY_RETIREMENT_KEY, value: state }]);
  });

  test("the legacy profile ids are the active profile plus every device row's", async () => {
    const store = dbLegacyRetirementStore(
      "sofar-hyd-6000",
      fakeDb([plantRow], [deviceRow(), deviceRow({ id: 2, profileId: "deye-sg05lp3" })]),
      fakeSettings(),
    );
    expect(await store.legacyProfileIds()).toEqual(["sofar-hyd-6000", "deye-sg05lp3"]);
  });

  test("a RETIRED device's profile is swept too — its entities are the orphans", async () => {
    const store = dbLegacyRetirementStore(
      "deye-sg05lp3",
      fakeDb(
        [plantRow],
        [deviceRow({ id: 2, profileId: "old-model", retiredAt: "2026-01-01T00:00:00Z" })],
      ),
      fakeSettings(),
    );
    expect(await store.legacyProfileIds()).toContain("old-model");
  });

  test("a duplicate profile id appears once", async () => {
    const store = dbLegacyRetirementStore(
      "deye-sg05lp3",
      fakeDb([plantRow], [deviceRow(), deviceRow({ id: 2 })]),
      fakeSettings(),
    );
    expect(await store.legacyProfileIds()).toEqual(["deye-sg05lp3"]);
  });

  test("no plant yet still yields the active profile, without a device query", async () => {
    const db = fakeDb([], [deviceRow()]);
    const store = dbLegacyRetirementStore("deye-sg05lp3", db, fakeSettings());
    expect(await store.legacyProfileIds()).toEqual(["deye-sg05lp3"]);
    expect(db.calls).toBe(1);
  });

  test("a blank profile id is dropped — `sunreye_/` is not a topic node", async () => {
    const store = dbLegacyRetirementStore(
      "   ",
      fakeDb([plantRow], [deviceRow({ profileId: "" })]),
      fakeSettings(),
    );
    expect(await store.legacyProfileIds()).toEqual([]);
  });
});
