import { describe, expect, test } from "bun:test";
import type { ConnectionRecord, DevicePatch, DeviceRecord } from "@SunReye/db/plant-repo";
import type {
  IntegrationPatch,
  IntegrationRecord,
  IntegrationSpec,
} from "@SunReye/db/integrations-store";

import { catalogFor } from "../devices/integration-catalog";
import {
  type IntegrationAdminDeps,
  type IntegrationAdminStore,
  IntegrationAdminError,
  addIntegration,
  deleteIntegration,
  listIntegrations,
  patchIntegration,
} from "./integration-admin";

/**
 * The list/add/patch/delete logic behind `/api/integrations`, against an
 * in-memory store.
 *
 * What is proven here is the ORDER and the RULES — the refusals and their
 * statuses, that a validation failure never leaves a row behind, that a reload
 * happens exactly once and only after a write landed, and above all that
 * deleting an integration RETIRES the devices it yielded rather than deleting
 * them. What Postgres does with the statements is
 * `db-tests/integrations-store.test.ts`'s business.
 *
 * The catalog is the REAL one. It is a pure lookup with no I/O, and a double
 * would let this suite agree with itself about which integration may sit on
 * which connection kind — the exact disagreement the catalog exists to prevent.
 */

const PLANT = { id: 7 };

const gateway: ConnectionRecord = {
  id: 3,
  name: "Gateway 1",
  kind: "modbus",
  params: { host: "10.0.0.5", port: 502, transport: "tcp", timeoutMs: 2000, pollIntervalMs: 1000 },
};

const broker: ConnectionRecord = {
  id: 5,
  name: "Home broker",
  kind: "mqtt",
  params: { brokerUrl: "mqtt://hass.lan:1883", username: "mqtt", password: "secret" },
};

const ingest: IntegrationRecord = {
  id: 11,
  connectionId: 5,
  kind: "evcc-ingest",
  enabled: true,
  params: { topicRoot: "evcc" },
};

const loadpoint = (over: Partial<DeviceRecord> = {}): DeviceRecord => ({
  id: 21,
  slug: "evcc-loadpoint-0",
  name: "EVCC loadpoint 0",
  profileId: "evcc-loadpoint",
  role: "charger",
  unitId: 0,
  connectionId: 5,
  params: { topicRoot: "evcc" },
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  retiredAt: null,
  ...over,
});

function harness(
  over: {
    plant?: { id: number } | null;
    connections?: ConnectionRecord[];
    integrations?: IntegrationRecord[];
    devices?: DeviceRecord[];
    connectionStatus?: IntegrationAdminDeps["connectionStatus"];
  } = {},
) {
  const connections = [...(over.connections ?? [gateway, broker])];
  const integrations = [...(over.integrations ?? [])];
  const devices = [...(over.devices ?? [])];
  const calls: string[] = [];
  let nextId = 100;
  const store: IntegrationAdminStore = {
    async readPlant() {
      calls.push("readPlant");
      return over.plant === undefined ? (PLANT as never) : (over.plant as never);
    },
    async readConnections() {
      calls.push("readConnections");
      return connections;
    },
    async readIntegrations() {
      calls.push("readIntegrations");
      return integrations;
    },
    async createIntegration(_plantId: number, spec: IntegrationSpec) {
      calls.push("createIntegration");
      const created = { ...spec, id: nextId++, enabled: true } as IntegrationRecord;
      integrations.push(created);
      return created;
    },
    async updateIntegration(id: number, patch: IntegrationPatch) {
      calls.push(`updateIntegration:${id}`);
      const index = integrations.findIndex((row) => row.id === id);
      const current = integrations[index];
      if (!current) throw new Error(`integration ${id} does not exist`);
      const updated = {
        ...current,
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.params !== undefined ? { params: patch.params } : {}),
      } as IntegrationRecord;
      integrations[index] = updated;
      return updated;
    },
    async deleteIntegration(id: number) {
      calls.push(`deleteIntegration:${id}`);
      const index = integrations.findIndex((row) => row.id === id);
      if (index < 0) return false;
      integrations.splice(index, 1);
      return true;
    },
    async readDevices() {
      calls.push("readDevices");
      return devices;
    },
    async updateDevice(id: number, patch: DevicePatch) {
      calls.push(`updateDevice:${id}`);
      const index = devices.findIndex((d) => d.id === id);
      const current = devices[index];
      if (!current) throw new Error(`device ${id} does not exist`);
      const updated = { ...current, ...patch } as DeviceRecord;
      devices[index] = updated;
      return updated;
    },
  };
  const deps: IntegrationAdminDeps = {
    store,
    catalog: catalogFor,
    reload: async () => void calls.push("reload"),
    ...(over.connectionStatus ? { connectionStatus: over.connectionStatus } : {}),
  };
  return { deps, calls, integrations, devices, connections };
}

/** The refusal a call produced, or a failure naming what it returned instead. */
async function refusal(run: () => Promise<unknown>): Promise<IntegrationAdminError> {
  try {
    const value = await run();
    throw new Error(`expected a refusal, got ${JSON.stringify(value)}`);
  } catch (error) {
    if (error instanceof IntegrationAdminError) return error;
    throw error;
  }
}

describe("listIntegrations", () => {
  test("an install with no plant lists nothing rather than throwing", async () => {
    const { deps } = harness({ plant: null });
    expect(await listIntegrations(deps)).toEqual({ integrations: [] });
  });

  test("a plant with no integrations lists nothing", async () => {
    const { deps } = harness();
    expect(await listIntegrations(deps)).toEqual({ integrations: [] });
  });

  test("a row carries its catalog label and flags, never a second label list", async () => {
    const { deps } = harness({ integrations: [ingest] });
    const { integrations } = await listIntegrations(deps);
    expect(integrations).toEqual([
      {
        id: 11,
        kind: "evcc-ingest",
        connectionId: 5,
        enabled: true,
        params: { topicRoot: "evcc" },
        label: "EVCC",
        addable: true,
        multiInstance: true,
        status: null,
      },
    ]);
  });

  test("a row carries what is OBSERVED of its connection, not what its config says", async () => {
    // The point of #221. Before it, "configured" was the only fact available:
    // the page said the same thing for a broker that had been off for a week.
    const observed = {
      connected: true,
      lastError: "not authorized",
      lastErrorAt: "2026-09-10T07:00:00.000Z",
      lastConnectedAt: "2026-09-10T08:00:00.000Z",
    };
    const { deps } = harness({
      integrations: [ingest],
      connectionStatus: (connectionId) => (connectionId === 5 ? observed : null),
    });
    const [only] = (await listIntegrations(deps)).integrations;
    expect(only?.status).toEqual(observed);
  });

  test("a connection this process holds no client for reports null, never a false 'down'", async () => {
    // A `modbus` row, or a boot that has not opened anything yet. Rendering that
    // as disconnected would be a worse lie than the config-derived status it
    // replaces, because it looks like a measurement.
    const { deps } = harness({ integrations: [ingest], connectionStatus: () => null });
    const [only] = (await listIntegrations(deps)).integrations;
    expect(only?.status).toBeNull();
  });

  test("the single-instance export reports multiInstance false", async () => {
    const row: IntegrationRecord = {
      id: 12,
      connectionId: 5,
      kind: "ha-export",
      enabled: false,
      params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
    };
    const { deps } = harness({ integrations: [row] });
    const [only] = (await listIntegrations(deps)).integrations;
    expect(only).toMatchObject({ label: "Home Assistant export", multiInstance: false });
    expect(only?.enabled).toBe(false);
  });

  test("a row whose connection this build has no catalog arm for still renders", async () => {
    // A connection kind arriving from a database migrated ahead of the binary is
    // still a row the settings page has to draw. It falls back to its own kind
    // as a label and is not offered as addable.
    const future = { ...broker, kind: "http" } as unknown as ConnectionRecord;
    const { deps } = harness({ connections: [future], integrations: [ingest] });
    const [only] = (await listIntegrations(deps)).integrations;
    expect(only).toMatchObject({ label: "evcc-ingest", addable: false, multiInstance: false });
  });
});

describe("addIntegration", () => {
  test("it stores the row, defaults the params it was not given, and reloads once", async () => {
    const { deps, calls, integrations } = harness();
    const view = await addIntegration(deps, { kind: "evcc-ingest", connectionId: 5, params: {} });
    expect(view).toMatchObject({
      kind: "evcc-ingest",
      connectionId: 5,
      enabled: true,
      label: "EVCC",
      // The catalog's own schema defaults it — the wizard may omit the field.
      params: { topicRoot: "evcc" },
    });
    expect(integrations).toHaveLength(1);
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("an ABSENT params document is the same as an empty one", async () => {
    const { deps } = harness();
    const view = await addIntegration(deps, { kind: "evcc-ingest", connectionId: 5 });
    expect(view.params).toEqual({ topicRoot: "evcc" });
  });

  test("an unknown key in params is STRIPPED, not stored and not refused", async () => {
    // The catalog entry is the schema, and a zod object strips what it does not
    // declare. Storing it would put a key in the document no runtime reads.
    const { deps } = harness();
    const view = await addIntegration(deps, {
      kind: "evcc-ingest",
      connectionId: 5,
      params: { topicRoot: "garage", nonsense: 1 },
    });
    expect(view.params).toEqual({ topicRoot: "garage" });
  });

  test("an unknown kind is a 400 on `kind`", async () => {
    const { deps, integrations } = harness();
    const error = await refusal(() => addIntegration(deps, { kind: "weather", connectionId: 5 }));
    expect(error.status).toBe(400);
    expect(error.field).toBe("kind");
    expect(integrations).toHaveLength(0);
  });

  test("a connectionId naming no row is a 404", async () => {
    const { deps, integrations } = harness();
    const error = await refusal(() =>
      addIntegration(deps, { kind: "evcc-ingest", connectionId: 99 }),
    );
    expect(error.status).toBe(404);
    expect(error.field).toBe("connectionId");
    expect(integrations).toHaveLength(0);
  });

  test("a connectionId of 0 is a 400 — identity columns start at 1", async () => {
    const { deps } = harness();
    const error = await refusal(() =>
      addIntegration(deps, { kind: "evcc-ingest", connectionId: 0 }),
    );
    expect(error.status).toBe(400);
    expect(error.field).toBe("connectionId");
  });

  test("a negative connectionId is a 400", async () => {
    const { deps } = harness();
    const error = await refusal(() =>
      addIntegration(deps, { kind: "evcc-ingest", connectionId: -1 }),
    );
    expect(error.status).toBe(400);
    expect(error.field).toBe("connectionId");
  });

  test("an HA export cannot attach to a Modbus gateway — 409 on `kind`", async () => {
    const { deps, integrations } = harness();
    const error = await refusal(() => addIntegration(deps, { kind: "ha-export", connectionId: 3 }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("kind");
    expect(error.message).toContain("modbus");
    expect(integrations).toHaveLength(0);
  });

  test("a second HA export on the same broker is a 409 — one publisher per broker", async () => {
    const existing: IntegrationRecord = {
      id: 12,
      connectionId: 5,
      kind: "ha-export",
      enabled: true,
      params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
    };
    const { deps, integrations } = harness({ integrations: [existing] });
    const error = await refusal(() => addIntegration(deps, { kind: "ha-export", connectionId: 5 }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("kind");
    expect(integrations).toHaveLength(1);
  });

  test("a SECOND EVCC ingest on the same broker is allowed — two instances, two topic roots", async () => {
    const { deps, integrations } = harness({ integrations: [ingest] });
    const view = await addIntegration(deps, {
      kind: "evcc-ingest",
      connectionId: 5,
      params: { topicRoot: "garage" },
    });
    expect(view.params).toEqual({ topicRoot: "garage" });
    expect(integrations).toHaveLength(2);
  });

  test("params the entry's schema refuses is a 400 on `params`", async () => {
    const { deps, integrations } = harness();
    const error = await refusal(() =>
      addIntegration(deps, { kind: "evcc-ingest", connectionId: 5, params: { topicRoot: "" } }),
    );
    expect(error.status).toBe(400);
    expect(error.field).toBe("params");
    expect(error.message).toContain("topicRoot");
    expect(integrations).toHaveLength(0);
  });

  test("a params that is not an object at all is a 400 on `params`", async () => {
    const { deps } = harness();
    const error = await refusal(() =>
      addIntegration(deps, { kind: "evcc-ingest", connectionId: 5, params: 7 }),
    );
    expect(error.status).toBe(400);
    expect(error.field).toBe("params");
  });

  test("a connection-LESS add is refused: no null-arm entry is an integration kind", async () => {
    // The null arm holds coded devices the server provisions itself, and their
    // ids are profile ids rather than integration kinds. Nothing an operator may
    // add lives there today, and the refusal is DERIVED from that rather than
    // from a hardcoded "connectionId is required".
    const { deps } = harness();
    const error = await refusal(() => addIntegration(deps, { kind: "evcc-ingest" }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("kind");
  });

  test("an install with no plant refuses rather than inventing one", async () => {
    const { deps } = harness({ plant: null });
    const error = await refusal(() =>
      addIntegration(deps, { kind: "evcc-ingest", connectionId: 5 }),
    );
    expect(error.status).toBe(400);
  });

  test("nothing reloads when the body is refused", async () => {
    const { deps, calls } = harness();
    await refusal(() => addIntegration(deps, { kind: "nope" }));
    expect(calls).not.toContain("reload");
  });
});

describe("patchIntegration", () => {
  test("`enabled` alone toggles the row and reloads", async () => {
    const { deps, calls, integrations } = harness({ integrations: [ingest] });
    const view = await patchIntegration(deps, 11, { enabled: false });
    expect(view.enabled).toBe(false);
    expect(integrations[0]?.enabled).toBe(false);
    expect(calls).toContain("reload");
  });

  test("`params` REPLACES and is validated against the ROW's kind", async () => {
    const { deps } = harness({ integrations: [ingest] });
    const view = await patchIntegration(deps, 11, { params: { topicRoot: "garage" } });
    expect(view.params).toEqual({ topicRoot: "garage" });
  });

  test("the arm comes from the ROW's kind, never from the body", async () => {
    // The mirror of `patchConnection`'s rule: choosing the arm from the body
    // would let a write smuggle an export's settings onto an ingest. The proof
    // is that ONE document gets two different answers depending on the row it
    // is sent to — refused by the export's schema, and stripped to the ingest's
    // defaults by the ingest's.
    const exportRow: IntegrationRecord = {
      id: 12,
      connectionId: 5,
      kind: "ha-export",
      enabled: true,
      params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
    };
    const both = harness({ integrations: [ingest, exportRow] });
    const error = await refusal(() =>
      patchIntegration(both.deps, 12, { params: { topicPrefix: "" } }),
    );
    expect(error.status).toBe(400);
    expect(error.field).toBe("params");
    expect(error.message).toContain("topicPrefix");

    const onIngest = await patchIntegration(both.deps, 11, { params: { topicPrefix: "" } });
    expect(onIngest.params).toEqual({ topicRoot: "evcc" });
  });

  test("`kind` is TOPOLOGY and is refused with a 409, even when it matches the row", async () => {
    const { deps, integrations } = harness({ integrations: [ingest] });
    const error = await refusal(() => patchIntegration(deps, 11, { kind: "evcc-ingest" }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("kind");
    expect(integrations[0]?.kind).toBe("evcc-ingest");
  });

  test("`connectionId` is TOPOLOGY and is refused with a 409", async () => {
    const { deps } = harness({ integrations: [ingest] });
    const error = await refusal(() => patchIntegration(deps, 11, { connectionId: 3 }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("connectionId");
  });

  test("a topology field is refused BEFORE the row is even read", async () => {
    // Same shape as `requireTopologyUnchanged`: the refusal is about the field,
    // not about the row, so a 409 must not depend on the id existing.
    const { deps, calls } = harness({ integrations: [ingest] });
    const error = await refusal(() => patchIntegration(deps, 404, { connectionId: 3 }));
    expect(error.status).toBe(409);
    expect(calls).not.toContain("reload");
  });

  test("an empty body is a 400 — there is nothing to change", async () => {
    const { deps } = harness({ integrations: [ingest] });
    const error = await refusal(() => patchIntegration(deps, 11, {}));
    expect(error.status).toBe(400);
  });

  test("an id that names no row is a 404", async () => {
    const { deps } = harness({ integrations: [ingest] });
    const error = await refusal(() => patchIntegration(deps, 99, { enabled: false }));
    expect(error.status).toBe(404);
  });

  test("another plant's row is not reachable by id", async () => {
    const { deps } = harness({ integrations: [] });
    const error = await refusal(() => patchIntegration(deps, 11, { enabled: false }));
    expect(error.status).toBe(404);
  });

  test("a row whose catalog entry this build lacks refuses a params write rather than storing it", async () => {
    const future = { ...broker, kind: "http" } as unknown as ConnectionRecord;
    const { deps } = harness({ connections: [future], integrations: [ingest] });
    const error = await refusal(() => patchIntegration(deps, 11, { params: { topicRoot: "x" } }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("kind");
  });

  test("that same row may still be DISABLED — a settings page must be able to stop it", async () => {
    const future = { ...broker, kind: "http" } as unknown as ConnectionRecord;
    const { deps } = harness({ connections: [future], integrations: [ingest] });
    expect((await patchIntegration(deps, 11, { enabled: false })).enabled).toBe(false);
  });
});

describe("deleteIntegration", () => {
  test("it removes the row and reloads", async () => {
    const { deps, calls, integrations } = harness({ integrations: [ingest] });
    await deleteIntegration(deps, 11);
    expect(integrations).toHaveLength(0);
    expect(calls).toContain("reload");
  });

  test("an id that names no row is a 404 and deletes nothing", async () => {
    const { deps, calls, integrations } = harness({ integrations: [ingest] });
    const error = await refusal(() => deleteIntegration(deps, 99));
    expect(error.status).toBe(404);
    expect(integrations).toHaveLength(1);
    expect(calls).not.toContain("reload");
  });

  test("a kind that yields no devices never reads the roster", async () => {
    const exportRow: IntegrationRecord = {
      id: 12,
      connectionId: 5,
      kind: "ha-export",
      enabled: true,
      params: { topicPrefix: "sunreye", haDiscoveryEnabled: false, haDiscoveryPrefix: "ha" },
    };
    const { deps, calls } = harness({ integrations: [exportRow], devices: [loadpoint()] });
    await deleteIntegration(deps, 12);
    expect(calls.filter((c) => c.startsWith("updateDevice"))).toEqual([]);
  });

  test("deleting an EVCC ingest RETIRES its two loadpoints — it never deletes them", async () => {
    // `metrics_raw.device_id` is a NOT NULL foreign key holding up to five years
    // of readings per device. Deleting the row would take the history with it,
    // which is why a vanished loadpoint is retired rather than dropped
    // (`../evcc/evcc-registrar.ts`, rule 3).
    const first = loadpoint();
    const second = loadpoint({ id: 22, slug: "evcc-loadpoint-1", unitId: 1 });
    const { deps, devices } = harness({ integrations: [ingest], devices: [first, second] });
    await deleteIntegration(deps, 11);
    expect(devices).toHaveLength(2);
    expect(devices[0]?.retiredAt).toBeInstanceOf(Date);
    expect(devices[1]?.retiredAt).toBeInstanceOf(Date);
    // The rows themselves are untouched otherwise: their ids are what history is
    // keyed to and their slugs are the MQTT namespace.
    expect(devices.map((d) => d.id)).toEqual([21, 22]);
    expect(devices.map((d) => d.slug)).toEqual(["evcc-loadpoint-0", "evcc-loadpoint-1"]);
  });

  test("only the loadpoints on THIS integration's broker are retired", async () => {
    const mine = loadpoint();
    const theirs = loadpoint({ id: 23, slug: "evcc-loadpoint-9", connectionId: 3 });
    const { deps, devices } = harness({ integrations: [ingest], devices: [mine, theirs] });
    await deleteIntegration(deps, 11);
    expect(devices[0]?.retiredAt).toBeInstanceOf(Date);
    expect(devices[1]?.retiredAt).toBeNull();
  });

  test("a device of another profile on the same broker is left alone", async () => {
    const meter = loadpoint({ id: 24, slug: "meter", profileId: "sdm630", role: "meter" });
    const { deps, devices } = harness({ integrations: [ingest], devices: [meter] });
    await deleteIntegration(deps, 11);
    expect(devices[0]?.retiredAt).toBeNull();
  });

  test("an already-retired loadpoint is not re-stamped", async () => {
    const was = new Date("2026-01-01T00:00:00Z");
    const retired = loadpoint({ retiredAt: was });
    const { deps, devices, calls } = harness({ integrations: [ingest], devices: [retired] });
    await deleteIntegration(deps, 11);
    expect(devices[0]?.retiredAt).toBe(was);
    expect(calls.filter((c) => c.startsWith("updateDevice"))).toEqual([]);
  });

  test("the devices are retired BEFORE the row goes", async () => {
    // A crash between the two must leave the integration configured rather than
    // leave live loadpoints behind an integration nobody can find.
    const { deps, calls } = harness({ integrations: [ingest], devices: [loadpoint()] });
    await deleteIntegration(deps, 11);
    const retire = calls.indexOf("updateDevice:21");
    const remove = calls.indexOf("deleteIntegration:11");
    expect(retire).toBeGreaterThanOrEqual(0);
    expect(remove).toBeGreaterThan(retire);
  });
});
