import { describe, expect, test } from "bun:test";
import type {
  ConnectionPatch,
  ConnectionRecord,
  DevicePatch,
  DeviceRecord,
} from "@SunReye/db/plant-repo";

import {
  type DeviceAdminDeps,
  type DeviceAdminStore,
  DeviceAdminError,
  addDevice,
  listDevices,
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

const gateway: ConnectionRecord = {
  id: 3,
  name: "Gateway 1",
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  timeoutMs: 2000,
  pollIntervalMs: 1000,
};

const inverter: DeviceRecord = {
  id: 1,
  slug: "inverter",
  name: "Inverter",
  profileId: "deye-sun15k",
  role: "inverter",
  unitId: 1,
  connectionId: 3,
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
    createDevice?: DeviceAdminStore["createDevice"];
  } = {},
) {
  const connections = [...(over.connections ?? [gateway])];
  const devices = [...(over.devices ?? [inverter])];
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
      const { retiredAt, ...rest } = patch;
      const next: DeviceRecord = {
        ...current,
        ...(Object.fromEntries(
          Object.entries(rest).filter(([, v]) => v !== undefined),
        ) as Partial<DeviceRecord>),
        ...(retiredAt !== undefined ? { retiredAt } : {}),
      };
      devices[index] = next;
      return next;
    },
  };
  const deps: DeviceAdminDeps = {
    store,
    profileName: async (id) => known[id] ?? null,
    primarySlug: () => (over.primarySlug === undefined ? "inverter" : over.primarySlug),
    reload: async () => {
      calls.push("reload");
    },
  };
  return { deps, calls, connections, devices };
}

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
  test("joins each device to its connection and profile, and marks the one that is polled", async () => {
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
        d.polled,
        d.profileName,
        d.profileKnown,
        d.connection?.id ?? null,
      ]),
    ).toEqual([
      ["inverter", true, "Deye SUN-15K", true, 3],
      ["meter", false, "Eastron SDM630", true, 3],
      ["sim", false, null, false, null],
    ]);
    // Retirement is carried through as an ISO string, never dropped.
    expect(view.devices[2]?.retiredAt).toBe("2026-01-01T00:00:00.000Z");
    expect(view.devices[0]?.retiredAt).toBeNull();
  });

  test("with no plant there are no devices and no connections — not an error", async () => {
    const { deps } = harness({ plant: null });
    expect(await listDevices(deps)).toEqual({ devices: [], connections: [] });
  });

  test("nothing is polled when the registry has no primary", async () => {
    const { deps } = harness({ primarySlug: null });
    const view = await listDevices(deps);
    expect(view.devices.every((d) => !d.polled)).toBe(true);
  });
});

describe("addDevice", () => {
  test("on an existing connection: validates, inserts the device, reloads once", async () => {
    const { deps, calls } = harness();
    const created = await addDevice(deps, meterInput);
    expect(created.slug).toBe("meter");
    expect(created.connectionId).toBe(3);
    expect(created.connection?.host).toBe("10.0.0.5");
    expect(created.polled).toBe(false);
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
          host: "10.0.0.9",
          port: 8899,
          transport: "rtu-over-tcp",
          timeoutMs: 3000,
          pollIntervalMs: 2000,
        },
      },
    });
    expect(connections).toHaveLength(2);
    expect(created.connectionId).toBe(connections[1]?.id ?? null);
    expect(created.connection?.transport).toBe("rtu-over-tcp");
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
            host: "  ",
            port: 502,
            transport: "tcp",
            timeoutMs: 2000,
            pollIntervalMs: 1000,
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
    const other = { ...gateway, id: 4, name: "Gateway 2", host: "10.0.0.9" };
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
    expect(updated.connection?.host).toBe("10.0.0.9");
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
});

describe("patchConnection", () => {
  test("edits the endpoint in place and reloads — every device on it follows", async () => {
    const { deps, calls } = harness();
    const updated = await patchConnection(deps, 3, { host: "10.0.0.9", transport: "rtu-over-tcp" });
    expect(updated.id).toBe(3);
    expect(updated.host).toBe("10.0.0.9");
    expect(calls).toContain("updateConnection:3");
    expect(calls.filter((c) => c === "reload")).toHaveLength(1);
  });

  test("a connection the plant does not have is a 404", async () => {
    const { deps } = harness();
    const error = await rejection(() => patchConnection(deps, 99, { host: "x" }));
    expect(error.status).toBe(404);
  });

  test.each([
    ["a blank host", { host: "  " }],
    ["a port out of range", { port: 70000 }],
    ["an unknown transport", { transport: "carrier-pigeon" }],
    ["a cadence under the loop's floor", { pollIntervalMs: 10 }],
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
