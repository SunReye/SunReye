/**
 * EVCC ingest + write path. The MQTT client, the broker config and the EVCC
 * config are mocked, so the whole module runs against an in-memory broker: no
 * network, no DB.
 */

import { EventEmitter } from "node:events";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { createStreams } from "../shared/streams";

/**
 * The bus each fresh snapshot is emitted onto. `connectEvcc` wires it into the
 * ingest; the push tests subscribe to its `evcc` topic to count snapshots.
 */
const streams = createStreams();

/** Stands in for `mqtt`'s client: records writes and echoes them back. */
class FakeClient extends EventEmitter {
  subscriptions: string[] = [];
  published: { topic: string; payload: string }[] = [];
  /** Set to make the broker refuse the subscription (ACL, broker restart). */
  subscribeError: Error | null = null;

  subscribe(topics: string[], cb?: (err?: Error | null) => void): void {
    if (this.subscribeError) {
      cb?.(this.subscribeError);
      return;
    }
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

// `mock.module` is PROCESS-GLOBAL and permanent: every test file that runs
// after this one sees these modules too. A mock that returns only the exports
// this suite happens to need therefore DELETES the rest for everyone — a later
// file importing ./runtime died with "Export named 'getInverterConfig' not
// found in module config.ts", which also took down that file's own mock
// registrations and failed four unrelated tests. Spread the real module and
// override only what this suite stubs.
const realConfig = await import("../settings/config");
const realEvccSettings = await import("../settings/evcc-settings");

// ...and the spread is only half of it: the stub itself is permanent too, so
// `getMqttConfig`/`getEvccConfig` would stay installed for every later file —
// including the suites that unit-test those very modules, which would then
// assert against this double (red in the full run, green alone). The `afterAll`
// below hands the modules back. A namespace is LIVE, so once the mock is
// installed `realConfig.getMqttConfig` IS the stub: snapshot by value here,
// before any mock exists, or the restore restores the stub.
const realConfigExports = { ...realConfig };
const realEvccSettingsExports = { ...realEvccSettings };

/** The EVCC config the next `rebuildEvcc` reads; restored after every test. */
const DEFAULT_EVCC_CONFIG = { enabled: true, topicRoot: "evcc", subtractFromHome: false };
let evccConfig = { ...DEFAULT_EVCC_CONFIG };

mock.module("mqtt", () => ({ default: { connect: () => fake } }));
mock.module("../settings/config", () => ({
  ...realConfig,
  getMqttConfig: async () => ({ brokerUrl: "mqtt://broker.test:1883" }),
}));
mock.module("../settings/evcc-settings", () => ({
  ...realEvccSettings,
  getEvccConfig: async () => evccConfig,
}));

const { evccControl, evccOnLoadSample, evccSnapshot, rebuildEvcc, stopEvcc } =
  await import("./evcc");

/** Comfortably past the ingest's emit debounce, so a due push has landed. */
const EMIT_WAIT_MS = 300;

/**
 * Capture what `evcc.ts` logs while `run` executes. Two tests below are named
 * "…is logged, not thrown"; `not.toThrow()` alone only ever proved the second
 * half, and would stay green if the error were swallowed silently — which is
 * the actual failure mode worth catching, because a dropped broker error is
 * invisible in production. LogTape caches one logger per category, and evcc.ts
 * binds its own at import time, so the tap goes on that shared instance: an own
 * property shadows the prototype method, forwards to LogTape, and is deleted
 * again immediately.
 */
const { log: evccLog } = await import("../shared/logging");
function loggedDuring(run: () => void): { template: string; values: Record<string, unknown> }[] {
  const logger = evccLog("evcc") as unknown as Record<string, unknown>;
  const captured: { template: string; values: Record<string, unknown> }[] = [];
  const levels = ["warn", "error"] as const;
  for (const level of levels) {
    const emit = (logger[level] as (t: string, v?: Record<string, unknown>) => void).bind(logger);
    logger[level] = (template: string, values: Record<string, unknown> = {}) => {
      captured.push({ template, values });
      emit(template, values);
    };
  }
  try {
    run();
  } finally {
    for (const level of levels) delete logger[level];
  }
  return captured;
}

/** Build the subscriber against a fresh fake client and complete its handshake. */
async function connectEvcc(): Promise<void> {
  fake = new FakeClient();
  await rebuildEvcc(streams);
  fake.emit("connect");
  send("evcc/status", "online");
}

/** Same, with the stored EVCC config changed first (as a settings save would). */
async function connectEvccWith(overrides: Partial<typeof DEFAULT_EVCC_CONFIG>): Promise<void> {
  evccConfig = { ...DEFAULT_EVCC_CONFIG, ...overrides };
  await connectEvcc();
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
  evccConfig = { ...DEFAULT_EVCC_CONFIG };
});

// `afterAll`, not `afterEach`: this file's own tests need the stubs until the
// last one has run. From here on the real modules are back for everyone else.
afterAll(() => {
  mock.module("../settings/config", () => ({ ...realConfigExports }));
  mock.module("../settings/evcc-settings", () => ({ ...realEvccSettingsExports }));
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

  test("loadpoints come back in index order, whatever order EVCC published them", async () => {
    await connectEvcc();
    // The retained snapshot arrives as dozens of leaf topics in broker order,
    // and the dashboard renders the array as it is given.
    send("evcc/loadpoints/2/title", "Carport");
    send("evcc/loadpoints/10/title", "Barn");
    send("evcc/loadpoints/1/title", "Garage");
    // Numeric, not lexicographic: 10 sorts after 2, not between 1 and 2.
    expect(evccSnapshot()?.loadpoints.map((lp) => lp.index)).toEqual([1, 2, 10]);
    expect(evccSnapshot()?.loadpoints.map((lp) => lp.title)).toEqual(["Garage", "Carport", "Barn"]);
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
    const unsubscribe = streams.subscribe("evcc", () => {
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
      unsubscribe();
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

  test("a `now` echo predicts full power from the phases and the effective max current", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/connected", "true");
    send("evcc/loadpoints/1/phasesActive", "3");
    // EVCC's own ceiling for this loadpoint — 10 A, not the 16 A default.
    send("evcc/loadpoints/1/effectiveMaxCurrent", "10");
    send("evcc/loadpoints/1/chargePower", "0");

    evccControl(1, "mode", "now");
    expect(loadpoint().chargePowerLive).toBe(6900); // 3 × 230 V × 10 A
    expect(loadpoint().chargePowerSource).toBe("feedforward");
  });
});

describe("battery boost", () => {
  test("a loadpoint that never published the topics is not boosting", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/mode", "pv");
    // The flag is transient and EVCC only publishes it once it means something;
    // absent must read as "not boosting", never as unknown.
    expect(loadpoint().batteryBoost).toBe(false);
    // The house-battery floor, by contrast, has no value to invent: null until
    // EVCC states it, so a restore can tell "unknown" from "100 = disabled".
    expect(loadpoint().batteryBoostLimit).toBeNull();
  });

  test("EVCC clearing the boost on a mode change is reflected", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/mode", "pv");
    send("evcc/loadpoints/1/batteryBoost", "true");
    expect(loadpoint().batteryBoost).toBe(true);

    // EVCC keeps the boost in memory only and drops it on ANY mode change —
    // which is why a boost command has to follow its mode command, never lead.
    send("evcc/loadpoints/1/mode", "now");
    send("evcc/loadpoints/1/batteryBoost", "false");
    expect(loadpoint().batteryBoost).toBe(false);
    expect(loadpoint().mode).toBe("now");
  });

  test("boost and mode are both loadpoint-scoped, and go out in that order", async () => {
    await connectEvcc();
    sendLimitLayers(); // a known vehicle — only limitSoc is ever routed to it
    evccControl(1, "mode", "pv");
    evccControl(1, "batteryBoost", "true");
    // EVCC refuses the boost outside pv/minpv and clears it on the mode change,
    // so the pair only survives in this order.
    expect(fake.published).toEqual([
      { topic: "evcc/loadpoints/1/mode/set", payload: "pv" },
      { topic: "evcc/loadpoints/1/batteryBoost/set", payload: "true" },
    ]);
  });

  test("issuing the command does not flip the flag — only EVCC's own topic does", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/mode", "pv");
    // Our write echoes back on the tree we subscribe to; treating that echo as
    // state would show a boost EVCC may have rejected outright.
    evccControl(1, "batteryBoost", "true");
    expect(loadpoint().batteryBoost).toBe(false);

    send("evcc/loadpoints/1/batteryBoost", "true"); // EVCC accepted it
    expect(loadpoint().batteryBoost).toBe(true);
  });

  test("the house-battery floor is carried verbatim, 0 and 100 included", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/batteryBoostLimit", "100"); // EVCC's default: disabled
    expect(loadpoint().batteryBoostLimit).toBe(100);

    send("evcc/loadpoints/1/batteryBoostLimit", "20");
    expect(loadpoint().batteryBoostLimit).toBe(20);

    // 0 % means "drain the house battery all the way", not "unset". EVCC
    // persists this one, so whatever changes it owes the user the old value back.
    send("evcc/loadpoints/1/batteryBoostLimit", "0");
    expect(loadpoint().batteryBoostLimit).toBe(0);
  });

  test("the floor is written to the loadpoint even when the vehicle is known", async () => {
    await connectEvcc();
    sendLimitLayers();
    evccControl(1, "batteryBoostLimit", "30");
    // It is the HOUSE battery's floor: nothing about it belongs on the car.
    expect(lastPublish()).toEqual({
      topic: "evcc/loadpoints/1/batteryBoostLimit/set",
      payload: "30",
    });
  });
});

describe("house-load samples", () => {
  /** A charging loadpoint EVCC last measured at `watts`. */
  function chargingLoadpoint(watts: number): void {
    send("evcc/loadpoints/1/connected", "true");
    send("evcc/loadpoints/1/charging", "true");
    send("evcc/loadpoints/1/phasesActive", "3");
    send("evcc/loadpoints/1/chargePower", String(watts));
  }

  test("a whole-amp step in the house load is attributed to the charger", async () => {
    await connectEvccWith({ subtractFromHome: true });
    chargingLoadpoint(0);

    evccOnLoadSample(800); // seeds the house baseline
    evccOnLoadSample(1490); // +690 W = 3 phases × 1 A × 230 V: the car ramping
    expect(loadpoint().chargePowerLive).toBe(690);
    expect(loadpoint().chargePowerSource).toBe("estimated");
    // EVCC's own measurement is untouched until it publishes again.
    expect(loadpoint().chargePower).toBe(0);
  });

  test("a null reading is the metric being absent; 0 W is a reading", async () => {
    await connectEvccWith({ subtractFromHome: true });
    chargingLoadpoint(0);

    // null means "no load metric this poll" and must clear the baseline, so the
    // sample after it re-seeds instead of reading as one enormous step.
    evccOnLoadSample(800);
    evccOnLoadSample(null);
    evccOnLoadSample(1490);
    expect(loadpoint().chargePowerLive).toBe(0);
    expect(loadpoint().chargePowerSource).toBe("measured");

    // A house load of exactly 0 W (everything covered by PV) is a baseline like
    // any other — the step measured against it is still the car.
    await connectEvccWith({ subtractFromHome: true });
    chargingLoadpoint(0);
    evccOnLoadSample(0);
    evccOnLoadSample(690);
    expect(loadpoint().chargePowerLive).toBe(690);
  });

  test("are ignored unless the charger is metered inside the house load", async () => {
    // `subtractFromHome` off means the charger is NOT behind the load meter, so
    // a step in that signal is someone else's appliance.
    await connectEvcc();
    chargingLoadpoint(4140);
    evccOnLoadSample(5000);
    evccOnLoadSample(4310);
    expect(loadpoint().chargePowerLive).toBe(4140);
    expect(loadpoint().chargePowerSource).toBe("measured");
  });

  test("are dropped while EVCC ingest is off", async () => {
    await stopEvcc();
    expect(() => evccOnLoadSample(3000)).not.toThrow();
    expect(evccSnapshot()).toBeNull();
  });

  test("a wobble under the noise floor pushes nothing; an attributed step pushes", async () => {
    await connectEvccWith({ subtractFromHome: true });
    chargingLoadpoint(0);
    await Bun.sleep(EMIT_WAIT_MS); // let the ingest's own pushes drain

    let pushes = 0;
    const unsubscribe = streams.subscribe("evcc", () => {
      pushes += 1;
    });
    try {
      evccOnLoadSample(0);
      evccOnLoadSample(100); // meter noise / slow house drift, under 150 W
      await Bun.sleep(EMIT_WAIT_MS);
      expect(pushes).toBe(0);
      expect(loadpoint().chargePowerLive).toBe(0);

      evccOnLoadSample(790); // the noise was absorbed, so this is +690 W
      await Bun.sleep(EMIT_WAIT_MS);
      expect(pushes).toBe(1);
      expect(loadpoint().chargePowerLive).toBe(690);
    } finally {
      unsubscribe();
    }
  });
});

describe("reachability", () => {
  test("needs the broker AND EVCC's own status topic", async () => {
    fake = new FakeClient();
    await rebuildEvcc();
    expect(evccSnapshot()?.reachable).toBe(false); // broker not up yet

    fake.emit("connect");
    expect(evccSnapshot()?.reachable).toBe(false); // broker up, EVCC silent

    send("evcc/status", "online\n"); // EVCC's LWT topic, retained
    expect(evccSnapshot()?.reachable).toBe(true);

    // EVCC died: the broker keeps serving its retained state, which would
    // otherwise read as a live charger indefinitely.
    send("evcc/status", "offline");
    expect(evccSnapshot()?.reachable).toBe(false);

    send("evcc/status", "online");
    fake.emit("close");
    expect(evccSnapshot()?.reachable).toBe(false);
  });
});

describe("rebuilds", () => {
  test("a disabled config connects nothing and reports no state", async () => {
    await connectEvccWith({ enabled: false });
    expect(evccSnapshot()).toBeNull();
    expect(fake.subscriptions).toEqual([]);
  });

  test("a new topic root is resubscribed, and the old root's state is forgotten", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/chargePower", "4140");
    expect(evccSnapshot()?.loadpoints).toHaveLength(1);

    await connectEvccWith({ topicRoot: "evcc-garage" });
    expect(fake.subscriptions).toEqual([
      "evcc-garage/status",
      "evcc-garage/loadpoints/#",
      "evcc-garage/vehicles/#",
    ]);
    // Stale state under the old root would keep a loadpoint on the dashboard
    // that nothing is publishing to any more.
    expect(evccSnapshot()?.loadpoints).toEqual([]);

    send("evcc-garage/loadpoints/1/chargePower", "4140");
    expect(loadpoint().chargePower).toBe(4140);
  });

  test("the diagram hint travels with the snapshot", async () => {
    await connectEvccWith({ subtractFromHome: true });
    expect(evccSnapshot()?.subtractFromHome).toBe(true);

    await connectEvccWith({ subtractFromHome: false });
    expect(evccSnapshot()?.subtractFromHome).toBe(false);
  });

  test("a refused subscription is logged, not thrown, and the writes still go out", async () => {
    fake = new FakeClient();
    const refusal = new Error("not authorized");
    fake.subscribeError = refusal;
    await rebuildEvcc();

    const lines = loggedDuring(() => fake.emit("connect"));

    // The "logged" half of the name. A silent refusal is the worst outcome
    // available here: the connection looks healthy, writes keep working, and
    // nothing ever arrives — with no line anywhere saying why.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.template).toContain("subscribe failed");
    expect(lines[0]?.values.error).toBe(refusal);
    expect(fake.subscriptions).toEqual([]);
    // The mqtt lib owns the retry; tearing the client down here would lose the
    // command path for a broker ACL that may be fixed a second later. The
    // publish is on a different ACL than the subscribe, so it still lands.
    evccControl(1, "mode", "pv");
    expect(fake.published).toEqual([{ topic: "evcc/loadpoints/1/mode/set", payload: "pv" }]);
  });

  test("a client error is logged, not thrown", async () => {
    await connectEvcc();
    send("evcc/loadpoints/1/mode", "pv");

    const err = new Error("ECONNRESET");
    const lines = loggedDuring(() => {
      expect(() => fake.emit("error", err)).not.toThrow();
    });

    // The "logged" half of the name: a swallowed broker error leaves an ingest
    // that has silently stopped tracking, with nothing in the log viewer to say so.
    expect(lines).toHaveLength(1);
    expect(lines[0]?.template).toContain("client error");
    expect(lines[0]?.values.error).toBe(err);
    // The client stays; reconnect/backoff is the mqtt lib's job.
    expect(evccSnapshot()?.loadpoints).toHaveLength(1);
  });
});
