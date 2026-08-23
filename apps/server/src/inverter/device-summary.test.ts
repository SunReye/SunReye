import { describe, expect, test } from "bun:test";

import type { Device } from "./device-registry";
import { deviceSummaries } from "./device-summary";
import type { ProfileContext } from "./inverter";

const ctx = (id: string, name = id) =>
  ({ profile: { id, name }, manifest: { name } }) as unknown as ProfileContext;

const device = (id: string, over: Partial<Device> = {}): Device =>
  ({
    id,
    label: id,
    deviceClass: "inverter",
    source: { id: "default", kind: "modbus", label: "Bus", config: {}, enabled: true },
    address: { unitId: 1 },
    enabled: true,
    ctx: ctx(id),
    ...over,
  }) as Device;

// What a client needs to name a device and ask about it — and nothing more. The
// connection blob in particular stays server-side: it carries credentials.
describe("what a device looks like from outside", () => {
  test("names the device, its class, its profile and its source", () => {
    const summaries = deviceSummaries([device("roof")], "roof");

    expect(summaries).toEqual([
      {
        id: "roof",
        label: "roof",
        deviceClass: "inverter",
        profileId: "roof",
        sourceId: "default",
        sourceKind: "modbus",
        enabled: true,
        isDefault: true,
      },
    ]);
  });

  test("never leaks the connection or its credentials", () => {
    const summaries = deviceSummaries(
      [
        device("roof", {
          source: {
            id: "default",
            kind: "modbus",
            label: "Bus",
            config: { host: "10.0.0.5", password: "s3cret" },
            enabled: true,
          },
        }),
      ],
      "roof",
    );

    expect(JSON.stringify(summaries)).not.toContain("s3cret");
    expect(JSON.stringify(summaries)).not.toContain("10.0.0.5");
  });

  test("marks exactly one device as the default", () => {
    const summaries = deviceSummaries([device("roof"), device("barn")], "barn");

    expect(summaries.filter((d) => d.isDefault).map((d) => d.id)).toEqual(["barn"]);
  });

  test("marks none when the plant has no default — the onboarding case", () => {
    expect(deviceSummaries([device("roof")], null).every((d) => !d.isDefault)).toBe(true);
  });

  test("includes a disabled device, and says so", () => {
    // It still owns its history, and the UI has to be able to name it to offer
    // turning it back on.
    const summaries = deviceSummaries([device("off", { enabled: false })], null);

    expect(summaries[0]?.enabled).toBe(false);
  });

  test("an empty plant is an empty list, not an error", () => {
    expect(deviceSummaries([], null)).toEqual([]);
  });
});
