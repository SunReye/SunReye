import { describe, expect, test } from "bun:test";
import type { ConnectionRecord, DeviceRecord } from "@SunReye/db/plant-repo";

import { type ConnectionTier, type TierEvents, openConnections, tierFor } from "./connection-tier";

const gateway = (id: number): ConnectionRecord => ({
  id,
  name: `Gateway ${id}`,
  kind: "modbus",
  params: {
    host: `10.0.0.${id}`,
    port: 502,
    transport: "tcp",
    timeoutMs: 2000,
    pollIntervalMs: 1000,
  },
});

const broker = (id: number): ConnectionRecord => ({
  id,
  name: `Broker ${id}`,
  kind: "mqtt",
  params: { brokerUrl: "mqtt://hass.lan:1883" },
});

const device = (over: Partial<DeviceRecord> & { id: number; slug: string }): DeviceRecord => ({
  name: over.slug,
  profileId: "p",
  role: "inverter",
  unitId: 1,
  connectionId: null,
  params: {},
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  retiredAt: null,
  ...over,
});

/** A tier double that records the calls, so ORDER and identity are assertable. */
function recording(kind: ConnectionRecord["kind"]) {
  const calls: string[] = [];
  const tier: ConnectionTier = {
    kind,
    async open(connection) {
      calls.push(`open:${connection.id}`);
    },
    async attach(bound) {
      calls.push(`attach:${bound.connection.id}:${bound.device.slug}:${bound.device.unitId}`);
    },
    async close() {
      calls.push("close");
    },
  };
  return { tier, calls };
}

describe("tierFor", () => {
  test("picks the tier whose kind matches", () => {
    const poll = recording("modbus");
    const push = recording("mqtt");
    expect(tierFor([poll.tier, push.tier], "modbus")).toBe(poll.tier);
    expect(tierFor([poll.tier, push.tier], "mqtt")).toBe(push.tier);
  });

  test("a kind with no tier is null, not the first tier", () => {
    // The failure this prevents: a database migrated ahead of the build holds a
    // kind this binary has no tier for. Falling back to the first tier would
    // hand a broker's params to the Modbus client, which dials `undefined:502`
    // and reports a timeout forever.
    const poll = recording("modbus");
    expect(tierFor([poll.tier], "mqtt")).toBeNull();
    expect(tierFor([], "modbus")).toBeNull();
  });
});

describe("openConnections", () => {
  test("opens each connection on ITS tier, then attaches its devices", async () => {
    // The order is the contract: a tier cannot attach a device to a client it
    // has not opened, and the poll/push split is exactly what "opened" means.
    const poll = recording("modbus");
    const push = recording("mqtt");
    const events = await openConnections({
      connections: [gateway(1), broker(2)],
      devices: [
        device({ id: 10, slug: "inverter", connectionId: 1, unitId: 3 }),
        device({ id: 11, slug: "evcc-loadpoint-1", connectionId: 2, unitId: 1, role: "charger" }),
      ],
      tiers: [poll.tier, push.tier],
    });
    expect(poll.calls).toEqual(["open:1", "attach:1:inverter:3"]);
    expect(push.calls).toEqual(["open:2", "attach:2:evcc-loadpoint-1:1"]);
    expect(events.unsupported).toEqual([]);
  });

  test("an MQTT connection with TWO loadpoints attaches two devices with distinct unit ids", async () => {
    // The addressing #217 exists to make expressible. Before it both loadpoints
    // were `(null, 0)`, so the push tier had no way to tell them apart and the
    // unique index only tolerated them because the connection was null.
    const push = recording("mqtt");
    await openConnections({
      connections: [broker(2)],
      devices: [
        device({ id: 11, slug: "evcc-loadpoint-1", connectionId: 2, unitId: 1, role: "charger" }),
        device({ id: 12, slug: "evcc-loadpoint-2", connectionId: 2, unitId: 2, role: "charger" }),
      ],
      tiers: [push.tier],
    });
    expect(push.calls).toEqual([
      "open:2",
      "attach:2:evcc-loadpoint-1:1",
      "attach:2:evcc-loadpoint-2:2",
    ]);
  });

  test("a connection with no devices is still opened", async () => {
    // A broker with nothing bound is what the HA export publishes through, and
    // a gateway with no device yet is the onboarding order.
    const poll = recording("modbus");
    await openConnections({ connections: [gateway(1)], devices: [], tiers: [poll.tier] });
    expect(poll.calls).toEqual(["open:1"]);
  });

  test("a RETIRED device is never attached", async () => {
    // It is out of service. Attaching it would poll a replaced inverter forever
    // — the failure `retired_at` exists to make expressible.
    const poll = recording("modbus");
    await openConnections({
      connections: [gateway(1)],
      devices: [
        device({ id: 10, slug: "gone", connectionId: 1, retiredAt: new Date("2026-01-01") }),
        device({ id: 11, slug: "live", connectionId: 1, unitId: 2 }),
      ],
      tiers: [poll.tier],
    });
    expect(poll.calls).toEqual(["open:1", "attach:1:live:2"]);
  });

  test("a device with NO connection is attached to nothing, and is not an error", async () => {
    // `INVERTER_SIMULATE`, the optimizer, and an imported history whose hardware
    // is gone. They are devices with no endpoint at all.
    const poll = recording("modbus");
    const events = await openConnections({
      connections: [gateway(1)],
      devices: [device({ id: 10, slug: "sim", connectionId: null })],
      tiers: [poll.tier],
    });
    expect(poll.calls).toEqual(["open:1"]);
    expect(events.unsupported).toEqual([]);
  });

  test("a device naming a connection that is GONE is reported, not silently dropped", async () => {
    const poll = recording("modbus");
    const events = await openConnections({
      connections: [gateway(1)],
      devices: [device({ id: 10, slug: "orphan", connectionId: 99 })],
      tiers: [poll.tier],
    });
    expect(events.dangling).toEqual(["orphan"]);
  });

  test("a kind no tier can open is REPORTED and left closed", async () => {
    // Silence here is the failure: the connection is simply never polled and
    // never subscribed, and the plant goes quiet with nothing in the log. The
    // CHECK constraint makes this unreachable on a database this build migrated
    // — it stays reachable on one migrated AHEAD of the build.
    const poll = recording("modbus");
    const events = await openConnections({
      connections: [gateway(1), broker(2)],
      devices: [device({ id: 11, slug: "loadpoint", connectionId: 2, role: "charger" })],
      tiers: [poll.tier],
    });
    expect(poll.calls).toEqual(["open:1"]);
    expect(events.unsupported).toEqual([{ connectionId: 2, kind: "mqtt" }]);
  });

  test("closeConnections closes every tier that was opened, once", async () => {
    const poll = recording("modbus");
    const push = recording("mqtt");
    const events: TierEvents = await openConnections({
      connections: [gateway(1), gateway(3), broker(2)],
      devices: [],
      tiers: [poll.tier, push.tier],
    });
    await events.close();
    // Two Modbus connections share ONE tier: the tier owns its clients, so it
    // is closed once rather than once per connection.
    expect(poll.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(push.calls.filter((call) => call === "close")).toHaveLength(1);
  });

  test("a tier that was never opened is not closed", async () => {
    const poll = recording("modbus");
    const push = recording("mqtt");
    const events = await openConnections({
      connections: [gateway(1)],
      devices: [],
      tiers: [poll.tier, push.tier],
    });
    await events.close();
    expect(push.calls).toEqual([]);
  });

  test("an `open` that throws does not stop the other connections", async () => {
    // One unreachable gateway must not silence the rest of the plant, and the
    // MQTT tier must still subscribe.
    const push = recording("mqtt");
    const failing: ConnectionTier = {
      kind: "modbus",
      open: async () => {
        throw new Error("ECONNREFUSED");
      },
      attach: async () => {},
      close: async () => {},
    };
    const events = await openConnections({
      connections: [gateway(1), broker(2)],
      devices: [],
      tiers: [failing, push.tier],
    });
    expect(push.calls).toEqual(["open:2"]);
    expect(events.failures).toEqual([{ connectionId: 1, error: "ECONNREFUSED" }]);
  });

  test("an `attach` that throws is reported against its device", async () => {
    const failing: ConnectionTier = {
      kind: "modbus",
      open: async () => {},
      attach: async () => {
        throw new Error("unit 3 did not answer");
      },
      close: async () => {},
    };
    const events = await openConnections({
      connections: [gateway(1)],
      devices: [device({ id: 10, slug: "inverter", connectionId: 1, unitId: 3 })],
      tiers: [failing],
    });
    expect(events.failures).toEqual([
      { connectionId: 1, deviceSlug: "inverter", error: "unit 3 did not answer" },
    ]);
  });
});
