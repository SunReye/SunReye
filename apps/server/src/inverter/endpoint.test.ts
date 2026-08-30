/**
 * The endpoint resolver: the poll loop's answer to "where is the machine, and
 * which slave id is it".
 *
 * Every test here is about ONE defect. Until this module existed the poll loop
 * read `app_settings.inverter` while provisioning copied that same document into
 * `connections` and `devices.unit_id` on every boot — two writable homes for one
 * fact, and the JSONB one won. So the assertions below are mostly about which
 * source an answer came FROM, not merely about its value.
 *
 * Nothing here touches a database: the store is an in-memory double, and the SQL
 * the default wiring composes is proved against a real Postgres in
 * `apps/server/db-tests/plant-spine.test.ts`.
 */

import { describe, expect, test } from "bun:test";

import type { ConnectionRecord, DeviceRecord, PlantRecord } from "@SunReye/db/plant-repo";

import {
  type EndpointStore,
  applyConnectionSave,
  dbEndpointStore,
  defaultEndpointDeps,
  loadPollEndpoint,
  endpointOf,
  offlineEndpoint,
  pollCadence,
  readConnectionSettings,
  readPollTargets,
  saveConnectionSettings,
  selectPollTargets,
  transportOf,
} from "./endpoint";

const PLANT: PlantRecord = {
  id: 1,
  name: "My plant",
  slug: "my-plant",
  timeZone: "auto",
  biddingZone: null,
  tariffKey: null,
  latitude: null,
  longitude: null,
  label: "",
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  houseLoadW: null,
  smartMeterSince: null,
};

const connection = (over: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
  id: 10,
  name: "Inverter",
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  timeoutMs: 2000,
  pollIntervalMs: 1000,
  ...over,
});

const device = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id: 20,
  slug: "inverter",
  name: "Deye",
  profileId: "deye-sun-12k",
  role: "inverter",
  unitId: 1,
  connectionId: 10,
  retiredAt: null,
  ...over,
});

/** An in-memory stand-in for the spine, holding rows the way the tables do. */
function memoryStore(
  seed: {
    plant?: PlantRecord | null;
    devices?: DeviceRecord[];
    connections?: ConnectionRecord[];
  } = {},
) {
  let nextId = 100;
  const state = {
    plant: seed.plant === undefined ? PLANT : seed.plant,
    devices: seed.devices ?? [],
    connections: seed.connections ?? [],
  };
  const calls: string[] = [];
  const store: EndpointStore = {
    async readPlant() {
      return state.plant;
    },
    async ensurePlant() {
      calls.push("ensurePlant");
      state.plant ??= PLANT;
      return state.plant;
    },
    async readDevices() {
      calls.push("readDevices");
      return state.devices;
    },
    async readConnections() {
      return state.connections;
    },
    async ensureConnection(_plantId, settings) {
      calls.push("ensureConnection");
      const existing = state.connections[0];
      if (existing) {
        Object.assign(existing, settings);
        return existing;
      }
      const created = { ...settings, id: nextId++ };
      state.connections.push(created);
      return created;
    },
    async updateDevice(id, patch) {
      calls.push(`updateDevice:${Object.keys(patch).sort().join(",")}`);
      const found = state.devices.find((d) => d.id === id);
      if (!found) throw new Error(`no device ${id}`);
      Object.assign(found, patch);
      return found;
    },
  };
  return { store, state, calls };
}

const warnings: string[] = [];
const logger = {
  info: () => {},
  warn: (template: string) => {
    warnings.push(template);
  },
};
const deps = (store: EndpointStore) => ({ store, logger });

/** A legacy reader answer, for the fallback paths. */
const legacyConfig = (over: Record<string, unknown> = {}) => ({
  host: "10.9.9.9",
  port: 1502,
  transport: "tcp" as const,
  unitId: 9,
  timeoutMs: 2500,
  pollIntervalMs: 1000,
  ...over,
});

describe("pollCadence", () => {
  test("clamps to the loop's real limits instead of trusting the column", () => {
    // `connections.poll_interval_ms` has no CHECK, and three write paths never
    // pass an HTTP edge (the archive import, the bucket replay, the 1.2.0
    // upgrade). A 0 there would arm a `setInterval` that never yields.
    expect(pollCadence(1000)).toBe(1000);
    expect(pollCadence(999)).toBe(1000);
    expect(pollCadence(0)).toBe(1000);
    expect(pollCadence(-5000)).toBe(1000);
    expect(pollCadence(3_600_000)).toBe(3_600_000);
    expect(pollCadence(9_999_999)).toBe(3_600_000);
  });

  test("a non-numeric cadence falls back rather than arming NaN", () => {
    // `setInterval(fn, NaN)` fires as fast as the event loop allows.
    expect(pollCadence(Number.NaN)).toBe(1000);
    expect(pollCadence(Number.POSITIVE_INFINITY)).toBe(3_600_000);
  });
});

describe("transportOf", () => {
  test("only the two framings the Modbus client implements", () => {
    expect(transportOf("tcp")).toBe("tcp");
    expect(transportOf("rtu-over-tcp")).toBe("rtu-over-tcp");
  });

  test("anything else reads as tcp rather than as a framing that never polls", () => {
    // The column has a CHECK, but the archive import and the upgrade write it
    // too; an unknown value must not leave the source unbuildable.
    expect(transportOf("ascii")).toBe("tcp");
    expect(transportOf("")).toBe("tcp");
  });
});

describe("endpointOf", () => {
  test("takes the address from the CONNECTION and the slave id from the DEVICE", () => {
    // The whole point of the split: one gateway, many unit ids.
    const resolved = endpointOf(
      device({ unitId: 7 }),
      connection({ host: "10.0.0.9", port: 8899 }),
    );
    expect(resolved).toEqual({
      host: "10.0.0.9",
      port: 8899,
      transport: "tcp",
      unitId: 7,
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });

  test("a device with no endpoint row resolves to no host at all", () => {
    // `devices.connection_id` is nullable for INVERTER_SIMULATE and for an
    // imported history whose hardware is gone. The unit id is still the
    // device's.
    const resolved = endpointOf(device({ connectionId: null, unitId: 3 }), null);
    expect(resolved.host).toBe("");
    expect(resolved.unitId).toBe(3);
  });

  test("clamps the stored cadence and narrows the stored framing", () => {
    const resolved = endpointOf(
      device(),
      connection({ pollIntervalMs: 10, transport: "nonsense" }),
    );
    expect(resolved.pollIntervalMs).toBe(1000);
    expect(resolved.transport).toBe("tcp");
  });
});

describe("offlineEndpoint", () => {
  test("names nothing to connect to, and still carries a legal cadence", () => {
    const idle = offlineEndpoint();
    expect(idle.host).toBe("");
    expect(idle.pollIntervalMs).toBeGreaterThanOrEqual(1000);
  });
});

describe("selectPollTargets", () => {
  test("binds each device to ITS OWN endpoint, not to the first one", () => {
    // Two gateways. Reading device 21 at gateway 10's address would return
    // plausible values from the wrong machine — the failure this exists to stop.
    const targets = selectPollTargets(
      [
        device({ id: 20, connectionId: 10 }),
        device({ id: 21, slug: "inverter-2", connectionId: 11, unitId: 2 }),
      ],
      [connection({ id: 10, host: "10.0.0.5" }), connection({ id: 11, host: "10.0.0.6" })],
    );
    expect(targets.map((t) => t.endpoint.host)).toEqual(["10.0.0.5", "10.0.0.6"]);
    expect(targets.map((t) => t.endpoint.unitId)).toEqual([1, 2]);
    expect(targets.map((t) => t.deviceId)).toEqual([20, 21]);
    expect(targets.map((t) => t.deviceSlug)).toEqual(["inverter", "inverter-2"]);
  });

  test("a RETIRED device is never a poll target", () => {
    // A replaced inverter would otherwise go on timing out on every cycle
    // forever. The list is filtered here as well as narrowed in SQL: the runtime
    // holds rosters it did not fetch itself.
    const targets = selectPollTargets(
      [
        device({ id: 20, retiredAt: new Date("2026-01-01T00:00:00Z") }),
        device({ id: 21, slug: "new", connectionId: null }),
      ],
      [connection()],
    );
    expect(targets.map((t) => t.deviceId)).toEqual([21]);
  });

  test("a retirement date in the FUTURE retires the device now", () => {
    // Nothing revisits the decision later, so the flag is a state and not a
    // schedule — the rule `plant-repo`'s `isRetired` spells once.
    const targets = selectPollTargets(
      [device({ retiredAt: new Date("2099-01-01T00:00:00Z") })],
      [],
    );
    expect(targets).toEqual([]);
  });

  test("only inverters are polled — a controller is not driven by an inverter profile", () => {
    // A Victron GX / Sigenergy controller has its own registers and its own
    // profile; reading it through the active inverter profile would stamp its
    // readings as an inverter's.
    const targets = selectPollTargets(
      [
        device({ id: 20, slug: "gx", role: "controller" }),
        device({ id: 21, slug: "inverter", role: "inverter" }),
      ],
      [connection()],
    );
    expect(targets.map((t) => t.deviceId)).toEqual([21]);
  });

  test("an OPTIMIZER is never polled — there is no machine on the other end", () => {
    // The virtual device has no endpoint and no registers. Polled, it would
    // resolve to the offline endpoint and time out on every cycle forever.
    const targets = selectPollTargets(
      [
        device({ id: 30, slug: "optimizer", role: "optimizer", connectionId: null }),
        device({ id: 31, slug: "inverter", role: "inverter" }),
      ],
      [connection()],
    );
    expect(targets.map((t) => t.deviceId)).toEqual([31]);
  });

  test("a device pointing at an endpoint that is gone is offline, not mis-addressed", () => {
    const targets = selectPollTargets([device({ connectionId: 99 })], [connection({ id: 10 })]);
    expect(targets[0]?.endpoint.host).toBe("");
  });

  test("no devices at all means nothing to poll", () => {
    expect(selectPollTargets([], [connection()])).toEqual([]);
  });
});

describe("readPollTargets", () => {
  test("resolves the plant's pollable devices from the SPINE", async () => {
    const { store } = memoryStore({ devices: [device()], connections: [connection()] });
    const targets = await readPollTargets(store);
    expect(targets.map((t) => t.endpoint.host)).toEqual(["10.0.0.5"]);
  });

  test("a plant row that does not exist yet is no targets, not a throw", async () => {
    // Provisioning runs before the runtime starts, but it swallows its failures:
    // a database hiccup at boot must leave the loop idle, not crash it.
    expect(await readPollTargets(memoryStore({ plant: null }).store)).toEqual([]);
  });

  test("asks the database for the ACTIVE devices only", async () => {
    // Belt and braces: the statement is narrowed as well as the list filtered,
    // because a caller that got the wide list would hold retired rows.
    let asked: unknown;
    const store: EndpointStore = {
      ...memoryStore({ devices: [device()], connections: [connection()] }).store,
      async readDevices(_plantId: number, options?: { includeRetired?: boolean }) {
        asked = options;
        return [device()];
      },
    };
    await readPollTargets(store);
    expect(asked).toEqual({ includeRetired: false });
  });
});

describe("loadPollEndpoint", () => {
  test("the loop's address IS the primary target's", async () => {
    const { store } = memoryStore({
      devices: [device({ unitId: 4 })],
      connections: [connection({ host: "10.0.0.9", port: 8899, pollIntervalMs: 2000 })],
    });
    expect(await loadPollEndpoint(deps(store))).toEqual({
      host: "10.0.0.9",
      port: 8899,
      transport: "tcp",
      unitId: 4,
      timeoutMs: 2000,
      pollIntervalMs: 2000,
    });
  });

  test("with more than one pollable device it says which one it is reading", async () => {
    // The tables are shaped for N and the God loop still drives one source. That
    // is a stated limitation, not a silent one: without the line an operator who
    // provisioned a second inverter would see it stored in `devices`, never
    // polled, and nothing anywhere would say why.
    warnings.length = 0;
    const { store } = memoryStore({
      devices: [device({ id: 20 }), device({ id: 21, slug: "inverter-2", unitId: 2 })],
      connections: [connection()],
    });
    const resolved = await loadPollEndpoint(deps(store));
    expect(resolved.unitId).toBe(1);
    expect(warnings.join(" ")).toContain("pollable devices are provisioned");
  });

  test("one device warns about nothing", async () => {
    warnings.length = 0;
    const { store } = memoryStore({ devices: [device()], connections: [connection()] });
    await loadPollEndpoint(deps(store));
    expect(warnings).toEqual([]);
  });

  test("an unprovisioned plant idles instead of dialling the empty host", async () => {
    // Connecting to `""` is connecting to localhost, once per tick forever. The
    // runtime turns this answer into "no inverter host configured" and idles.
    expect((await loadPollEndpoint(deps(memoryStore({ plant: null }).store))).host).toBe("");
  });

  test("a plant with a device but no endpoint is the SIMULATE case, not a failure", async () => {
    const { store } = memoryStore({ devices: [device({ connectionId: null })], connections: [] });
    const resolved = await loadPollEndpoint(deps(store));
    expect(resolved.host).toBe("");
    expect(warnings.join(" ")).not.toContain("could not resolve");
  });

  test("a database that cannot be read leaves the loop idle rather than crashing the boot", async () => {
    // This runs on the boot path of a Home Assistant addon whose supervisor
    // restarts a crashing container forever, and the dashboard, the history reads
    // and the settings pages are all still worth serving without it.
    warnings.length = 0;
    const store: EndpointStore = {
      ...memoryStore().store,
      async readPlant() {
        throw new Error("connection terminated unexpectedly");
      },
    };
    const resolved = await loadPollEndpoint({ store, logger });
    expect(resolved.host).toBe("");
    expect(warnings.join(" ")).toContain("could not resolve the poll endpoint");
  });

  test("a non-Error rejection is still reported, not swallowed as [object Object]", async () => {
    warnings.length = 0;
    const store: EndpointStore = {
      ...memoryStore().store,
      readPlant: () => Promise.reject("pool closed"),
    };
    expect((await loadPollEndpoint({ store, logger })).host).toBe("");
    expect(warnings.join(" ")).toContain("could not resolve the poll endpoint");
  });
});

describe("readConnectionSettings", () => {
  test("reads the endpoint and the slave id back out of the spine", async () => {
    const { store } = memoryStore({
      devices: [device({ unitId: 4 })],
      connections: [connection({ host: "10.0.0.9", port: 8899, transport: "rtu-over-tcp" })],
    });
    expect(await readConnectionSettings(deps(store))).toEqual({
      host: "10.0.0.9",
      port: 8899,
      transport: "rtu-over-tcp",
      unitId: 4,
      timeoutMs: 2000,
      pollIntervalMs: 1000,
    });
  });

  test("with no endpoint row yet it falls back to the LEGACY reader", async () => {
    // A fresh install whose connection step was never saved: the settings form
    // must still open on the env-seeded defaults it has always shown.
    const { store } = memoryStore({ devices: [], connections: [] });
    const legacy = legacyConfig();
    expect(await readConnectionSettings({ store, logger, legacy: async () => legacy })).toEqual(
      legacy,
    );
  });

  test("an endpoint with no device keeps the endpoint and takes the legacy slave id", async () => {
    // The onboarding order: the connection is saved before a profile is active,
    // so the device that carries `unit_id` does not exist yet.
    const { store } = memoryStore({ devices: [], connections: [connection()] });
    const read = await readConnectionSettings({
      store,
      logger,
      legacy: async () => legacyConfig({ host: "ignored" }),
    });
    expect(read.host).toBe("10.0.0.5");
    expect(read.unitId).toBe(9);
  });

  test("a RETIRED device's slave id is not what the form shows", async () => {
    const { store } = memoryStore({
      devices: [device({ unitId: 8, retiredAt: new Date("2026-01-01T00:00:00Z") })],
      connections: [connection()],
    });
    const read = await readConnectionSettings({
      store,
      logger,
      legacy: async () => legacyConfig({ unitId: 0 }),
    });
    expect(read.unitId).toBe(0);
  });
});

const typed = (over: Record<string, unknown> = {}) => ({
  host: "10.0.0.9",
  port: 8899,
  transport: "rtu-over-tcp" as const,
  unitId: 3,
  timeoutMs: 3000,
  pollIntervalMs: 2000,
  ...over,
});

describe("saveConnectionSettings", () => {
  test("writes the operator's endpoint straight into the connections row", async () => {
    const { store, state } = memoryStore({ devices: [device()], connections: [connection()] });
    const saved = await saveConnectionSettings(typed(), deps(store));
    expect(state.connections[0]).toMatchObject({
      id: 10, // EDITED in place: the device's binding must survive the save.
      host: "10.0.0.9",
      port: 8899,
      transport: "rtu-over-tcp",
      timeoutMs: 3000,
      pollIntervalMs: 2000,
    });
    expect(saved.host).toBe("10.0.0.9");
  });

  test("the slave id lands on the DEVICE, which is where it lives", async () => {
    const { store, state } = memoryStore({
      devices: [device({ unitId: 1 })],
      connections: [connection()],
    });
    await saveConnectionSettings(typed({ unitId: 3 }), deps(store));
    expect(state.devices[0]?.unitId).toBe(3);
  });

  test("a device with no endpoint yet is BOUND to the one just created", async () => {
    // The onboarding order in full: a simulate/no-host boot creates the device
    // unbound, then the operator saves a real address.
    const { store, state } = memoryStore({ devices: [device({ connectionId: null })] });
    await saveConnectionSettings(typed(), deps(store));
    expect(state.connections.length).toBe(1);
    expect(state.devices[0]?.connectionId).toBe(state.connections[0]?.id);
  });

  test("a device already bound is never re-pointed by a save", async () => {
    const { store, state, calls } = memoryStore({
      devices: [device({ connectionId: 10 })],
      connections: [connection({ id: 10 })],
    });
    await saveConnectionSettings(typed(), deps(store));
    expect(state.devices[0]?.connectionId).toBe(10);
    expect(calls).toContain("updateDevice:unitId");
  });

  test("the plant row is ensured, so the very first save cannot fail on a missing plant", async () => {
    const { store, calls, state } = memoryStore({ plant: null });
    await saveConnectionSettings(typed(), deps(store));
    expect(calls).toContain("ensurePlant");
    expect(state.connections.length).toBe(1);
  });

  test("a blank host with no endpoint row writes no endpoint at all", async () => {
    // There is nothing to point at, and an addressless `connections` row would
    // bind the device to an endpoint that names nowhere.
    const { store, state } = memoryStore({ devices: [device({ connectionId: null })] });
    await saveConnectionSettings(typed({ host: "   " }), deps(store));
    expect(state.connections).toEqual([]);
    expect(state.devices[0]?.connectionId).toBeNull();
  });

  test("clearing the host of an EXISTING endpoint keeps the row and its binding", async () => {
    // An explicit operator edit ("this machine is gone / I am switching to
    // simulate"), unlike a boot: the loop goes idle, but the device stays bound
    // to the row whose address the operator can put back.
    const { store, state } = memoryStore({
      devices: [device({ connectionId: 10 })],
      connections: [connection({ id: 10 })],
    });
    await saveConnectionSettings(typed({ host: "" }), deps(store));
    expect(state.connections[0]?.id).toBe(10);
    expect(state.connections[0]?.host).toBe("");
    expect(state.devices[0]?.connectionId).toBe(10);
  });

  test("a RETIRED device does not receive the operator's slave id", async () => {
    // It is out of service; writing to it would be the resurrection this column
    // exists to prevent, and would also risk colliding with its replacement on
    // `(connection_id, unit_id)`.
    const { store, state, calls } = memoryStore({
      devices: [device({ id: 20, retiredAt: new Date("2026-01-01T00:00:00Z"), unitId: 1 })],
      connections: [connection()],
    });
    await saveConnectionSettings(typed({ unitId: 3 }), deps(store));
    expect(state.devices[0]?.unitId).toBe(1);
    expect(calls.some((c) => c.startsWith("updateDevice"))).toBe(false);
  });

  test("saving before any device exists still persists the endpoint", async () => {
    // Onboarding: no profile is active, so there is no device to carry the unit
    // id. The address is still the operator's answer and must be kept.
    const { store, state } = memoryStore({ devices: [] });
    const saved = await saveConnectionSettings(typed(), deps(store));
    expect(state.connections[0]?.host).toBe("10.0.0.9");
    expect(saved.unitId).toBe(3);
  });

  test("what comes back is what a later read of the spine will say", async () => {
    // The route echoes the save back to the settings form, and a form showing a
    // value the database does not hold is how the old dual-authority bug looked
    // from the outside.
    const { store } = memoryStore({ devices: [device()], connections: [connection()] });
    const saved = await saveConnectionSettings(typed(), deps(store));
    expect(await readConnectionSettings(deps(store))).toEqual(saved);
  });
});

describe("applyConnectionSave", () => {
  /** The sequence, recorded — the thing the route layer cannot prove itself. */
  function effects() {
    const order: string[] = [];
    const seeds: unknown[] = [];
    return {
      order,
      seeds,
      effects: {
        provision: async (seed: unknown) => {
          order.push("provision");
          seeds.push(seed);
        },
        reload: async () => {
          order.push("reload");
        },
      },
    };
  }

  test("writes the spine, THEN provisions, THEN asks the loop to re-read", async () => {
    // The order is load-bearing. Provisioning before the write would seed a
    // second endpoint from the same values; reloading before either would have
    // the loop re-resolve against the rows as they were.
    const { store, state } = memoryStore({ devices: [device()], connections: [connection()] });
    const recorded = effects();
    const wrapped = {
      ...store,
      async ensureConnection(
        plantId: number,
        settings: Parameters<typeof store.ensureConnection>[1],
      ) {
        recorded.order.push("write");
        return store.ensureConnection(plantId, settings);
      },
    };
    await applyConnectionSave(typed(), recorded.effects, { store: wrapped, logger });
    expect(recorded.order).toEqual(["write", "provision", "reload"]);
    expect(state.connections[0]?.host).toBe("10.0.0.9");
  });

  test("provisioning is seeded with what was STORED, not with the raw body", async () => {
    // The seed only ever creates a device that does not exist; seeding it from
    // anything but the persisted answer would let the two disagree on the unit id
    // the very first time a device is created.
    const { store } = memoryStore({ devices: [], connections: [] });
    const recorded = effects();
    const stored = await applyConnectionSave(typed({ host: "  10.0.0.9  " }), recorded.effects, {
      store,
      logger,
    });
    expect(recorded.seeds).toEqual([stored]);
    expect(stored.host).toBe("10.0.0.9");
  });

  test("a failed write neither provisions nor reloads", async () => {
    // The route answers 400 with the reason. A reload here would leave the loop
    // and the form agreeing on a gateway move that never landed.
    const { store } = memoryStore({ devices: [device()], connections: [connection()] });
    const recorded = effects();
    const failing = {
      ...store,
      async ensureConnection() {
        throw new Error("could not serialize access due to concurrent update");
      },
    };
    await expect(
      applyConnectionSave(typed(), recorded.effects, { store: failing, logger }),
    ).rejects.toThrow("concurrent update");
    expect(recorded.order).toEqual([]);
  });
});

describe("dbEndpointStore", () => {
  /** A client that answers every statement with one plant-shaped row. */
  function fakeClient(rows: Record<string, unknown>[]) {
    const executed: unknown[] = [];
    return {
      executed,
      client: {
        async execute(query: unknown) {
          executed.push(query);
          return { rows };
        },
      },
    };
  }

  const PLANT_ROW = {
    id: "1",
    name: "My plant",
    slug: "my-plant",
    timeZone: "auto",
    biddingZone: null,
    tariffKey: null,
    latitude: null,
    longitude: null,
    label: "",
    arrays: [],
    tempCoefficient: "-0.4",
    systemLoss: "14",
    maxOutputW: null,
    houseLoadW: null,
    smartMeterSince: null,
  };

  test("every method reaches the client, and none of them holds it", async () => {
    // The production wiring is one object literal, but a collaborator wired to
    // the wrong thing would only show up against a real database. The statements
    // themselves are proved in `apps/server/db-tests/plant-spine.test.ts`.
    const empty = dbEndpointStore({ execute: async () => ({ rows: [] }) });
    expect(await empty.readConnections(1)).toEqual([]);
    expect(await empty.readDevices(1)).toEqual([]);
    expect(await empty.readPlant()).toBeNull();

    const { client, executed } = fakeClient([PLANT_ROW]);
    // `ensurePlant` is `provisionPlantRow` — the plant-only entry point, which
    // ADOPTS the install's plant. Wired through `./provision.ts` rather than
    // re-derived here so the naming and 1.x seeding rules have one home.
    expect((await dbEndpointStore(client).ensurePlant()).slug).toBe("my-plant");
    expect(executed.length).toBeGreaterThan(0);
  });

  test("the write methods reach the client too", async () => {
    const { client } = fakeClient([
      {
        id: "3",
        name: "Inverter",
        host: "10.0.0.5",
        port: "502",
        transport: "tcp",
        timeoutMs: "2000",
        pollIntervalMs: "1000",
      },
    ]);
    const wired = dbEndpointStore(client);
    expect(
      (
        await wired.ensureConnection(1, {
          name: "Inverter",
          host: "10.0.0.5",
          port: 502,
          transport: "tcp",
          timeoutMs: 2000,
          pollIntervalMs: 1000,
        })
      ).id,
    ).toBe(3);

    const deviceClient = fakeClient([
      {
        id: "7",
        slug: "inverter",
        name: "Deye",
        profileId: "deye",
        role: "inverter",
        unitId: "1",
        connectionId: "3",
        retiredAt: null,
      },
    ]);
    expect((await dbEndpointStore(deviceClient.client).updateDevice(7, { unitId: 2 })).id).toBe(7);
  });
});

describe("defaultEndpointDeps", () => {
  test("wires the real store and logger without touching either", () => {
    // The path every boot and every settings save takes. Nothing is invoked, so
    // no query runs — a `db` captured at module load instead of read per call is
    // what this is guarding (see the docblock).
    const wired = defaultEndpointDeps();
    expect(typeof wired.store.readPlant).toBe("function");
    expect(typeof wired.store.ensureConnection).toBe("function");
    expect(typeof wired.logger.warn).toBe("function");
    expect(wired.legacy).toBeUndefined();
  });
});
