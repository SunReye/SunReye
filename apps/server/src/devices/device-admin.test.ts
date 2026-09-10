import { describe, expect, test } from "bun:test";
import type { ModbusParams } from "@SunReye/db/connection-kinds";
import type { DeviceBattery } from "@SunReye/db/batteries";
import type {
  ConnectionPatch,
  ConnectionRecord,
  DeviceBatteryRecord,
  DevicePatch,
  DeviceRecord,
} from "@SunReye/db/plant-repo";

import {
  type DeviceAdminDeps,
  type DeviceAdminStore,
  DeviceAdminError,
  addDevice,
  listConnections,
  listDevices,
  addConnection,
  patchConnection,
  patchDevice,
  removeConnection,
} from "./device-admin";

/**
 * The add/list/retire logic behind `/api/devices`, against an in-memory store.
 *
 * What is proven here is the ORDER and the RULES — validation before any write,
 * the connection before the device, a reload exactly once and only after a
 * write landed, which constraint maps to which 409. What Postgres does with the
 * statements is `db-tests/plant-spine.test.ts`'s business.
 */

const PLANT = { id: 7 };

const modbusParams = (over: Partial<ModbusParams> = {}): ModbusParams => ({
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  timeoutMs: 2000,
  pollIntervalMs: 1000,
  ...over,
});

const gateway: ConnectionRecord = {
  id: 3,
  name: "Gateway 1",
  kind: "modbus",
  params: modbusParams(),
};

/** A broker row — the kind that arrived with #217, and the kind a PATCH may not become. */
const broker: ConnectionRecord = {
  id: 5,
  name: "Home broker",
  kind: "mqtt",
  params: { brokerUrl: "mqtt://hass.lan:1883", username: "mqtt", password: "secret" },
};

const inverter: DeviceRecord = {
  id: 1,
  slug: "inverter",
  name: "Inverter",
  profileId: "deye-sun15k",
  role: "inverter",
  unitId: 1,
  connectionId: 3,
  params: {},
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  retiredAt: null,
};

/** A unique violation as node-postgres raises it, wrapped as drizzle does. */
const violation = (constraint: string) =>
  new Error("Failed query", {
    cause: Object.assign(new Error("duplicate key"), { code: "23505", constraint }),
  });

function harness(
  over: {
    plant?: { id: number } | null;
    connections?: ConnectionRecord[];
    devices?: DeviceRecord[];
    knownProfiles?: Record<string, string>;
    primarySlug?: string | null;
    coded?: Record<string, { integration: string; name?: string; addable?: boolean }>;
    createDevice?: DeviceAdminStore["createDevice"];
    batteries?: DeviceBatteryRecord[];
  } = {},
) {
  const connections = [...(over.connections ?? [gateway])];
  const devices = [...(over.devices ?? [inverter])];
  const batteries = [...(over.batteries ?? [])];
  const known = over.knownProfiles ?? { "deye-sun15k": "Deye SUN-15K", sdm630: "Eastron SDM630" };
  const calls: string[] = [];
  let nextId = 100;
  const store: DeviceAdminStore = {
    async readPlant() {
      calls.push("readPlant");
      return over.plant === undefined ? (PLANT as never) : (over.plant as never);
    },
    async readConnections() {
      calls.push("readConnections");
      return connections;
    },
    async readDevices() {
      calls.push("readDevices");
      return devices;
    },
    async createConnection(_plantId, settings) {
      calls.push("createConnection");
      const created = { ...settings, id: nextId++ };
      connections.push(created);
      return created;
    },
    createDevice:
      over.createDevice ??
      (async (spec) => {
        calls.push("createDevice");
        const created: DeviceRecord = {
          id: nextId++,
          slug: spec.slug,
          name: spec.name,
          profileId: spec.profileId,
          role: spec.role,
          unitId: spec.unitId,
          connectionId: spec.connectionId,
          params: spec.params ?? {},
          arrays: spec.pv?.arrays ?? [],
          tempCoefficient: spec.pv?.tempCoefficient ?? -0.4,
          systemLoss: spec.pv?.systemLoss ?? 14,
          retiredAt: null,
        };
        devices.push(created);
        return created;
      }),
    async updateConnection(id, patch: ConnectionPatch) {
      calls.push(`updateConnection:${id}`);
      const index = connections.findIndex((c) => c.id === id);
      const current = connections[index];
      if (!current) throw new Error(`connection ${id} does not exist`);
      const next = { ...current, ...patch } as ConnectionRecord;
      connections[index] = next;
      return next;
    },
    async readPlantBatteries() {
      calls.push("readPlantBatteries");
      return batteries;
    },
    async upsertDeviceBattery(deviceId, battery: DeviceBattery) {
      calls.push(`upsertBattery:${deviceId}`);
      const index = batteries.findIndex((b) => b.deviceId === deviceId);
      if (index >= 0) batteries[index] = { deviceId, ...battery };
      else batteries.push({ deviceId, ...battery });
    },
    async deleteDeviceBattery(deviceId) {
      calls.push(`deleteBattery:${deviceId}`);
      const index = batteries.findIndex((b) => b.deviceId === deviceId);
      if (index >= 0) batteries.splice(index, 1);
    },
    async deleteConnection(id) {
      calls.push(`deleteConnection:${id}`);
      const index = connections.findIndex((c) => c.id === id);
      if (index < 0) return false;
      connections.splice(index, 1);
      return true;
    },
    async updateDevice(id, patch: DevicePatch) {
      calls.push(`updateDevice:${id}`);
      const index = devices.findIndex((d) => d.id === id);
      const current = devices[index];
      if (!current) throw new Error(`device ${id} does not exist`);
      const { retiredAt, pv, ...rest } = patch;
      const next: DeviceRecord = {
        ...current,
        ...(Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined),
        ) as Partial<DeviceRecord>),
        ...pv,
        ...(retiredAt !== undefined ? { retiredAt } : {}),
      };
      devices[index] = next;
      return next;
    },
  };
  const coded = over.coded ?? CODED;
  const deps: DeviceAdminDeps = {
    store,
    profileName: async (id) => known[id] ?? null,
    coded: (id) => coded[id] ?? null,
    primarySlug: () => (over.primarySlug === undefined ? "inverter" : over.primarySlug),
    reload: async () => {
      calls.push("reload");
    },
  };
  return { deps, calls, connections, devices, batteries };
}

/**
 * The coded tier as the route hands it over (`./coded.ts`): a declaration per
 * `profile_id`, with the name the roster shows for a device that has no
 * installed profile and never will.
 */
const CODED: Record<string, { integration: string; name?: string; addable?: boolean }> = {
  "evcc-loadpoint": { integration: "evcc", name: "EVCC loadpoint", addable: true },
  "sunreye.optimizer": { integration: "optimizer", name: "SunReye Optimizer" },
};

/** An EVCC loadpoint: fed over MQTT, so no gateway, no unit and no profile row. */
const loadpoint: DeviceRecord = {
  ...inverter,
  id: 4,
  slug: "evcc-loadpoint-1",
  name: "Carport",
  profileId: "evcc-loadpoint",
  role: "charger",
  unitId: 0,
  connectionId: null,
};

/** The optimizer: a virtual device, no machine behind it at all. */
const optimizer: DeviceRecord = {
  ...inverter,
  id: 5,
  slug: "optimizer",
  name: "Optimizer",
  profileId: "sunreye.optimizer",
  role: "optimizer",
  unitId: 0,
  connectionId: null,
};

const pack: DeviceBattery = { usableKwh: 10, maxChargeW: 5000, minSoc: 10, nominalV: 51.2 };

const meterInput = {
  connection: { id: 3 },
  role: "meter",
  unitId: 2,
  name: "Meter",
  profileId: "sdm630",
} as const;

async function rejection(run: () => Promise<unknown>): Promise<DeviceAdminError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DeviceAdminError) return error;
    throw error;
  }
  throw new Error("expected a DeviceAdminError");
}

describe("listDevices", () => {
  test("joins each device to its connection and profile, and names the state of each", async () => {
    const { deps } = harness({
      devices: [
        inverter,
        {
          ...inverter,
          id: 2,
          slug: "meter",
          name: "Meter",
          role: "meter",
          unitId: 2,
          profileId: "sdm630",
        },
        {
          ...inverter,
          id: 3,
          slug: "sim",
          connectionId: null,
          profileId: "vanished",
          retiredAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    });
    const view = await listDevices(deps);
    expect(view.connections).toEqual([gateway]);
    expect(
      view.devices.map((d) => [
        d.slug,
        d.kind,
        d.state,
        d.profileName,
        d.profileKnown,
        d.connection?.id ?? null,
      ]),
    ).toEqual([
      ["inverter", "modbus", "polling", "Deye SUN-15K", true, 3],
      ["meter", "modbus", "idle", "Eastron SDM630", true, 3],
      ["sim", "modbus", "retired", null, false, null],
    ]);
    // Retirement is carried through as an ISO string, never dropped.
    expect(view.devices[2]?.retiredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(view.devices[0]?.retiredAt).toBeNull();
  });

  test("with no plant there are no devices and no connections — not an error", async () => {
    const { deps } = harness({ plant: null });
    expect(await listDevices(deps)).toEqual({ devices: [], connections: [] });
  });

  test("nothing polls when the registry has no primary", async () => {
    const { deps } = harness({ primarySlug: null });
    const view = await listDevices(deps);
    expect(view.devices.every((d) => d.state === "idle")).toBe(true);
  });

  // #213: the loadpoint and the optimizer landed under "No connection", badged
  // "Not polled" with a Modbus release-limit hint, flagged red for a profile
  // that is not installed and never will be, and offering Edit and Retire. All
  // four are this shape being reported as a Modbus device that is not answering.
  // Renamed from `integration` in the release that made integrations ROWS of
  // their own: the word named this device's state AND the thing hanging off the
  // connection it sits under, in one list, and "integration" on a loadpoint gave
  // the operator no way to tell which of the two was meant.
  test("a coded device is PROVIDED by something, not an unpolled Modbus device", async () => {
    const { deps } = harness({ devices: [inverter, loadpoint] });
    const view = await listDevices(deps);
    const row = view.devices[1]!;
    expect([row.kind, row.state]).toEqual(["coded", "provided"]);
    // The declaration is what answers for the name, so the row is not red: the
    // profile store has never heard of `evcc-loadpoint` and never will.
    expect(row.profileName).toBe("EVCC loadpoint");
    expect(row.profileKnown).toBe(true);
    expect(row.integration).toBe("evcc");
  });

  test("the optimizer is virtual — coded as well, and virtual wins", async () => {
    const { deps } = harness({ devices: [inverter, optimizer] });
    const row = (await listDevices(deps)).devices[1]!;
    expect([row.kind, row.state]).toEqual(["virtual", "virtual"]);
    expect(row.profileName).toBe("SunReye Optimizer");
    expect(row.profileKnown).toBe(true);
    expect(row.integration).toBe("optimizer");
  });

  test("a retired coded device reads retired, not integration", async () => {
    const { deps } = harness({
      devices: [inverter, { ...loadpoint, retiredAt: new Date("2026-01-01T00:00:00Z") }],
    });
    const row = (await listDevices(deps)).devices[1]!;
    expect(row.kind).toBe("coded");
    expect(row.state).toBe("retired");
  });

  test("a device whose profile id is neither installed nor coded stays unknown", async () => {
    const { deps } = harness({ devices: [{ ...inverter, profileId: "vanished" }] });
    const row = (await listDevices(deps)).devices[0]!;
    expect(row.kind).toBe("modbus");
    expect(row.profileName).toBeNull();
    expect(row.profileKnown).toBe(false);
    expect(row.integration).toBeNull();
  });
});

describe("addDevice", () => {
  test("on an existing connection: validates, inserts the device, reloads once", async () => {
    const { deps, calls } = harness();
    const created = await addDevice(deps, meterInput);
    expect(created.slug).toBe("meter");
    expect(created.connectionId).toBe(3);
    // The Modbus endpoint moved into `params` (#217); `polled` became the state
    // enum (#213). Both halves of the row are asserted, one from each.
    expect(created.connection?.params).toEqual(modbusParams());
    expect(created.state).toBe("idle");
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
    expect(calls.indexOf("createDevice")).toBeLessThan(calls.indexOf("reload"));
    expect(calls).not.toContain("createConnection");
  });

  test("with a new connection: the connection is created FIRST and the device bound to it", async () => {
    const { deps, calls, connections } = harness();
    const created = await addDevice(deps, {
      ...meterInput,
      connection: {
        create: {
          name: "Gateway 2",
          kind: "modbus",
          params: {
            host: "10.0.0.9",
            port: 8899,
            transport: "rtu-over-tcp",
            timeoutMs: 3000,
            pollIntervalMs: 2000,
          },
        },
      },
    });
    expect(connections).toHaveLength(2);
    expect(created.connectionId).toBe(connections[1]?.id ?? null);
    expect(created.connection?.kind === "modbus" && created.connection.params.transport).toBe(
      "rtu-over-tcp",
    );
    expect(calls.indexOf("createConnection")).toBeLessThan(calls.indexOf("createDevice"));
  });

  test("unit id 0 is allowed — many gateways answer a single device on it", async () => {
    const { deps } = harness();
    const created = await addDevice(deps, { ...meterInput, unitId: 0 });
    expect(created.unitId).toBe(0);
  });

  test("the slug is derived from the name the way provisioning derives it", async () => {
    const { deps } = harness();
    const created = await addDevice(deps, { ...meterInput, name: "Zähler Süd  (Keller)" });
    expect(created.slug).toBe("zahler-sud-keller");
    expect(created.name).toBe("Zähler Süd  (Keller)");
  });

  test.each([
    ["an unknown role", { role: "toaster" }, /role/],
    ["the optimizer — virtual, never user-added", { role: "optimizer" }, /role/],
    ["unit id -1", { unitId: -1 }, /unit id/i],
    ["unit id 248", { unitId: 248 }, /unit id/i],
    ["a fractional unit id", { unitId: 1.5 }, /unit id/i],
    ["a blank name", { name: "   " }, /name/],
    ["a name that slugs to nothing", { name: "!!!" }, /name/],
    ["a name longer than the slug ceiling", { name: "x".repeat(49) }, /name/],
    ["a profile that is not registered", { profileId: "nope" }, /profile/],
    ["a connection of another plant", { connection: { id: 99 } }, /connection/],
    [
      "a connection with a blank host",
      {
        connection: {
          create: {
            name: "G",
            kind: "modbus",
            params: {
              host: "  ",
              port: 502,
              transport: "tcp",
              timeoutMs: 2000,
              pollIntervalMs: 1000,
            },
          },
        },
      },
      /host/,
    ],
  ] as const)(
    "refuses %s with 400, writes nothing and never reloads",
    async (_label, over, reason) => {
      const { deps, calls } = harness();
      const error = await rejection(() => addDevice(deps, { ...meterInput, ...over } as never));
      expect(error.status).toBe(400);
      expect(error.message).toMatch(reason);
      expect(calls).not.toContain("createDevice");
      expect(calls).not.toContain("createConnection");
      expect(calls).not.toContain("reload");
    },
  );

  test("a body that is not an object is a 400 too", async () => {
    const { deps } = harness();
    const error = await rejection(() => addDevice(deps, "nope"));
    expect(error.status).toBe(400);
  });

  test("a duplicate (connection, unit id) is a 409 naming the unit id", async () => {
    const { deps, calls } = harness({
      createDevice: async () => {
        throw violation("devices_connection_unit_key");
      },
    });
    const error = await rejection(() => addDevice(deps, meterInput));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/unit id/i);
    expect(error.field).toBe("unitId");
    expect(calls).not.toContain("reload");
  });

  test("a duplicate slug is a 409 naming the name", async () => {
    const { deps } = harness({
      createDevice: async () => {
        throw violation("devices_plant_slug_key");
      },
    });
    const error = await rejection(() => addDevice(deps, meterInput));
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/name/i);
    expect(error.field).toBe("name");
  });

  test("any other failure propagates untouched — a 500 is honest about a broken database", async () => {
    const boom = new Error("connection refused");
    const { deps } = harness({
      createDevice: async () => {
        throw boom;
      },
    });
    await expect(addDevice(deps, meterInput)).rejects.toBe(boom);
  });

  test("with no plant the add is refused — there is nothing to hang a device on", async () => {
    const { deps } = harness({ plant: null });
    const error = await rejection(() => addDevice(deps, meterInput));
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/plant/);
  });
});

/**
 * The add contract as a TIER UNION (`via`) — the seam #79–#81 needs.
 *
 * What is proven here is that the three tiers are three SHAPES, not one shape
 * with optional halves: a Modbus body still validates its slave id, a coded
 * body needs no slave id at all and carries its integration's settings, and the
 * mapping tier is declared and refused rather than absent.
 */
describe("addDevice: the tier union", () => {
  /** An EVCC loadpoint as the wizard would add it: a broker, no slave id. */
  const codedInput = {
    via: "coded",
    connection: { id: 5 },
    role: "charger",
    name: "Carport",
    profileId: "evcc-loadpoint",
    params: { topicRoot: "evcc" },
  } as const;

  const withBroker = () => harness({ connections: [gateway, broker] });

  test("a body with NO `via` is the profile tier — the shipped dialog keeps working", async () => {
    const { deps, devices } = harness();
    const created = await addDevice(deps, meterInput);
    expect(created.slug).toBe("meter");
    expect(created.unitId).toBe(2);
    expect(created.kind).toBe("modbus");
    expect(devices.at(-1)?.profileId).toBe("sdm630");
  });

  test('`via: "profile"` explicit adds exactly the same row', async () => {
    const { deps } = harness();
    const implicit = await addDevice(deps, { ...meterInput, name: "Meter A" });
    const explicit = await addDevice(deps, { ...meterInput, via: "profile", name: "Meter B" });
    const shape = ({ id: _id, slug: _slug, name: _name, ...rest }: typeof implicit) => rest;
    expect(shape(explicit)).toEqual(shape(implicit));
  });

  test('`via: "coded"` adds a row, names it from the declaration and writes params', async () => {
    const { deps, devices, calls } = withBroker();
    const created = await addDevice(deps, codedInput);
    expect(created.slug).toBe("carport");
    expect(created.kind).toBe("coded");
    expect(created.integration).toBe("evcc");
    // The name comes from `./coded.ts`'s declaration: there is no profile row.
    expect(created.profileName).toBe("EVCC loadpoint");
    expect(created.profileKnown).toBe(true);
    expect(devices.at(-1)?.params).toEqual({ topicRoot: "evcc" });
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("a coded body needs no unit id — a loadpoint has no slave", async () => {
    const { deps } = withBroker();
    const { unitId: _unused, ...rest } = { ...codedInput, unitId: undefined };
    const created = await addDevice(deps, rest);
    expect(created.unitId).toBe(0);
  });

  test("a coded body MAY carry an index, and it lands in unit id", async () => {
    const { deps } = withBroker();
    const created = await addDevice(deps, { ...codedInput, unitId: 3 });
    expect(created.unitId).toBe(3);
  });

  test("params are optional on a coded body", async () => {
    const { deps, devices } = withBroker();
    const { params: _params, ...noParams } = codedInput;
    await addDevice(deps, noParams);
    expect(devices.at(-1)?.params).toEqual({});
  });

  test("the optimizer provisions itself — adding one by hand is a 409", async () => {
    const { deps, calls } = withBroker();
    const error = await rejection(() =>
      addDevice(deps, { ...codedInput, role: "meter", profileId: "sunreye.optimizer" }),
    );
    expect(error.status).toBe(409);
    expect(error.field).toBe("profileId");
    expect(calls).not.toContain("createDevice");
    expect(calls).not.toContain("reload");
  });

  test('`via: "coded"` with a PROFILE id is a 400 — the tiers do not overlap', async () => {
    const { deps, calls } = withBroker();
    const error = await rejection(() => addDevice(deps, { ...codedInput, profileId: "sdm630" }));
    expect(error.status).toBe(400);
    expect(error.field).toBe("profileId");
    expect(calls).not.toContain("createDevice");
  });

  test('`via: "profile"` with a CODED id is a 400 — the same rule the other way', async () => {
    const { deps, calls } = harness();
    const error = await rejection(() =>
      addDevice(deps, { ...meterInput, via: "profile", profileId: "evcc-loadpoint" }),
    );
    expect(error.status).toBe(400);
    expect(error.field).toBe("profileId");
    expect(calls).not.toContain("createDevice");
  });

  test('`via: "mapping"` is declared and refused — the tier does not exist yet', async () => {
    const { deps, calls } = harness();
    const error = await rejection(() => addDevice(deps, { ...meterInput, via: "mapping" }));
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/mapping tier/i);
    expect(error.message).toMatch(/yet/i);
    expect(calls).not.toContain("createDevice");
    expect(calls).not.toContain("reload");
  });

  test("an unknown tier is a 400 naming `via`", async () => {
    const { deps } = harness();
    const error = await rejection(() => addDevice(deps, { ...meterInput, via: "telepathy" }));
    expect(error.status).toBe(400);
    expect(error.field).toBe("via");
  });

  test.each([
    ["-1", -1],
    ["248", 248],
    ["a fraction", 1.5],
  ] as const)("the profile arm still refuses unit id %s", async (_label, unitId) => {
    const { deps, calls } = harness();
    const error = await rejection(() =>
      addDevice(deps, { ...meterInput, via: "profile", unitId } as never),
    );
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/unit id/i);
    expect(calls).not.toContain("createDevice");
  });

  test("the profile arm still REQUIRES a unit id", async () => {
    const { deps } = harness();
    const { unitId: _unitId, ...noUnit } = meterInput;
    const error = await rejection(() => addDevice(deps, { ...noUnit, via: "profile" }));
    expect(error.status).toBe(400);
    expect(error.message).toMatch(/unit id/i);
  });

  test("a coded index may not be negative — it is an index, not a slave id", async () => {
    const { deps } = withBroker();
    const error = await rejection(() => addDevice(deps, { ...codedInput, unitId: -1 }));
    expect(error.status).toBe(400);
    expect(error.field).toBe("unitId");
  });

  test("a coded index is NOT capped at the Modbus ceiling", async () => {
    const { deps } = withBroker();
    const created = await addDevice(deps, { ...codedInput, unitId: 248 });
    expect(created.unitId).toBe(248);
  });

  test.each([
    ["null", null],
    ["a list", []],
    ["a scalar", 7],
    ["a string", "topicRoot=evcc"],
  ] as const)("params that are %s are refused — an integration reads keys", async (_l, params) => {
    const { deps, calls } = withBroker();
    const error = await rejection(() => addDevice(deps, { ...codedInput, params } as never));
    expect(error.status).toBe(400);
    expect(error.field).toBe("params");
    expect(calls).not.toContain("createDevice");
  });

  test("a coded add is refused before any write when the connection is not the plant's", async () => {
    const { deps, calls } = withBroker();
    const error = await rejection(() => addDevice(deps, { ...codedInput, connection: { id: 99 } }));
    expect(error.status).toBe(400);
    expect(error.field).toBe("connection");
    expect(calls).not.toContain("createDevice");
  });

  test.each([
    ["devices_plant_slug_key", "name"],
    ["devices_connection_unit_key", "unitId"],
  ] as const)("a coded add keeps the %s refusal", async (constraint, field) => {
    const { deps } = harness({
      connections: [gateway, broker],
      createDevice: async () => {
        throw violation(constraint);
      },
    });
    const error = await rejection(() => addDevice(deps, codedInput));
    expect(error.status).toBe(409);
    expect(error.field).toBe(field);
  });
});

describe("patchDevice", () => {
  test("renames, and reloads so the registry sees the new name", async () => {
    const { deps, calls } = harness();
    const updated = await patchDevice(deps, 1, { name: "Dach" });
    expect(updated.name).toBe("Dach");
    expect(calls).toContain("updateDevice:1");
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("retires a device that is not the one being polled", async () => {
    const meter = { ...inverter, id: 2, slug: "meter", role: "meter", unitId: 2 };
    const { deps, devices } = harness({ devices: [inverter, meter] });
    const updated = await patchDevice(deps, 2, { retired: true });
    expect(updated.retiredAt).not.toBeNull();
    expect(devices[1]?.retiredAt).toBeInstanceOf(Date);
  });

  test("refuses to retire the polled device with 409 — that would silence the plant", async () => {
    const { deps, calls } = harness();
    const error = await rejection(() => patchDevice(deps, 1, { retired: true }));
    expect(error.status).toBe(409);
    expect(calls).not.toContain("updateDevice:1");
    expect(calls).not.toContain("reload");
  });

  // #213: `formFromDevice` seeds the FIRST gateway for an endpoint-less device,
  // so saving an untouched edit of a loadpoint or the optimizer sent
  // `connectionId` and bound a device with no registers to a Modbus gateway.
  // The refusal behind that is now per-FIELD (#219): topology is frozen on a row
  // no operator addresses, but its label, its lifecycle and its integration
  // settings are theirs to change.
  test("renames a coded device", async () => {
    const { deps, calls, devices } = harness({ devices: [inverter, loadpoint] });
    const updated = await patchDevice(deps, 4, { name: "Carport left" });
    expect(updated.name).toBe("Carport left");
    expect(devices[1]?.name).toBe("Carport left");
    expect(calls).toContain("updateDevice:4");
    expect(calls).toContain("reload");
  });

  test("retires a coded device", async () => {
    const { deps, devices } = harness({ devices: [inverter, loadpoint] });
    const updated = await patchDevice(deps, 4, { retired: true });
    expect(updated.retiredAt).not.toBeNull();
    expect(devices[1]?.retiredAt).toBeInstanceOf(Date);
  });

  test("writes a coded device's integration settings, whole", async () => {
    const carport = { ...loadpoint, params: { topicRoot: "evcc", stale: true } };
    const { deps, devices } = harness({ devices: [inverter, carport] });
    const updated = await patchDevice(deps, 4, { params: { topicRoot: "evcc-garage" } });
    // A PATCH REPLACES the document — the dropped key is gone, not merged over.
    expect(updated.params).toEqual({ topicRoot: "evcc-garage" });
    expect(devices[1]?.params).toEqual({ topicRoot: "evcc-garage" });
  });

  test("accepts params on a Modbus device too", async () => {
    const { deps, devices } = harness();
    const updated = await patchDevice(deps, 1, { params: { note: "roof" } });
    expect(updated.params).toEqual({ note: "roof" });
    expect(devices[0]?.params).toEqual({ note: "roof" });
  });

  test("renames and retires the virtual optimizer", async () => {
    const { deps, devices } = harness({ devices: [inverter, optimizer] });
    expect((await patchDevice(deps, 5, { name: "Brain" })).name).toBe("Brain");
    expect((await patchDevice(deps, 5, { retired: true })).retiredAt).not.toBeNull();
    expect(devices[1]?.name).toBe("Brain");
  });

  test.each([
    ["connectionId", { connectionId: 3 }],
    ["unitId", { unitId: 2 }],
    ["profileId", { profileId: "deye-sun15k" }],
    ["role", { role: "meter" }],
    ["arrays", { arrays: [{ kwp: 5, tilt: 25, azimuth: 0 }] }],
    ["tempCoefficient", { tempCoefficient: -0.3 }],
    ["systemLoss", { systemLoss: 12 }],
    ["battery", { battery: null }],
  ] as const)("refuses %s on a coded device with 409, naming the field", async (field, patch) => {
    const { deps, calls } = harness({ devices: [inverter, loadpoint] });
    const error = await rejection(() => patchDevice(deps, 4, patch));
    expect(error.status).toBe(409);
    expect(error.field).toBe(field);
    expect(calls).not.toContain("updateDevice:4");
    expect(calls).not.toContain("reload");
  });

  test.each([
    ["connectionId", { connectionId: 3 }],
    ["unitId", { unitId: 2 }],
    ["profileId", { profileId: "deye-sun15k" }],
    ["role", { role: "meter" }],
    ["arrays", { arrays: [{ kwp: 5, tilt: 25, azimuth: 0 }] }],
    ["tempCoefficient", { tempCoefficient: -0.3 }],
    ["systemLoss", { systemLoss: 12 }],
    ["battery", { battery: null }],
  ] as const)("refuses %s on the virtual optimizer with 409", async (field, patch) => {
    const { deps, calls } = harness({ devices: [inverter, optimizer] });
    const error = await rejection(() => patchDevice(deps, 5, patch));
    expect(error.status).toBe(409);
    expect(error.field).toBe(field);
    expect(calls).not.toContain("updateDevice:5");
  });

  test("restores a retired device", async () => {
    const retired = {
      ...inverter,
      id: 2,
      slug: "meter",
      role: "meter",
      unitId: 2,
      retiredAt: new Date(),
    };
    const { deps } = harness({ devices: [inverter, retired] });
    const updated = await patchDevice(deps, 2, { retired: false });
    expect(updated.retiredAt).toBeNull();
  });

  test("a device the plant does not have is a 404", async () => {
    const { deps } = harness();
    const error = await rejection(() => patchDevice(deps, 42, { name: "x" }));
    expect(error.status).toBe(404);
  });

  test("re-points the driver, the address and the gateway in one patch", async () => {
    const other: ConnectionRecord = {
      ...gateway,
      id: 4,
      name: "Gateway 2",
      kind: "modbus",
      params: modbusParams({ host: "10.0.0.9" }),
    };
    const meter = { ...inverter, id: 2, slug: "meter", role: "meter", unitId: 2 };
    const { deps, devices } = harness({
      connections: [gateway, other],
      devices: [inverter, meter],
    });
    const updated = await patchDevice(deps, 2, {
      profileId: "deye-sun15k",
      unitId: 7,
      connectionId: 4,
      role: "charger",
    });
    expect(updated.profileId).toBe("deye-sun15k");
    expect(updated.unitId).toBe(7);
    expect(updated.connectionId).toBe(4);
    expect(updated.connection?.kind === "modbus" && updated.connection.params.host).toBe(
      "10.0.0.9",
    );
    expect(updated.role).toBe("charger");
    expect(devices[1]?.slug).toBe("meter"); // the slug never moves
  });

  test.each([
    ["a profile that is not installed", { profileId: "nope" }, 400],
    ["a connection of another plant", { connectionId: 99 }, 400],
    ["unit id 248", { unitId: 248 }, 400],
    ["the optimizer role", { role: "optimizer" }, 400],
  ] as const)("refuses %s", async (_label, patch, status) => {
    const { deps, calls } = harness();
    const error = await rejection(() => patchDevice(deps, 1, patch));
    expect(error.status).toBe(status);
    expect(calls.some((c) => c.startsWith("updateDevice"))).toBe(false);
  });

  test("a unit id already taken on the target gateway is a 409 under unitId", async () => {
    const meter = { ...inverter, id: 2, slug: "meter", role: "meter", unitId: 2 };
    const { deps } = harness({ devices: [inverter, meter] });
    // The engine raises; the service names the field.
    deps.store.updateDevice = async () => {
      throw violation("devices_connection_unit_key");
    };
    const error = await rejection(() => patchDevice(deps, 2, { unitId: 1 }));
    expect(error.status).toBe(409);
    expect(error.field).toBe("unitId");
  });

  test.each([
    ["a blank name", { name: " " }],
    ["a name over the slug ceiling", { name: "x".repeat(49) }],
    ["an empty patch", {}],
    ["a non-object body", "nope"],
  ])("refuses %s with 400", async (_label, patch) => {
    const { deps, calls } = harness();
    const error = await rejection(() => patchDevice(deps, 1, patch));
    expect(error.status).toBe(400);
    expect(calls.some((c) => c.startsWith("updateDevice"))).toBe(false);
  });

  test("an empty patch says nothing to change", async () => {
    const { deps } = harness();
    expect((await rejection(() => patchDevice(deps, 1, {}))).message).toContain(
      "nothing to change",
    );
  });

  // `params` is a DOCUMENT. A scalar, a null or a list is a caller that thinks it
  // is something else, and silently storing it would hand the integration a bag
  // it cannot read.
  test.each([
    ["null", null],
    ["a list", []],
    ["a string", "x"],
  ])("refuses params that are %s with 400 under params", async (_label, params) => {
    const { deps, calls } = harness();
    const error = await rejection(() => patchDevice(deps, 1, { params }));
    expect(error.status).toBe(400);
    expect(error.field).toBe("params");
    expect(calls.some((c) => c.startsWith("updateDevice"))).toBe(false);
  });
});

describe("patchConnection", () => {
  test("edits the endpoint in place and reloads — every device on it follows", async () => {
    const { deps, calls } = harness();
    const updated = await patchConnection(deps, 3, {
      params: {
        host: "10.0.0.9",
        port: 502,
        transport: "rtu-over-tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      },
    });
    expect(updated.id).toBe(3);
    expect(updated.kind === "modbus" && updated.params.host).toBe("10.0.0.9");
    expect(calls).toContain("updateConnection:3");
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("renaming alone touches nothing else", async () => {
    const { deps } = harness();
    const updated = await patchConnection(deps, 3, { name: "Cellar gateway" });
    expect(updated.name).toBe("Cellar gateway");
    expect(updated.params).toEqual(modbusParams());
  });

  test("the row's OWN kind may be echoed back — the dialog round-trips the record", async () => {
    const { deps } = harness();
    const updated = await patchConnection(deps, 3, { kind: "modbus", name: "Same kind" });
    expect(updated.kind).toBe("modbus");
  });

  test("a DIFFERENT kind is refused with 409 under `kind`, and nothing is written", async () => {
    // Every device bound to this row was provisioned for its tier: a Modbus
    // slave id means nothing on a broker, and re-kinding in place would leave
    // them addressed for a bus that no longer exists while their history stays
    // keyed to them.
    const { deps, calls } = harness();
    const error = await rejection(() =>
      patchConnection(deps, 3, { kind: "mqtt", params: { brokerUrl: "mqtt://x:1883" } }),
    );
    expect(error.status).toBe(409);
    expect(error.field).toBe("kind");
    expect(calls.some((c) => c.startsWith("updateConnection"))).toBe(false);
  });

  test("params are validated against the ROW's kind, not the body's", async () => {
    // A Modbus row sent broker params is a 400: the arm cannot be chosen from
    // the body, or a write could smuggle credentials onto a gateway.
    const { deps } = harness();
    const error = await rejection(() =>
      patchConnection(deps, 3, { params: { brokerUrl: "mqtt://x:1883" } }),
    );
    expect(error.status).toBe(400);
  });

  test("a broker keeps its password when the write omits one — the masking round trip", async () => {
    const { deps, connections } = harness({ connections: [gateway, broker] });
    const updated = await patchConnection(deps, 5, {
      params: { brokerUrl: "mqtt://moved:1883", username: "mqtt" },
    });
    // The ANSWER is masked; the STORED row is what kept the password.
    expect(updated.kind === "mqtt" && updated.params).toEqual({
      brokerUrl: "mqtt://moved:1883",
      username: "mqtt",
      hasPassword: true,
    });
    expect(connections.find((c) => c.id === 5)?.params).toMatchObject({ password: "secret" });
  });

  test("a connection the plant does not have is a 404", async () => {
    const { deps } = harness();
    const error = await rejection(() => patchConnection(deps, 99, { name: "x" }));
    expect(error.status).toBe(404);
  });

  test.each([
    ["a blank host", { params: { host: "  " } }],
    ["a port out of range", { params: { host: "h", port: 70000 } }],
    ["an unknown transport", { params: { host: "h", transport: "carrier-pigeon" } }],
    ["a cadence under the loop's floor", { params: { host: "h", pollIntervalMs: 10 } }],
    ["an empty patch", {}],
    ["a non-object body", "nope"],
  ])("refuses %s with 400 and writes nothing", async (_label, patch) => {
    const { deps, calls } = harness();
    const error = await rejection(() => patchConnection(deps, 3, patch));
    expect(error.status).toBe(400);
    expect(calls.some((c) => c.startsWith("updateConnection"))).toBe(false);
    expect(calls).not.toContain("reload");
  });
});

describe("removeConnection", () => {
  test("deletes an endpoint no device references and reloads", async () => {
    const spare = { ...gateway, id: 4, name: "Spare" };
    const { deps, calls, connections } = harness({ connections: [gateway, spare] });
    await removeConnection(deps, 4);
    expect(connections.map((c) => c.id)).toEqual([3]);
    expect(calls).toContain("deleteConnection:4");
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("refuses with 409 while ANY device — retired included — is still bound to it", async () => {
    const retired = { ...inverter, id: 2, slug: "old", unitId: 2, retiredAt: new Date() };
    const spare = { ...gateway, id: 4, name: "Spare" };
    const { deps, calls } = harness({
      connections: [gateway, spare],
      devices: [{ ...retired, connectionId: 4 }],
    });
    const error = await rejection(() => removeConnection(deps, 4));
    expect(error.status).toBe(409);
    expect(calls).not.toContain("deleteConnection:4");
    expect(calls).not.toContain("reload");
  });

  test("a connection the plant does not have is a 404", async () => {
    const { deps } = harness();
    const error = await rejection(() => removeConnection(deps, 99));
    expect(error.status).toBe(404);
  });
});

describe("an inverter's PV description and pack", () => {
  test("listDevices joins each inverter's pack and carries its arrays; a meter has neither", async () => {
    const meter = { ...inverter, id: 2, slug: "meter", role: "meter", unitId: 2 };
    const { deps } = harness({
      devices: [
        { ...inverter, arrays: [{ kwp: 9.8, tilt: 30, azimuth: 0 }], systemLoss: 11 },
        meter,
      ],
      batteries: [{ deviceId: 1, ...pack }],
    });
    const { devices } = await listDevices(deps);
    expect(devices[0]?.arrays).toEqual([{ kwp: 9.8, tilt: 30, azimuth: 0 }]);
    expect(devices[0]?.systemLoss).toBe(11);
    expect(devices[0]?.battery).toEqual(pack);
    expect(devices[1]?.arrays).toEqual([]);
    expect(devices[1]?.battery).toBeNull();
  });

  test("adding an inverter stores its arrays, physics and pack in one go", async () => {
    const { deps, batteries, calls } = harness();
    const created = await addDevice(deps, {
      ...meterInput,
      role: "inverter",
      name: "East",
      arrays: [{ kwp: 3.2, tilt: 20, azimuth: -90 }],
      tempCoefficient: -0.3,
      systemLoss: 20,
      battery: pack,
    });
    expect(created.arrays).toEqual([{ kwp: 3.2, tilt: 20, azimuth: -90 }]);
    expect(created.tempCoefficient).toBe(-0.3);
    expect(created.systemLoss).toBe(20);
    expect(created.battery).toEqual(pack);
    expect(batteries.map((b) => b.deviceId)).toEqual([created.id]);
    // The row exists before the pack that references it, and the reload comes last.
    expect(calls.indexOf("createDevice")).toBeLessThan(
      calls.indexOf(`upsertBattery:${created.id}`),
    );
    expect(calls.indexOf(`upsertBattery:${created.id}`)).toBeLessThan(calls.indexOf("reload"));
  });

  test("a patch re-describes the roof: only the named PV columns move", async () => {
    const { deps, devices } = harness({ devices: [{ ...inverter, systemLoss: 11 }] });
    const updated = await patchDevice(deps, 1, { arrays: [{ kwp: 5, tilt: 25, azimuth: 0 }] });
    expect(updated.arrays).toEqual([{ kwp: 5, tilt: 25, azimuth: 0 }]);
    expect(updated.systemLoss).toBe(11);
    expect(devices[0]?.tempCoefficient).toBe(-0.4);
  });

  test("the pack is three instructions: upsert, remove, leave alone", async () => {
    const { deps, batteries, calls } = harness({ batteries: [{ deviceId: 1, ...pack }] });
    const untouched = await patchDevice(deps, 1, { name: "Dach" });
    expect(untouched.battery).toEqual(pack);
    expect(calls.some((c) => c.startsWith("upsertBattery") || c.startsWith("deleteBattery"))).toBe(
      false,
    );

    const changed = await patchDevice(deps, 1, { battery: { ...pack, usableKwh: 12 } });
    expect(changed.battery?.usableKwh).toBe(12);
    expect(batteries[0]?.usableKwh).toBe(12);

    const removed = await patchDevice(deps, 1, { battery: null });
    expect(removed.battery).toBeNull();
    expect(batteries).toEqual([]);
  });

  test.each([
    ["arrays", { arrays: [{ kwp: 1, tilt: 1, azimuth: 0 }] }, /arrays/],
    ["a temperature coefficient", { tempCoefficient: -0.3 }, /tempCoefficient/],
    ["a pack", { battery: pack }, /battery/],
  ])(
    "a meter given %s is refused with 400 and nothing is written",
    async (_label, patch, reason) => {
      const meter = { ...inverter, id: 2, slug: "meter", role: "meter", unitId: 2 };
      const { deps, calls } = harness({ devices: [inverter, meter] });
      const error = await rejection(() => patchDevice(deps, 2, patch));
      expect(error.status).toBe(400);
      expect(error.message).toMatch(reason);
      expect(calls.some((c) => c.startsWith("updateDevice") || c.startsWith("upsertBattery"))).toBe(
        false,
      );
      const added = await rejection(() =>
        addDevice(deps, { ...meterInput, unitId: 9, name: "M2", ...patch }),
      );
      expect(added.status).toBe(400);
    },
  );

  test.each([
    ["a positive coefficient", { tempCoefficient: 0.4 }],
    ["losses over 90 %", { systemLoss: 95 }],
    [
      "a ninth array",
      { arrays: Array.from({ length: 9 }, () => ({ kwp: 1, tilt: 1, azimuth: 0 })) },
    ],
    ["a tilt of 400", { arrays: [{ kwp: 1, tilt: 400, azimuth: 0 }] }],
    ["a pack with no usable capacity", { battery: { usableKwh: 0 } }],
  ])("%s is refused by the same bounds the forecast schema applies", async (_label, patch) => {
    const { deps } = harness();
    const error = await rejection(() => patchDevice(deps, 1, patch));
    expect(error.status).toBe(400);
  });
});

describe("what leaves the server", () => {
  test("a broker's password is never in a listed connection", async () => {
    // `/api/connections` and the device roster both return connection rows, and
    // since #217 one of those rows can hold a broker credential. The masking
    // that used to live on `app_settings.mqtt` has to follow the secret.
    const { deps } = harness({ connections: [gateway, broker] });
    const roster = await listDevices(deps);
    expect(JSON.stringify(roster)).not.toContain("secret");
    const listed = roster.connections.find((c) => c.id === 5);
    expect(listed).toEqual({
      id: 5,
      name: "Home broker",
      kind: "mqtt",
      params: { brokerUrl: "mqtt://hass.lan:1883", username: "mqtt", hasPassword: true },
    });
  });

  test("a device's connection is masked too — it is the same row", async () => {
    const bound = { ...inverter, id: 9, slug: "loadpoint", role: "charger", connectionId: 5 };
    const { deps } = harness({ connections: [gateway, broker], devices: [bound] });
    const roster = await listDevices(deps);
    expect(JSON.stringify(roster.devices)).not.toContain("secret");
  });

  test("a modbus connection is unchanged by masking — it holds no secret", async () => {
    const { deps } = harness();
    const roster = await listDevices(deps);
    expect(roster.connections[0]).toEqual(gateway);
  });

  test("a PATCH answer is masked as well", async () => {
    const { deps } = harness({ connections: [gateway, broker] });
    const updated = await patchConnection(deps, 5, { name: "Renamed" });
    expect(JSON.stringify(updated)).not.toContain("secret");
    expect(updated.kind === "mqtt" && updated.params.hasPassword).toBe(true);
  });

  test("the STORED row keeps its password — only the answer is masked", async () => {
    const { deps, connections } = harness({ connections: [gateway, broker] });
    await patchConnection(deps, 5, { name: "Renamed" });
    expect(connections.find((c) => c.id === 5)?.params).toMatchObject({ password: "secret" });
  });
});

/**
 * A CONNECTION ON ITS OWN. `POST /api/devices` could only ever create one
 * ALONGSIDE a device (`connection: { create }`), which was enough while every
 * connection was a Modbus gateway with a slave on it — and is not enough for a
 * broker (#217). A broker has no device to be created with: the EVCC loadpoints
 * appear only once the ingest is bound to it and its first message arrives, and
 * the mapped devices that will sit on one are #79–#84.
 */
describe("addConnection", () => {
  test("creates the gateway a body describes and answers the masked row", async () => {
    const { deps, calls } = harness();
    const created = await addConnection(deps, {
      name: " Cellar ",
      kind: "modbus",
      params: { host: " 10.0.0.9 ", port: 8899 },
    });
    expect(created).toEqual({
      id: 100,
      name: "Cellar",
      kind: "modbus",
      params: {
        host: "10.0.0.9",
        port: 8899,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      },
    });
    // The runtime has to be told: an endpoint it does not know about is an
    // endpoint it never opens.
    expect(calls).toContain("reload");
  });

  test("creates a broker, and its password never leaves", async () => {
    const { deps, connections } = harness();
    const created = await addConnection(deps, {
      name: "Home broker",
      kind: "mqtt",
      params: { brokerUrl: "mqtt://hass.ee.lan:1883", username: "mqtt", password: "secret" },
    });
    expect(created).toEqual({
      id: 100,
      name: "Home broker",
      kind: "mqtt",
      params: { brokerUrl: "mqtt://hass.ee.lan:1883", username: "mqtt", hasPassword: true },
    });
    expect(JSON.stringify(created)).not.toContain("secret");
    // Stored, though — the masking is on the way out only.
    expect(connections.find((c) => c.id === 100)?.params).toMatchObject({ password: "secret" });
  });

  test.each([
    ["an unknown kind", { name: "X", kind: "http", params: { host: "10.0.0.9" } }],
    ["an empty name", { name: "  ", kind: "modbus", params: { host: "10.0.0.9" } }],
    ["a gateway with no host", { name: "X", kind: "modbus", params: {} }],
    ["a broker with no URL", { name: "X", kind: "mqtt", params: {} }],
    [
      "broker params on the modbus arm",
      { name: "X", kind: "modbus", params: { brokerUrl: "mqtt://x" } },
    ],
    ["no body at all", null],
  ])("refuses %s with a 400", async (_label, body) => {
    const { deps, calls } = harness();
    const error = await rejection(() => addConnection(deps, body));
    expect(error.status).toBe(400);
    expect(calls).not.toContain("createConnection");
  });

  test("an install with no plant is a 400, not a row on nothing", async () => {
    const { deps } = harness({ plant: null });
    const error = await rejection(() =>
      addConnection(deps, { name: "X", kind: "modbus", params: { host: "10.0.0.9" } }),
    );
    expect(error.status).toBe(400);
  });
});

describe("listConnections", () => {
  test("answers the plant's rows, masked", async () => {
    const { deps } = harness({ connections: [gateway, broker] });
    const { connections } = await listConnections(deps);
    expect(connections.map((c) => c.id)).toEqual([3, 5]);
    expect(JSON.stringify(connections)).not.toContain("secret");
  });

  test("an install with no plant has no connections, and does not throw", async () => {
    const { deps } = harness({ plant: null });
    expect(await listConnections(deps)).toEqual({ connections: [] });
  });
});
