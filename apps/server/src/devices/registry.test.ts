import { describe, expect, test } from "bun:test";

import type { DeviceRecord } from "@SunReye/db/plant-repo";
import { deriveCapabilities } from "@SunReye/inverter-core";
import type { InverterProfile, MetricDef } from "@SunReye/inverter-core";

import { createDeviceRegistry } from "./registry";

function m(overrides: Partial<MetricDef> & { key: string }): MetricDef {
  return {
    topic: overrides.key.replaceAll(".", "/"),
    label: overrides.key,
    unit: null,
    group: "misc",
    type: "U_WORD",
    addresses: [0],
    binding: { via: "modbus", addr: [0], type: "U_WORD" },
    scale: 1,
    access: "r",
    ...overrides,
  } as MetricDef;
}

const deye: InverterProfile = {
  id: "deye-sg04lp3",
  name: "Deye",
  manufacturer: "Deye",
  metrics: [
    m({ key: "battery.soc", role: "battery.soc" }),
    m({ key: "grid.p", role: "grid.power" }),
  ],
};

/** A device row with everything but the exercised columns defaulted. */
function row(overrides: Partial<DeviceRecord> & { id: number; slug: string }): DeviceRecord {
  return {
    name: overrides.slug,
    profileId: deye.id,
    role: "inverter",
    unitId: 1,
    connectionId: 1,
    retiredAt: null,
    ...overrides,
  };
}

/** A registry over a mutable device list and a fixed profile shelf. */
function registryOver(
  devices: DeviceRecord[],
  profiles: InverterProfile[] = [deye],
  warnings: string[] = [],
) {
  return createDeviceRegistry({
    readDevices: async () => devices,
    resolveProfile: async (id) => profiles.find((p) => p.id === id) ?? null,
    logger: { warn: (template) => void warnings.push(template) },
  });
}

describe("the registry is keyed by the devices table", () => {
  test("one instance per non-retired row, roles resolved from its profile", async () => {
    const registry = registryOver([row({ id: 1, slug: "inverter-1" })]);
    await registry.reload();

    expect(registry.list().map((d) => d.id)).toEqual(["inverter-1"]);
    const instance = registry.get("inverter-1");
    expect(instance?.deviceClass).toBe("inverter");
    // Provenance only — nothing branches on it.
    expect(instance?.integration).toBe("profile");
    expect([...(instance?.roles.keys() ?? [])]).toEqual(["battery.soc", "grid.power"]);
    expect(deriveCapabilities(instance!).battery).toBe(true);
  });

  test("the instance is keyed by the device slug, never the profile id", async () => {
    const registry = registryOver([row({ id: 1, slug: "inverter-1" })]);
    await registry.reload();
    expect(registry.get(deye.id)).toBeUndefined();
    expect(registry.get("inverter-1")?.id).toBe("inverter-1");
  });

  test("a retired row is not registered", async () => {
    const registry = registryOver([
      row({ id: 1, slug: "gone", retiredAt: new Date("2026-01-01T00:00:00Z") }),
    ]);
    await registry.reload();
    expect(registry.list()).toEqual([]);
    expect(registry.get("gone")).toBeUndefined();
  });

  test("an empty device list is an empty registry, not a failure", async () => {
    const registry = registryOver([]);
    await registry.reload();
    expect(registry.list()).toEqual([]);
    expect(registry.primary()).toBeNull();
    expect(registry.profileIds()).toEqual([]);
  });

  test("two devices sharing one profile are two instances with the same roles", async () => {
    const registry = registryOver([
      row({ id: 1, slug: "inverter-1" }),
      row({ id: 2, slug: "inverter-2", connectionId: 2 }),
    ]);
    await registry.reload();

    const [first, second] = registry.list();
    expect([first?.id, second?.id]).toEqual(["inverter-1", "inverter-2"]);
    expect([...(first?.roles.keys() ?? [])]).toEqual([...(second?.roles.keys() ?? [])]);
    expect(deriveCapabilities(first!)).toEqual(deriveCapabilities(second!));
    // One profile, listed once: this is what the uninstall guard asks.
    expect(registry.profileIds()).toEqual([deye.id]);
  });

  test("a device whose profile is not installed is registered, bound to nothing", async () => {
    // `devices.profile_id` has NO foreign key on purpose (#169): a profile is
    // uninstallable while raw retention is five years, so a dangling id is a
    // legal state. The device stays visible and simply binds nothing.
    const registry = registryOver([row({ id: 1, slug: "inverter-1", profileId: "gone-vendor" })]);
    await registry.reload();

    const instance = registry.get("inverter-1");
    expect(instance?.roles.size).toBe(0);
    expect(instance?.metrics).toEqual([]);
    expect(registry.driverProfile("inverter-1")).toBeNull();
    expect(deriveCapabilities(instance!).battery).toBe(false);
  });

  test("a role outside the known classes is skipped, loudly", async () => {
    const warnings: string[] = [];
    const registry = registryOver(
      [row({ id: 1, slug: "odd", role: "teleporter" })],
      [deye],
      warnings,
    );
    await registry.reload();
    expect(registry.list()).toEqual([]);
    expect(warnings.length).toBe(1);
  });
});

describe("the registry reflects the table without a restart", () => {
  test("a device added after boot appears on the next reload", async () => {
    const devices = [row({ id: 1, slug: "inverter-1" })];
    const registry = registryOver(devices);
    await registry.reload();
    expect(registry.list().map((d) => d.id)).toEqual(["inverter-1"]);

    devices.push(row({ id: 2, slug: "optimizer", role: "optimizer", connectionId: null }));
    await registry.reload();
    expect(registry.list().map((d) => d.id)).toEqual(["inverter-1", "optimizer"]);
    expect(registry.get("optimizer")?.deviceClass).toBe("optimizer");
  });

  test("a device retired after boot disappears on the next reload", async () => {
    const devices = [row({ id: 1, slug: "inverter-1" }), row({ id: 2, slug: "inverter-2" })];
    const registry = registryOver(devices);
    await registry.reload();
    expect(registry.list().length).toBe(2);

    devices[1]!.retiredAt = new Date("2026-02-02T00:00:00Z");
    await registry.reload();
    expect(registry.list().map((d) => d.id)).toEqual(["inverter-1"]);
    expect(registry.driverProfile("inverter-2")).toBeNull();
  });

  test("the snapshot is stable between reloads", async () => {
    const devices = [row({ id: 1, slug: "inverter-1" })];
    const registry = registryOver(devices);
    await registry.reload();
    devices.push(row({ id: 2, slug: "inverter-2" }));
    // Not read again until asked: the poll loop reads the snapshot per tick, and
    // a query per tick is what the dimension spine exists to avoid.
    expect(registry.list().map((d) => d.id)).toEqual(["inverter-1"]);
  });

  test("a failed reload keeps the last good snapshot rather than emptying the plant", async () => {
    const warnings: string[] = [];
    let fail = false;
    const registry = createDeviceRegistry({
      readDevices: async () => {
        if (fail) throw new Error("database is down");
        return [row({ id: 1, slug: "inverter-1" })];
      },
      resolveProfile: async () => deye,
      logger: { warn: (template) => void warnings.push(template) },
    });
    await registry.reload();
    fail = true;
    await registry.reload();
    expect(registry.list().map((d) => d.id)).toEqual(["inverter-1"]);
    expect(warnings.length).toBe(1);
  });
});

describe("the single-inverter consumers the registry replaces", () => {
  test("primary is the lowest-id inverter, ignoring the virtual devices", async () => {
    const registry = registryOver([
      row({ id: 1, slug: "optimizer", role: "optimizer", connectionId: null }),
      row({ id: 2, slug: "inverter-1" }),
      row({ id: 3, slug: "inverter-2" }),
    ]);
    await registry.reload();
    expect(registry.primary()?.id).toBe("inverter-1");
    expect(registry.primaryProfile()?.id).toBe(deye.id);
  });

  test("no inverter at all resolves to nothing rather than to the first device", async () => {
    const registry = registryOver([
      row({ id: 1, slug: "meter-1", role: "meter", connectionId: null }),
    ]);
    await registry.reload();
    expect(registry.primary()).toBeNull();
    expect(registry.primaryProfile()).toBeNull();
  });

  test("usesProfile answers the uninstall guard for every registered device", async () => {
    const registry = registryOver([row({ id: 1, slug: "inverter-1" })]);
    await registry.reload();
    expect(registry.usesProfile(deye.id)).toBe(true);
    expect(registry.usesProfile("other")).toBe(false);
  });
});
