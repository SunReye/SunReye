/**
 * EVCC ingest + write path. The MQTT client, the broker config and the EVCC
 * config are mocked, so the whole module runs against an in-memory broker: no
 * network, no DB.
 */

import { EventEmitter } from "node:events";
import { afterEach, describe, expect, mock, test } from "bun:test";

/** Stands in for `mqtt`'s client: records writes and echoes them back. */
class FakeClient extends EventEmitter {
  subscriptions: string[] = [];
  published: { topic: string; payload: string }[] = [];

  subscribe(topics: string[], cb?: (err?: Error | null) => void): void {
    this.subscriptions.push(...topics);
    cb?.(null);
  }

  publish(topic: string, payload: string): void {
    this.published.push({ topic, payload });
    // A real broker delivers our own publishes straight back, since we subscribe
    // to the very trees we write to. Mirror that so `/set` echo handling runs.
    this.emit("message", topic, Buffer.from(payload));
  }

  async endAsync(): Promise<void> {}
}

let fake = new FakeClient();

mock.module("mqtt", () => ({ default: { connect: () => fake } }));
mock.module("../settings/config", () => ({
  getMqttConfig: async () => ({ brokerUrl: "mqtt://broker.test:1883" }),
}));
mock.module("../settings/evcc-settings", () => ({
  getEvccConfig: async () => ({ enabled: true, topicRoot: "evcc", subtractFromHome: false }),
}));

const { evccControl, evccSnapshot, rebuildEvcc, setEvccListener, stopEvcc } =
  await import("./evcc");

/** Comfortably past the ingest's emit debounce, so a due push has landed. */
const EMIT_WAIT_MS = 300;

/** Build the subscriber against a fresh fake client and complete its handshake. */
async function connectEvcc(): Promise<void> {
  fake = new FakeClient();
  await rebuildEvcc();
  fake.emit("connect");
  send("evcc/status", "online");
}

/** Deliver one retained/live state message, as the broker would. */
function send(topic: string, payload: string): void {
  fake.emit("message", topic, Buffer.from(payload));
}

const lastPublish = () => fake.published.at(-1);

const loadpoint = (index = 1) => {
  const lp = evccSnapshot()?.loadpoints.find((l) => l.index === index);
  if (!lp) throw new Error(`loadpoint ${index} missing from snapshot`);
  return lp;
};

/**
 * The three limit layers as the live EVCC 0.30x instance publishes them: the
 * session override is unset (0), the durable limit lives on the vehicle, and
 * `effectiveLimitSoc` is EVCC's resolution — 80%, which its own UI displays.
 */
function sendLimitLayers(): void {
  send("evcc/loadpoints/1/limitSoc", "0");
  send("evcc/loadpoints/1/effectiveLimitSoc", "80");
  send("evcc/loadpoints/1/vehicleLimitSoc", "75");
  send("evcc/loadpoints/1/vehicleName", "tesla_ble");
  send("evcc/loadpoints/1/vehicleTitle", "Tesla Model 3 Premium LR RWD");
  send("evcc/vehicles/tesla_ble/limitSoc", "80");
  send("evcc/vehicles/tesla_ble/title", "Tesla Model 3 Premium LR RWD");
}

afterEach(async () => {
  await stopEvcc();
});

describe("subscriptions", () => {
  test("covers the status, loadpoint and vehicle trees", async () => {
    await connectEvcc();
    expect(fake.subscriptions).toEqual(["evcc/status", "evcc/loadpoints/#", "evcc/vehicles/#"]);
  });
});

describe("snapshot", () => {
  test("exposes all three limit layers separately", async () => {
    await connectEvcc();
    sendLimitLayers();
    const lp = loadpoint();
    // The bug this pins: reading `limitSoc` alone reported "no limit" (0) while
    // EVCC was charging to 80%.
    expect(lp.limitSoc).toBe(0);
    expect(lp.effectiveLimitSoc).toBe(80);
    expect(lp.vehicleLimitSoc).toBe(75);
  });

  test("carries the vehicle slug and keeps the title fallback", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/vehicleName", "tesla_ble");
    expect(loadpoint().vehicleName).toBe("tesla_ble");
    // No title yet: the slug stands in for display.
    expect(loadpoint().vehicleTitle).toBe("tesla_ble");

    send("evcc/loadpoints/1/vehicleTitle", "Tesla Model 3 Premium LR RWD");
    expect(loadpoint().vehicleTitle).toBe("Tesla Model 3 Premium LR RWD");
    expect(loadpoint().vehicleName).toBe("tesla_ble");
  });

  test("limit layers are null until EVCC publishes them", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/mode", "pv");
    const lp = loadpoint();
    expect(lp.limitSoc).toBeNull();
    expect(lp.effectiveLimitSoc).toBeNull();
    expect(lp.vehicleLimitSoc).toBeNull();
    expect(lp.vehicleName).toBeNull();
  });

  test("folds the vehicle's pack size onto the loadpoint", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/vehicleName", "tesla_ble");
    // Published on the vehicle, not the loadpoint.
    send("evcc/vehicles/tesla_ble/capacity", "75");
    expect(loadpoint().vehicleCapacityKwh).toBe(75);
  });

  test("no vehicle, an unknown one or a capacity of 0 leaves the pack size null", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/connected", "true");
    expect(loadpoint().vehicleCapacityKwh).toBeNull();

    // A car EVCC never published vehicle state for (guest vehicle).
    send("evcc/loadpoints/1/vehicleName", "unknown_car");
    send("evcc/vehicles/tesla_ble/capacity", "75");
    expect(loadpoint().vehicleCapacityKwh).toBeNull();

    // EVCC publishes 0 for a vehicle configured without a capacity — that is
    // "unknown", not a zero-sized pack.
    send("evcc/loadpoints/1/vehicleName", "tesla_ble");
    send("evcc/vehicles/tesla_ble/capacity", "0");
    expect(loadpoint().vehicleCapacityKwh).toBeNull();
  });

  test("an empty retained payload deletes the key", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/effectiveLimitSoc", "80");
    expect(loadpoint().effectiveLimitSoc).toBe(80);
    send("evcc/loadpoints/1/effectiveLimitSoc", "");
    expect(loadpoint().effectiveLimitSoc).toBeNull();
  });
});

describe("limit write path", () => {
  test("targets the vehicle when the loadpoint's vehicle is known", async () => {
    await connectEvcc();
    sendLimitLayers();
    evccControl(1, "limitSoc", "90");
    // The durable limit lives per vehicle; the loadpoint topic is only a
    // session override that EVCC drops on unplug/restart.
    expect(lastPublish()).toEqual({ topic: "evcc/vehicles/tesla_ble/limitSoc/set", payload: "90" });
  });

  test("a vehicle known only through a nested topic still counts", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/vehicleName", "tesla_ble");
    send("evcc/vehicles/tesla_ble/planSoc/0/soc", "70");
    evccControl(1, "limitSoc", "55");
    expect(lastPublish()?.topic).toBe("evcc/vehicles/tesla_ble/limitSoc/set");
  });

  test("falls back to the loadpoint when no vehicle is identified", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/connected", "true");
    evccControl(1, "limitSoc", "60");
    expect(lastPublish()).toEqual({ topic: "evcc/loadpoints/1/limitSoc/set", payload: "60" });
  });

  test("falls back when the named vehicle was never ingested", async () => {
    await connectEvcc();
    // EVCC names a vehicle we hold no state for (e.g. a guest car): writing to
    // `vehicles/<name>` would go nowhere, so the session override is correct.
    send("evcc/loadpoints/1/vehicleName", "unknown_car");
    send("evcc/vehicles/tesla_ble/limitSoc", "80");
    evccControl(1, "limitSoc", "60");
    expect(lastPublish()?.topic).toBe("evcc/loadpoints/1/limitSoc/set");
  });

  test("mode stays loadpoint-scoped even with a known vehicle", async () => {
    await connectEvcc();
    sendLimitLayers();
    evccControl(1, "mode", "pv");
    expect(lastPublish()).toEqual({ topic: "evcc/loadpoints/1/mode/set", payload: "pv" });
  });

  test("routes per loadpoint, not globally", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/vehicleName", "tesla_ble");
    send("evcc/vehicles/tesla_ble/limitSoc", "80");
    send("evcc/loadpoints/2/connected", "true");
    evccControl(2, "limitSoc", "70");
    expect(lastPublish()?.topic).toBe("evcc/loadpoints/2/limitSoc/set");
  });

  test("throws while disconnected", async () => {
    await connectEvcc();
    fake.emit("close");
    expect(() => evccControl(1, "limitSoc", "80")).toThrow("EVCC MQTT is not connected");
  });
});

describe("pushes", () => {
  test("vehicle state alone pushes nothing; loadpoint state still does", async () => {
    await connectEvcc();
    await Bun.sleep(EMIT_WAIT_MS); // let the connect/status push drain
    let pushes = 0;
    setEvccListener(() => {
      pushes += 1;
    });
    try {
      // Vehicle state is write-routing input only, never in the snapshot, so
      // pushing on it would just repeat the previous snapshot to every client.
      send("evcc/vehicles/tesla_ble/limitSoc", "80");
      await Bun.sleep(EMIT_WAIT_MS);
      expect(pushes).toBe(0);
      // EVCC mirrors the change onto the loadpoint, and that is what reaches the UI.
      send("evcc/loadpoints/1/effectiveLimitSoc", "80");
      await Bun.sleep(EMIT_WAIT_MS);
      expect(pushes).toBe(1);
    } finally {
      setEvccListener(() => {});
    }
  });
});

describe("`/set` echoes", () => {
  test("a vehicles echo is dropped, not ingested as vehicle state", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/vehicleName", "tesla_ble");
    // Our own vehicle-scoped write echoes back on the tree we subscribe to. If
    // it were stored, the vehicle would look "known" and the loadpoint fallback
    // would silently disappear for unconfigured cars.
    send("evcc/vehicles/tesla_ble/limitSoc/set", "80");
    evccControl(1, "limitSoc", "80");
    expect(lastPublish()?.topic).toBe("evcc/loadpoints/1/limitSoc/set");
  });

  test("a vehicles echo leaves the loadpoint snapshot untouched", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/chargePower", "4200");
    const before = loadpoint();
    send("evcc/vehicles/tesla_ble/limitSoc/set", "80");
    expect(loadpoint()).toEqual(before);
  });

  test("loadpoint mode echoes still feed the power estimator forward", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/connected", "true");
    send("evcc/loadpoints/1/phasesActive", "3");
    send("evcc/loadpoints/1/chargePower", "4140");
    expect(loadpoint().chargePowerLive).toBe(4140);

    // `off` predicts 0 W one EVCC loop before its state topics confirm it.
    evccControl(1, "mode", "off");
    expect(loadpoint().chargePowerLive).toBe(0);
    expect(loadpoint().chargePowerSource).toBe("feedforward");
    // EVCC's own measurement is unchanged until it republishes.
    expect(loadpoint().chargePower).toBe(4140);
  });
});
