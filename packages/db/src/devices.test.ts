import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SOURCE_ID,
  parseDeviceRows,
  parseSourceRows,
  type DeviceRow,
  type SourceRow,
} from "./devices";

const stamps = { createdAt: new Date(0), updatedAt: new Date(0) };

const sourceRow = (over: Partial<SourceRow> = {}): SourceRow => ({
  id: DEFAULT_SOURCE_ID,
  kind: "modbus",
  label: "Inverter",
  config: { host: "10.0.0.5", port: 502 },
  enabled: true,
  ...stamps,
  ...over,
});

const deviceRow = (over: Partial<DeviceRow> = {}): DeviceRow => ({
  id: "deye-sg05lp3",
  sourceId: DEFAULT_SOURCE_ID,
  profileId: "deye-sg05lp3",
  deviceClass: "inverter",
  label: "Inverter",
  address: { unitId: 1 },
  enabled: true,
  ...stamps,
  ...over,
});

// A registry is not a setting. `readSetting` answers a bad row with the default
// and no log line, which for one scalar costs one scalar — and for a device list
// would cost the whole plant: the server would boot healthy, poll nothing, and
// say nothing about why. So these parse per row and report what they dropped.
describe("a bad row costs one row", () => {
  test("keeps the good devices and names the bad one", () => {
    const result = parseDeviceRows([
      deviceRow({ id: "good" }),
      deviceRow({ id: "bad", address: "not-an-object" as unknown as DeviceRow["address"] }),
      deviceRow({ id: "also-good" }),
    ]);

    expect(result.devices.map((d) => d.id)).toEqual(["good", "also-good"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe("bad");
    expect(result.skipped[0]?.reason).not.toBe("");
  });

  test("never substitutes a default for a device it could not read", () => {
    const result = parseDeviceRows([deviceRow({ id: "bad", deviceClass: "" })]);

    expect(result.devices).toEqual([]);
    expect(result.skipped.map((s) => s.id)).toEqual(["bad"]);
  });

  test("the same holds for sources", () => {
    const result = parseSourceRows([sourceRow({ id: "good" }), sourceRow({ id: "bad", kind: "" })]);

    expect(result.sources.map((s) => s.id)).toEqual(["good"]);
    expect(result.skipped.map((s) => s.id)).toEqual(["bad"]);
  });

  test("an empty table is not a failure — it is a fresh install", () => {
    expect(parseDeviceRows([])).toEqual({ devices: [], skipped: [] });
    expect(parseSourceRows([])).toEqual({ sources: [], skipped: [] });
  });
});

describe("what a row round-trips", () => {
  test("a disabled device parses, and stays disabled", () => {
    // Disabled is a state to honour, not a row to drop: the caller decides what
    // "do not poll this" means, and it still owns its history.
    const { devices } = parseDeviceRows([deviceRow({ enabled: false })]);

    expect(devices[0]?.enabled).toBe(false);
  });

  test("an address keeps fields this version does not know about", () => {
    // A device written by a newer version must not lose its addressing on a
    // downgrade round trip; stripping unknown keys would do exactly that.
    const { devices } = parseDeviceRows([deviceRow({ address: { unitId: 3, loadpoint: 2 } })]);

    expect(devices[0]?.address).toEqual({ unitId: 3, loadpoint: 2 });
  });

  test.each([
    ["past the end of the range", 256],
    ["below it", -1],
    ["not a whole number", 1.5],
  ])("a unit id %s is not addressing", (_label, unitId) => {
    const { devices, skipped } = parseDeviceRows([deviceRow({ address: { unitId } })]);

    expect(devices).toEqual([]);
    expect(skipped[0]?.reason).toContain("unitId");
  });

  test("an address may be empty — not every source addresses within itself", () => {
    const { devices } = parseDeviceRows([deviceRow({ address: {} })]);

    expect(devices[0]?.address).toEqual({});
  });
});
