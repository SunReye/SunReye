import { describe, expect, test } from "bun:test";

import { deriveCapabilities } from "./capabilities";
import {
  type DeviceMetric,
  deviceInstance,
  instanceFromProfile,
  roleBindings,
} from "./device-instance";
import type { InverterProfile, MetricDef } from "./types";

/** A device metric with everything but the exercised fields defaulted. */
function dm(overrides: Partial<DeviceMetric> & { key: string }): DeviceMetric {
  return { unit: null, group: "misc", access: "r", ...overrides };
}

/** The profile-tier mirror of {@link dm}: a full wire-shaped {@link MetricDef}. */
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

function profile(metrics: MetricDef[], declares?: InverterProfile["declares"]): InverterProfile {
  return {
    id: "acme-1",
    name: "ACME 1",
    manufacturer: "ACME",
    metrics,
    ...(declares ? { declares } : {}),
  };
}

describe("roleBindings", () => {
  test("groups a device's metrics by the role each one maps", () => {
    const soc = dm({ key: "battery.soc", role: "battery.soc" });
    const roles = roleBindings([soc, dm({ key: "unmapped" })]);
    expect([...roles.keys()]).toEqual(["battery.soc"]);
    expect(roles.get("battery.soc")).toEqual({ role: "battery.soc", metrics: [soc] });
  });

  test("an indexed role binds every index, in declaration order", () => {
    const a = dm({ key: "pv1", role: "pv.string.power", index: 1 });
    const b = dm({ key: "pv2", role: "pv.string.power", index: 2 });
    expect(roleBindings([a, b]).get("pv.string.power")?.metrics).toEqual([a, b]);
  });

  test("a device that maps no role at all binds nothing", () => {
    expect(roleBindings([dm({ key: "x" })]).size).toBe(0);
    expect(roleBindings([]).size).toBe(0);
  });
});

describe("deviceInstance", () => {
  test("carries the identity the readings are keyed under, never a capability set", () => {
    const instance = deviceInstance({
      id: "deye-1",
      deviceClass: "inverter",
      integration: "profile",
      metrics: [dm({ key: "b", role: "battery.soc" })],
    });
    expect(instance.id).toBe("deye-1");
    expect(instance.deviceClass).toBe("inverter");
    expect(instance.integration).toBe("profile");
    expect(instance.roles.has("battery.soc")).toBe(true);
    // Capabilities are DERIVED. A tier that could declare them would be a tier
    // that can disagree about what "has a battery" means.
    expect("capabilities" in instance).toBe(false);
  });

  test("a device with no metrics has no roles", () => {
    const instance = deviceInstance({
      id: "ghost",
      deviceClass: "inverter",
      integration: "profile",
      metrics: [],
    });
    expect(instance.roles.size).toBe(0);
    expect(instance.metrics).toEqual([]);
  });
});

describe("instanceFromProfile", () => {
  test("keys on the device id, never the profile id", () => {
    const instance = instanceFromProfile({
      id: "inverter-1",
      deviceClass: "inverter",
      integration: "profile",
      profile: profile([m({ key: "b", role: "battery.soc" })]),
    });
    expect(instance.id).toBe("inverter-1");
    expect(instance.roles.get("battery.soc")?.metrics[0]?.key).toBe("b");
  });

  test("carries the profile's hardware declarations through", () => {
    const instance = instanceFromProfile({
      id: "inverter-1",
      deviceClass: "inverter",
      integration: "profile",
      profile: profile([], { backupOutput: true }),
    });
    expect(deriveCapabilities(instance).backupLoad).toBe(true);
  });
});

describe("deriveCapabilities is reachable for any DeviceInstance", () => {
  test("a profile-backed device and a hand-built one with the same roles derive identically", () => {
    // The profile tier: a full register map, authored offline.
    const backed = instanceFromProfile({
      id: "inverter-1",
      deviceClass: "inverter",
      integration: "profile",
      profile: profile([
        m({ key: "pv.1.power", role: "pv.string.power", index: 1 }),
        m({ key: "pv.2.power", role: "pv.string.power", index: 2 }),
        m({ key: "grid.l1.v", role: "grid.phase.voltage", index: 1 }),
        m({ key: "grid.power", role: "grid.power" }),
        m({ key: "battery.soc", role: "battery.soc" }),
        m({ key: "tou.1.soc", group: "timeofuse", access: "rw" }),
        m({ key: "setting.solar_sell", role: "setting.solar_sell.enabled", access: "rw" }),
      ]),
    });
    // The coded tier: the same roles, declared by hand, with no register map,
    // no binding and no profile anywhere in sight.
    const handBuilt = deviceInstance({
      id: "coded-1",
      deviceClass: "inverter",
      integration: "evcc",
      metrics: [
        dm({ key: "pv.1.power", role: "pv.string.power", index: 1 }),
        dm({ key: "pv.2.power", role: "pv.string.power", index: 2 }),
        dm({ key: "grid.l1.v", role: "grid.phase.voltage", index: 1 }),
        dm({ key: "grid.power", role: "grid.power" }),
        dm({ key: "battery.soc", role: "battery.soc" }),
        dm({ key: "tou.1.soc", group: "timeofuse", access: "rw" }),
        dm({ key: "setting.solar_sell", role: "setting.solar_sell.enabled", access: "rw" }),
      ],
    });

    expect(deriveCapabilities(handBuilt)).toEqual(deriveCapabilities(backed));
    expect(deriveCapabilities(handBuilt)).toEqual({
      battery: true,
      pvStrings: 2,
      phases: 1,
      grid: true,
      generator: false,
      backupLoad: false,
      features: ["solar_sell", "time_of_use"],
      controls: ["tou.1.soc", "setting.solar_sell"],
    });
  });

  test("a device that maps nothing claims nothing", () => {
    const caps = deriveCapabilities(
      deviceInstance({ id: "empty", deviceClass: "meter", integration: "profile", metrics: [] }),
    );
    expect(caps).toEqual({
      battery: false,
      pvStrings: 0,
      // One phase is the floor: a plant with no phase metric is still wired.
      phases: 1,
      grid: false,
      generator: false,
      backupLoad: false,
      features: [],
      controls: [],
    });
  });

  test("the profile-backed device derives what the profile itself does", () => {
    const p = profile([m({ key: "b", role: "battery.soc" })]);
    const instance = instanceFromProfile({
      id: "inverter-1",
      deviceClass: "inverter",
      integration: "profile",
      profile: p,
    });
    expect(deriveCapabilities(instance)).toEqual(deriveCapabilities(p));
  });
});
