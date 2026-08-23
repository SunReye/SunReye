import { describe, expect, test } from "bun:test";
import type { DeviceInsert, DeviceRow, SourceInsert, SourceRow } from "@SunReye/db/devices";
import { DEFAULT_SOURCE_ID } from "@SunReye/db/devices";
import type { InverterConfig } from "@SunReye/db/inverter-config";
import {
  defineProfile,
  hydrateProfile,
  metric,
  type InverterProfile,
} from "@SunReye/inverter-core";

import {
  activeProfileOrNull,
  createDeviceRegistry,
  profileInUse,
  setDeviceRegistry,
  type RegistryIo,
} from "./device-registry";

const profileOf = (id: string): InverterProfile =>
  hydrateProfile(
    defineProfile({
      id,
      name: id,
      manufacturer: "ACME",
      version: "1.0.0",
      metrics: [
        metric("battery/soc", {
          label: "SoC",
          group: "battery",
          unit: "%",
          addr: 588,
          role: "battery.soc",
        }),
      ],
    }),
  );

const CONFIG: InverterConfig = {
  host: "10.0.0.5",
  port: 502,
  transport: "tcp",
  unitId: 1,
  timeoutMs: 2000,
  pollIntervalMs: 1000,
};

const stamps = { createdAt: new Date(0), updatedAt: new Date(0) };

/** An in-memory registry backend: no database, no module mocking. */
function io(over: Partial<RegistryIo> & { profiles?: InverterProfile[] } = {}) {
  const sourceRows: SourceRow[] = [];
  const deviceRows: DeviceRow[] = [];
  const known = new Map((over.profiles ?? [profileOf("deye-sg05lp3")]).map((p) => [p.id, p]));
  const base: RegistryIo = {
    listSources: async () => sourceRows,
    listDevices: async () => deviceRows,
    insertSource: async (row: SourceInsert) => {
      sourceRows.push({ enabled: true, ...stamps, ...row } as SourceRow);
    },
    insertDevice: async (row: DeviceInsert) => {
      deviceRows.push({ enabled: true, ...stamps, ...row } as DeviceRow);
    },
    activeProfileId: async () => "deye-sg05lp3",
    inverterConfig: async () => CONFIG,
    resolveProfile: (id: string) => known.get(id),
  };
  return { sourceRows, deviceRows, io: { ...base, ...over } satisfies RegistryIo };
}

// An install that has been running for a year has no rows in either table and a
// year of readings addressed by its profile id. The seed is what makes the
// registry a rename rather than a migration.
describe("seeding an existing install", () => {
  test("the first device inherits the active profile's id", async () => {
    // Not a generated id: this exact string is already the `inverter_id` of
    // every row in metrics_raw — a physical compression segment key — and the
    // `sunreye_<id>` prefix of every Home Assistant entity ever registered.
    const { deviceRows, io: backend } = io();

    const registry = await createDeviceRegistry(backend);

    expect(registry.devices().map((d) => d.id)).toEqual(["deye-sg05lp3"]);
    expect(deviceRows).toHaveLength(1);
    expect(deviceRows[0]?.id).toBe("deye-sg05lp3");
  });

  test("the connection it was already using becomes its source", async () => {
    const { sourceRows, io: backend } = io();

    await createDeviceRegistry(backend);

    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]).toMatchObject({ id: DEFAULT_SOURCE_ID, kind: "modbus" });
    expect(sourceRows[0]?.config).toEqual(CONFIG);
  });

  test("the unit id moves from the connection to the device", async () => {
    // It always addressed a device within the connection rather than the
    // connection itself; two inverters on one gateway differ only by it.
    const { deviceRows, io: backend } = io();

    await createDeviceRegistry(backend);

    expect(deviceRows[0]?.address).toEqual({ unitId: 1 });
  });

  test("seeds once — a second boot adopts the rows instead of duplicating them", async () => {
    const { deviceRows, sourceRows, io: backend } = io();

    await createDeviceRegistry(backend);
    await createDeviceRegistry(backend);

    expect(deviceRows).toHaveLength(1);
    expect(sourceRows).toHaveLength(1);
  });

  test("a fresh install with no profile seeds nothing and boots empty", async () => {
    // Onboarding-only, exactly as before: the admin picks a profile in the UI.
    const { deviceRows, io: backend } = io({ activeProfileId: async () => null });

    const registry = await createDeviceRegistry(backend);

    expect(registry.devices()).toEqual([]);
    expect(registry.default()).toBeUndefined();
    expect(deviceRows).toEqual([]);
  });

  test("an active profile that is not installed seeds nothing", async () => {
    // The saved id names a profile this install no longer has. Writing a device
    // row for it would persist the broken state; today's boot warns and
    // degrades, and so does this.
    const { deviceRows, io: backend } = io({ activeProfileId: async () => "gone" });

    const registry = await createDeviceRegistry(backend);

    expect(registry.devices()).toEqual([]);
    expect(deviceRows).toEqual([]);
  });
});

describe("what the registry hands out", () => {
  test("each device carries its own decoded context, not a shared one", async () => {
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: { unitId: 1 },
        enabled: true,
        ...stamps,
      },
      {
        id: "b",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p2",
        deviceClass: "inverter",
        label: "B",
        address: { unitId: 2 },
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1"), profileOf("p2")],
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });

    const registry = await createDeviceRegistry(backend);

    const [a, b] = registry.devices();
    expect(a?.ctx.profile.id).toBe("p1");
    expect(b?.ctx.profile.id).toBe("p2");
    // Distinct objects: a shared manifest is how two devices end up rendering
    // as one.
    expect(a?.ctx).not.toBe(b?.ctx);
  });

  test("two devices can share one source", async () => {
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: { unitId: 1 },
        enabled: true,
        ...stamps,
      },
      {
        id: "b",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "B",
        address: { unitId: 2 },
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });

    const registry = await createDeviceRegistry(backend);

    expect(registry.devices().map((d) => d.source.id)).toEqual([
      DEFAULT_SOURCE_ID,
      DEFAULT_SOURCE_ID,
    ]);
    // The same connection object, because it is the same connection: one lock,
    // one socket, whatever the transport decides to do with that.
    expect(registry.devices()[0]?.source).toBe(registry.devices()[1]?.source);
  });

  test("a device whose profile is not installed is dropped, not guessed at", async () => {
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
      {
        id: "orphan",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "missing",
        deviceClass: "inverter",
        label: "O",
        address: {},
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });

    const registry = await createDeviceRegistry(backend);

    expect(registry.devices().map((d) => d.id)).toEqual(["a"]);
  });

  test("a device whose source is missing is dropped — there is nothing to dial", async () => {
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: "vanished",
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      listDevices: async () => rows,
      listSources: async () => [],
    });

    expect((await createDeviceRegistry(backend)).devices()).toEqual([]);
  });

  test("a disabled device is registered but not polled", async () => {
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
      {
        id: "off",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "Off",
        address: {},
        enabled: false,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });

    const registry = await createDeviceRegistry(backend);

    // Still in the registry — its history is still addressed by its id and the
    // UI still has to be able to name it.
    expect(registry.devices().map((d) => d.id)).toEqual(["a", "off"]);
    expect(registry.pollable().map((d) => d.id)).toEqual(["a"]);
  });

  test("a device of a disabled source is not polled either", async () => {
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: "off-source",
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: "off-source",
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: false,
          ...stamps,
        },
      ],
    });

    const registry = await createDeviceRegistry(backend);

    expect(registry.devices().map((d) => d.id)).toEqual(["a"]);
    expect(registry.pollable()).toEqual([]);
  });
});

// Ten call sites across routes, automations and the forecast asked the module
// global for "the inverter". They now ask the registry for its default device,
// and keep working unchanged until each is given a device of its own.
describe("the process-wide holder the old global became", () => {
  test("answers nothing before a registry is installed", () => {
    setDeviceRegistry(null);

    expect(activeProfileOrNull()).toBeNull();
    expect(profileInUse("deye-sg05lp3")).toBe(false);
  });

  test("answers the default device's profile once one is", async () => {
    setDeviceRegistry(await createDeviceRegistry(io().io));

    expect(activeProfileOrNull()?.id).toBe("deye-sg05lp3");

    setDeviceRegistry(null);
  });

  test("a profile is in use when any device needs it, not just the default one", async () => {
    // The uninstall guard used to compare against one active id. With two
    // devices, uninstalling the profile the *second* one decodes is just as
    // destructive, and nothing was checking it.
    const rows: DeviceRow[] = [
      {
        id: "a",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
      {
        id: "b",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p2",
        deviceClass: "inverter",
        label: "B",
        address: {},
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1"), profileOf("p2")],
      activeProfileId: async () => "a",
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });
    setDeviceRegistry(await createDeviceRegistry(backend));

    expect(profileInUse("p1")).toBe(true);
    expect(profileInUse("p2")).toBe(true);
    expect(profileInUse("p3")).toBe(false);

    setDeviceRegistry(null);
  });

  test("a disabled device still holds its profile in use", async () => {
    // Disabled means "not polled", not "gone". Uninstalling the profile out
    // from under it would make it unresolvable on the next boot.
    const rows: DeviceRow[] = [
      {
        id: "off",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "Off",
        address: {},
        enabled: false,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });
    setDeviceRegistry(await createDeviceRegistry(backend));

    expect(profileInUse("p1")).toBe(true);

    setDeviceRegistry(null);
  });
});

describe("the default device", () => {
  test("is the one the active-profile setting names", async () => {
    const rows: DeviceRow[] = [
      {
        id: "second",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p2",
        deviceClass: "inverter",
        label: "B",
        address: {},
        enabled: true,
        ...stamps,
      },
      {
        id: "p1",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1"), profileOf("p2")],
      activeProfileId: async () => "p1",
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });

    const registry = await createDeviceRegistry(backend);

    // Every single-device caller still resolves to the device it always meant,
    // whatever order the rows came back in.
    expect(registry.default()?.id).toBe("p1");
  });

  test("falls back to the first device when the setting names none of them", async () => {
    const rows: DeviceRow[] = [
      {
        id: "only",
        sourceId: DEFAULT_SOURCE_ID,
        profileId: "p1",
        deviceClass: "inverter",
        label: "A",
        address: {},
        enabled: true,
        ...stamps,
      },
    ];
    const { io: backend } = io({
      profiles: [profileOf("p1")],
      activeProfileId: async () => "unrelated",
      listDevices: async () => rows,
      listSources: async () => [
        {
          id: DEFAULT_SOURCE_ID,
          kind: "modbus",
          label: "Bus",
          config: CONFIG,
          enabled: true,
          ...stamps,
        },
      ],
    });

    expect((await createDeviceRegistry(backend)).default()?.id).toBe("only");
  });

  test("finds a device by id, and answers nothing for one it does not have", async () => {
    const registry = await createDeviceRegistry(io().io);

    expect(registry.get("deye-sg05lp3")?.id).toBe("deye-sg05lp3");
    expect(registry.get("nope")).toBeUndefined();
  });
});
