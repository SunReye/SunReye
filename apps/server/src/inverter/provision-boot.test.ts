import { describe, expect, test } from "bun:test";

import { inverterConfigSchema } from "@SunReye/db/inverter-config";

import type { ProvisionResult, ProvisionStore } from "./provision";
import { defaultDeps, syncProvisioning } from "./provision-boot";

/** A store that records what it was asked to do and can be made to fail. */
function recordingStore(fail = false) {
  const calls: string[] = [];
  const plantRow = {
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
  const store = {
    async ensurePlant() {
      calls.push("ensurePlant");
      if (fail) throw new Error("database is down");
      return plantRow;
    },
    async updatePlant() {
      calls.push("updatePlant");
    },
    async readConnection() {
      calls.push("readConnection");
      return null;
    },
    async ensureConnection() {
      calls.push("ensureConnection");
      return {
        id: 2,
        name: "Inverter",
        host: "10.0.0.5",
        port: 502,
        transport: "tcp",
        timeoutMs: 2000,
        pollIntervalMs: 1000,
      };
    },
    async readDevices() {
      return [];
    },
    async ensureDevice() {
      calls.push("ensureDevice");
      return {
        id: 3,
        slug: "inverter",
        name: "Deye",
        profileId: "deye",
        role: "inverter",
        // A freshly provisioned device is in service.
        arrays: [],
        tempCoefficient: -0.4,
        systemLoss: 14,
        retiredAt: null,
        unitId: 1,
        connectionId: 2,
      };
    },
    async updateDevice() {
      calls.push("updateDevice");
      throw new Error("not reached");
    },
    async readPlantBatteries() {
      return [];
    },
    async upsertDeviceBattery() {
      calls.push("upsertDeviceBattery");
    },
    async deleteDeviceBattery() {
      calls.push("deleteDeviceBattery");
    },
    async readRawSetting() {
      return undefined;
    },
  } satisfies ProvisionStore;
  return { store, calls };
}

const warnings: string[] = [];
const logger = {
  info: () => {},
  warn: (template: string) => {
    warnings.push(template);
  },
};

const deps = (store: ProvisionStore) => ({
  store,
  logger,
  seed: async () => inverterConfigSchema.parse({ host: "10.0.0.5", unitId: 1 }),
});

describe("syncProvisioning", () => {
  test("with an active profile it provisions the whole spine", async () => {
    const { store, calls } = recordingStore();
    const result = await syncProvisioning({ id: "deye", name: "Deye" }, deps(store));
    expect(calls).toContain("ensureConnection");
    expect(calls).toContain("ensureDevice");
    expect((result as ProvisionResult).deviceId).toBe(3);
  });

  test("with NO active profile it still provisions the plant — and no device", async () => {
    // The onboarding-only boot. A plant is a site: its coordinates, PV surfaces
    // and time zone do not depend on which inverter is attached, and the settings
    // pages that edit them are reachable before a profile is chosen. A device
    // without a profile, on the other hand, would have nothing to describe how to
    // talk to it.
    const { store, calls } = recordingStore();
    const result = await syncProvisioning(null, deps(store));
    expect(result).toBeNull();
    expect(calls).toContain("ensurePlant");
    expect(calls).not.toContain("ensureDevice");
    expect(calls).not.toContain("ensureConnection");
  });

  test("a failure is logged and swallowed — the server still boots", async () => {
    // Provisioning failing must not take the process down: the dashboard, the
    // history reads and the settings pages are all still worth serving, and the
    // writer already degrades by dropping rows with a warning rather than
    // failing a flush. Throwing here would turn a recoverable database hiccup
    // into a boot loop.
    warnings.length = 0;
    const { store } = recordingStore(true);
    const result = await syncProvisioning({ id: "deye" }, deps(store));
    expect(result).toBeNull();
    expect(warnings.join(" ")).toContain("provisioning failed");
  });
});

describe("defaultDeps", () => {
  test("wires the real store, logger and config reader without touching any of them", () => {
    // The production wiring is one object literal, but a collaborator wired to
    // the wrong thing would only show up against a real database — and this is
    // the path every boot takes. Nothing is invoked here, so no query runs.
    const wired = defaultDeps();
    expect(typeof wired.store.ensurePlant).toBe("function");
    expect(typeof wired.store.readConnection).toBe("function");
    expect(typeof wired.store.readRawSetting).toBe("function");
    expect(typeof wired.logger.warn).toBe("function");
    expect(typeof wired.seed).toBe("function");
  });
});
