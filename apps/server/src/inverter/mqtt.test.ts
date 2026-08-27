import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { MqttConfig } from "@SunReye/db/mqtt-config";
import type {
  EntityConstraint,
  InverterProfile,
  InverterSample,
  ManifestMetric,
  MetricDef,
} from "@SunReye/inverter-core";
import { buildManifest, entityConstraint, metricByKey } from "@SunReye/inverter-core";
import {
  type HaDevice,
  discoveryConfig,
  forecastDiscoveryConfig,
  topicsFor,
} from "./mqtt-discovery";
import { holdDiscovery, releaseDiscovery, resetDiscoveryGate } from "../migration/discovery-gate";
import type { ProfileContext } from "./inverter";
import { createControlWriter } from "./control-writer";
import type { ForecastVariant, SolarForecastExport } from "../forecast/solar-forecast";

const topics = topicsFor("sunreye", "deye");

const haDevice: HaDevice = {
  identifiers: ["sunreye_deye"],
  name: "Deye",
  manufacturer: "Deye",
  model: "deye",
};

const metric = (over: Partial<ManifestMetric> & { key: string }): ManifestMetric => ({
  topic: over.key.replaceAll(".", "/"),
  label: over.key,
  unit: null,
  group: "test",
  kind: "measurement",
  storage: "series",
  writable: false,
  ...over,
});

const constraint = (over: Partial<EntityConstraint> = {}): EntityConstraint => ({
  writable: false,
  valueType: "number",
  ...over,
});

const configFor = (m: ManifestMetric, c: EntityConstraint) =>
  discoveryConfig(m, c, topics, "deye", haDevice);

describe("discoveryConfig", () => {
  test("a read-only measurement becomes a sensor with device + state class", () => {
    const { component, config } = configFor(
      metric({ key: "pv.power", unit: "W", kind: "measurement" }),
      constraint(),
    );
    expect(component).toBe("sensor");
    expect(config.state_topic).toBe("sunreye/deye/pv/power");
    expect(config.availability_topic).toBe("sunreye/deye/status");
    expect(config.unique_id).toBe("sunreye_deye_pv_power");
    expect(config.default_entity_id).toBe("sensor.sunreye_pv_power");
    expect(config.device_class).toBe("power");
    expect(config.state_class).toBe("measurement");
    expect(config.command_topic).toBeUndefined();
  });

  test("a cumulative counter is total_increasing", () => {
    const { config } = configFor(
      metric({ key: "grid.import", unit: "kWh", kind: "cumulative" }),
      constraint(),
    );
    expect(config.state_class).toBe("total_increasing");
    expect(config.device_class).toBe("energy");
  });

  test("a percentage is only a battery device_class in the SOC role", () => {
    const soc = configFor(
      metric({ key: "battery.soc", unit: "%", role: "battery.soc" }),
      constraint(),
    );
    expect(soc.config.device_class).toBe("battery");
    const other = configFor(metric({ key: "pv.ratio", unit: "%" }), constraint());
    expect(other.config.device_class).toBeUndefined();
  });

  test("a writable number carries the profile range, falling back to a wide envelope", () => {
    const bounded = configFor(
      metric({ key: "setting.charge", unit: "A", writable: true }),
      constraint({ writable: true, min: 0, max: 185 }),
    );
    expect(bounded.component).toBe("number");
    expect(bounded.config.command_topic).toBe("sunreye/deye/setting/charge/set");
    expect(bounded.config.min).toBe(0);
    expect(bounded.config.max).toBe(185);
    expect(bounded.config.default_entity_id).toBe("number.sunreye_setting_charge");

    const unbounded = configFor(
      metric({ key: "setting.power", writable: true }),
      constraint({ writable: true }),
    );
    expect(unbounded.config.max).toBe(100_000);
  });

  test("a writable enum becomes a select mapping labels both ways", () => {
    const { component, config } = configFor(
      metric({ key: "setting.mode", writable: true, enumLabels: { 0: "Off", 1: "On" } }),
      constraint({ writable: true, valueType: "enum", enumValues: [0, 1] }),
    );
    expect(component).toBe("select");
    expect(config.options).toEqual(["Off", "On"]);
    expect(config.command_template).toContain('"Off":0');
    expect(String(config.value_template)).toContain('"0":"Off"');
  });

  test("a read-only enum stays a sensor that renders the label", () => {
    const { component, config } = configFor(
      metric({ key: "status.code", enumLabels: { 2: "Normal" } }),
      constraint(),
    );
    expect(component).toBe("sensor");
    expect(config.command_topic).toBeUndefined();
    expect(String(config.value_template)).toContain('"2":"Normal"');
  });
});

describe("forecastDiscoveryConfig", () => {
  test("raw variant is an energy sensor exposing the forecast via json attributes", () => {
    const { component, config } = forecastDiscoveryConfig(topics, "deye", haDevice, "raw");
    expect(component).toBe("sensor");
    expect(config.state_topic).toBe("sunreye/deye/forecast/raw");
    expect(config.json_attributes_topic).toBe("sunreye/deye/forecast/raw/attributes");
    expect(config.availability_topic).toBe("sunreye/deye/status");
    expect(config.unit_of_measurement).toBe("kWh");
    expect(config.device_class).toBe("energy");
    expect(config.unique_id).toBe("sunreye_deye_forecast");
    expect(config.device).toBe(haDevice);
  });

  test("usable variant gets its own topics, unique_id and name", () => {
    const { config } = forecastDiscoveryConfig(topics, "deye", haDevice, "usable");
    expect(config.state_topic).toBe("sunreye/deye/forecast/usable");
    expect(config.json_attributes_topic).toBe("sunreye/deye/forecast/usable/attributes");
    expect(config.unique_id).toBe("sunreye_deye_forecast_usable");
    expect(config.name).toBe("Solar forecast (usable)");
  });
});

// ---------------------------------------------------------------------------
// The bridge itself: connection lifecycle, topics on the wire, inbound commands.
// ---------------------------------------------------------------------------

/**
 * Stands in for `mqtt`'s client. `mqtt` is third-party, so it is stubbed
 * wholesale (no spread needed, and nothing real is reachable) — see
 * CONTRIBUTING §6. Every `connect()` hands out a fresh instance so a suite can
 * drive two bridges without them sharing an event bus.
 */
class FakeClient extends EventEmitter {
  connected = false;
  published: { topic: string; payload: string; opts: Record<string, unknown> }[] = [];
  subscribed: string[][] = [];
  /** Handed to the subscribe callback, as a broker rejecting the SUBSCRIBE would. */
  subscribeError: Error | null = null;
  ended = 0;
  /** Publish acks are withheld until released, to observe close()'s ordering. */
  deferAcks = false;
  #pendingAcks: (() => void)[] = [];

  subscribe(topics: string[], cb: (err?: Error | null) => void): void {
    this.subscribed.push(topics);
    cb(this.subscribeError);
  }

  publish(topic: string, payload: string, opts: Record<string, unknown>, cb?: () => void): void {
    this.published.push({ topic, payload, opts });
    if (!cb) return;
    if (this.deferAcks) this.#pendingAcks.push(cb);
    else cb();
  }

  releaseAcks(): void {
    const acks = this.#pendingAcks.splice(0);
    for (const ack of acks) ack();
  }

  async endAsync(): Promise<void> {
    this.ended += 1;
    this.connected = false;
  }

  topics(): string[] {
    return this.published.map((p) => p.topic);
  }

  payloadOf(topic: string): string | undefined {
    return this.published.findLast((p) => p.topic === topic)?.payload;
  }
}

let clients: FakeClient[] = [];
let connectCalls: { url: string; opts: Record<string, unknown> }[] = [];

mock.module("mqtt", () => ({
  default: {
    connect: (url: string, opts: Record<string, unknown>) => {
      connectCalls.push({ url, opts });
      const client = new FakeClient();
      clients.push(client);
      return client;
    },
  },
}));

const { startMqttBridge } = await import("./mqtt");

const def = ({
  type = "U_WORD",
  addresses = [1],
  ...over
}: Partial<MetricDef> & { key: string; topic: string }): MetricDef => ({
  label: over.key,
  unit: null,
  group: "test",
  type,
  addresses,
  // The codec addresses through the binding; the legacy mirror stays in step
  // with it exactly as `hydrateProfile` keeps it.
  binding: { via: "modbus", addr: addresses, type },
  scale: 1,
  access: "r",
  ...over,
});

/**
 * A miniature but realistic profile: two measurements (one signed, so negative
 * and zero readings are exercised), a cumulative counter, a bounded writable, a
 * writable enum, and a `rw` RAW register — which the entity layer treats as
 * *not* writable despite its access flag.
 */
const profile: InverterProfile = {
  id: "deye-sg05lp3",
  name: "Deye SG05LP3",
  manufacturer: "Deye",
  metrics: [
    def({ key: "pv.power", topic: "pv/power", label: "PV power", unit: "W" }),
    def({
      key: "battery.temperature",
      topic: "battery/temperature",
      label: "Battery temperature",
      unit: "°C",
      type: "S_WORD",
      scale: 0.1,
      offset: -100,
    }),
    def({ key: "grid.import", topic: "grid/import", label: "Grid import", unit: "kWh" }),
    def({
      key: "setting.charge.current",
      topic: "setting/charge/current",
      label: "Max charge current",
      unit: "A",
      access: "rw",
      range: { min: 0, max: 185 },
    }),
    def({
      key: "setting.mode",
      topic: "setting/mode",
      label: "Work mode",
      access: "rw",
      enumLabels: { 0: "Off", 1: "Selling first" },
    }),
    def({
      key: "system.time",
      topic: "system/time",
      label: "System time",
      type: "RAW",
      addresses: [22, 23, 24],
      access: "rw",
    }),
  ],
};

const manifest = buildManifest(profile);
const defByKey = metricByKey(profile);
const metaByKey = new Map(manifest.metrics.map((m) => [m.key, m]));

/** The same rule `buildProfileContext` applies — bounds and enum from the profile. */
function domainValidateWrite(key: string, value: number): string | null {
  const metric = defByKey.get(key);
  if (!metric) return `Unknown entity: ${key}`;
  const c = entityConstraint(metric);
  if (!c.writable) return `Entity is not writable: ${key}`;
  if (c.valueType === "enum") {
    return c.enumValues?.includes(value)
      ? null
      : `Value must be one of: ${c.enumValues?.join(", ")}`;
  }
  if (c.min !== undefined && value < c.min) return `Value ${value} is below minimum ${c.min}`;
  if (c.max !== undefined && value > c.max) return `Value ${value} is above maximum ${c.max}`;
  return null;
}

const baseConfig: MqttConfig = {
  enabled: true,
  brokerUrl: "mqtt://broker.test:1883",
  username: "solar",
  password: "s3cret",
  topicPrefix: "sunreye",
  haDiscoveryEnabled: false,
  haDiscoveryPrefix: "homeassistant",
};

type Harness = {
  bridge: NonNullable<ReturnType<typeof startMqttBridge>>;
  client: FakeClient;
  writes: { key: string; value: number }[];
  /** Simulate the broker completing the connection handshake. */
  connect(): void;
  /** Simulate the socket dropping (what `mqtt` emits before it retries). */
  drop(): void;
  /** Deliver one inbound message and let the async handler settle. */
  deliver(topic: string, payload: string): Promise<void>;
};

function start(
  over: Partial<MqttConfig> = {},
  opts: {
    validateWrite?: ProfileContext["validateWrite"];
    write?: (key: string, value: number) => Promise<void>;
    defByKey?: Map<string, MetricDef>;
  } = {},
): Harness {
  const writes: { key: string; value: number }[] = [];
  const ctx: ProfileContext = {
    profile,
    manifest,
    defByKey: opts.defByKey ?? defByKey,
    metaByKey,
    validateWrite: opts.validateWrite ?? domainValidateWrite,
  };
  // The bridge writes through the production funnel (which owns the validation
  // every entry point shares), so only the transport underneath it is a double.
  const funnel = createControlWriter({
    getSource: () => ({
      profile,
      read: async () => ({ time: "2026-08-15T10:00:00.000Z", inverterId: profile.id, metrics: {} }),
      write: async (key, value) => {
        writes.push({ key, value });
        await opts.write?.(key, value);
      },
      close: async () => {},
    }),
    getContext: () => ctx,
    store: { get: async () => ({}), set: async () => {} },
    readLive: () => undefined,
  });
  const bridge = startMqttBridge({ ...baseConfig, ...over }, { ctx, write: funnel.write });
  if (!bridge) throw new Error("bridge was disabled");
  const client = clients.at(-1);
  if (!client) throw new Error("no client was created");
  return {
    bridge,
    client,
    writes,
    connect() {
      client.connected = true;
      client.emit("connect");
    },
    drop() {
      client.connected = false;
      client.emit("close");
    },
    async deliver(topic, payload) {
      client.emit("message", topic, Buffer.from(payload));
      // The message handler is async (it awaits the inverter write); give the
      // microtask queue a turn so the write has landed before we assert.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const sample = (metrics: Record<string, number>): InverterSample => ({
  time: "2026-08-15T10:00:00.000Z",
  inverterId: profile.id,
  metrics,
});

const forecastView = (todayKwh: number): SolarForecastExport => ({
  provider: "open-meteo",
  stepMinutes: 15,
  utcOffsetSeconds: 7200,
  series: [{ time: "2026-08-15T10:00", watts: 4200, peakWatts: 4600 }],
  todayKwh,
  remainingTodayKwh: todayKwh / 2,
  tomorrowKwh: todayKwh + 1,
  next15: { maxPowerW: 4600, avgPowerW: 4400, energyKwh: 1.1 },
  detailedForecast: [{ period_start: "2026-08-15T10:00:00+02:00", watts: 4200 }],
});

const forecast = (raw: number, usable: number): Record<ForecastVariant, SolarForecastExport> => ({
  raw: forecastView(raw),
  usable: forecastView(usable),
});

beforeEach(() => {
  clients = [];
  connectCalls = [];
  // The discovery gate is module-level process state, so a test that holds it
  // would suppress every announcement in every test that ran afterwards.
  resetDiscoveryGate();
});

describe("enabling the bridge", () => {
  test("a disabled config dials nothing and yields no bridge", () => {
    expect(
      startMqttBridge(
        { ...baseConfig, enabled: false },
        { ctx: null as never, write: async () => {} },
      ),
    ).toBeNull();
    expect(connectCalls).toHaveLength(0);
  });

  test("credentials and the last-will go to the broker on the first dial", () => {
    start();
    expect(connectCalls).toHaveLength(1);
    const [call] = connectCalls;
    expect(call?.url).toBe("mqtt://broker.test:1883");
    expect(call?.opts.username).toBe("solar");
    expect(call?.opts.password).toBe("s3cret");
    // Without the LWT, HA keeps showing the last value of a dead bridge.
    expect(call?.opts.will).toEqual({
      topic: "sunreye/deye-sg05lp3/status",
      payload: "offline",
      qos: 0,
      retain: true,
    });
  });

  test("an absent username and password are simply not sent", () => {
    start({ username: undefined, password: undefined });
    expect(connectCalls[0]?.opts.username).toBeUndefined();
    expect(connectCalls[0]?.opts.password).toBeUndefined();
  });

  test("the topic prefix from the config roots every topic", () => {
    const h = start({ topicPrefix: "house/pv" });
    h.connect();
    h.bridge.publishSample(sample({ "pv.power": 1200 }));
    expect(h.client.topics()).toContain("house/pv/deye-sg05lp3/status");
    expect(h.client.topics()).toContain("house/pv/deye-sg05lp3/pv/power");
  });
});

describe("connecting", () => {
  test("announces availability as retained online", () => {
    const h = start();
    h.connect();
    const status = h.client.published.find((p) => p.topic === "sunreye/deye-sg05lp3/status");
    expect(status?.payload).toBe("online");
    expect(status?.opts).toEqual({ retain: true });
  });

  test("subscribes to every writable entity's command topic, once, in one call", () => {
    const h = start();
    h.connect();
    expect(h.client.subscribed).toEqual([
      [
        "sunreye/deye-sg05lp3/setting/charge/current/set",
        "sunreye/deye-sg05lp3/setting/mode/set",
        "sunreye/deye-sg05lp3/system/time/set",
      ],
    ]);
  });

  test("a profile with nothing writable subscribes to nothing at all", () => {
    const readOnly: InverterProfile = {
      ...profile,
      metrics: profile.metrics.filter((m) => m.access === "r"),
    };
    const bridge = startMqttBridge(baseConfig, {
      ctx: {
        profile: readOnly,
        manifest: buildManifest(readOnly),
        defByKey: metricByKey(readOnly),
        metaByKey: new Map(),
        validateWrite: domainValidateWrite,
      },
      write: async () => {},
    });
    expect(bridge).not.toBeNull();
    const client = clients.at(-1);
    client?.emit("connect");
    expect(client?.subscribed).toEqual([]);
  });

  test("a broker that refuses the subscription still leaves the bridge connected", () => {
    const h = start();
    h.client.subscribeError = new Error("not authorized");
    h.connect();
    expect(h.bridge.status().connected).toBe(true);
  });

  test("a reconnect re-announces availability and re-subscribes", () => {
    const h = start();
    h.connect();
    h.drop();
    h.connect();
    const online = h.client.published.filter(
      (p) => p.topic === "sunreye/deye-sg05lp3/status" && p.payload === "online",
    );
    expect(online).toHaveLength(2);
    expect(h.client.subscribed).toHaveLength(2);
  });

  test("reconnecting clears the error left by the failed attempt", () => {
    const h = start();
    h.client.emit("error", new Error("ECONNREFUSED"));
    expect(h.bridge.status().lastError).toBe("ECONNREFUSED");
    h.connect();
    expect(h.bridge.status()).toEqual({ connected: true, lastError: null });
  });
});

describe("connection status", () => {
  test("starts disconnected with no error", () => {
    expect(start().bridge.status()).toEqual({ connected: false, lastError: null });
  });

  test("a dropped socket reports disconnected without inventing an error", () => {
    const h = start();
    h.connect();
    h.drop();
    expect(h.bridge.status()).toEqual({ connected: false, lastError: null });
  });

  test("an auth failure surfaces the broker's message", () => {
    const h = start();
    h.client.emit("error", new Error("Connection refused: Not authorized"));
    expect(h.bridge.status()).toEqual({
      connected: false,
      lastError: "Connection refused: Not authorized",
    });
  });

  test("a non-Error failure is still reported as text rather than swallowed", () => {
    const h = start();
    h.client.emit("error", "socket hang up");
    expect(h.bridge.status().lastError).toBe("socket hang up");
  });

  test("the latest error wins", () => {
    const h = start();
    h.client.emit("error", new Error("first"));
    h.client.emit("error", new Error("second"));
    expect(h.bridge.status().lastError).toBe("second");
  });
});

describe("publishing samples", () => {
  test("every metric present in the sample lands retained on its own topic", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishSample(sample({ "pv.power": 1234, "grid.import": 87.5 }));
    expect(h.client.published).toEqual([
      { topic: "sunreye/deye-sg05lp3/pv/power", payload: "1234", opts: { retain: true } },
      { topic: "sunreye/deye-sg05lp3/grid/import", payload: "87.5", opts: { retain: true } },
    ]);
  });

  test("zero and negative readings are published — 0 °C is a temperature, not a gap", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishSample(sample({ "pv.power": 0, "battery.temperature": -7.5 }));
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/pv/power")).toBe("0");
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/battery/temperature")).toBe("-7.5");
  });

  test("a metric missing from the sample publishes nothing, leaving its retained value", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishSample(sample({ "pv.power": 10 }));
    expect(h.client.topics()).not.toContain("sunreye/deye-sg05lp3/battery/temperature");
  });

  test("an empty sample publishes nothing", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishSample(sample({}));
    expect(h.client.published).toEqual([]);
  });

  test("a value with no matching metric in the profile is not published", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishSample(sample({ "not.in.profile": 1 }));
    expect(h.client.published).toEqual([]);
  });

  test("samples taken while offline are dropped, not queued for replay", () => {
    const h = start();
    h.connect();
    h.drop();
    h.client.published.length = 0;
    h.bridge.publishSample(sample({ "pv.power": 999 }));
    expect(h.client.published).toEqual([]);
  });
});

describe("publishing the forecast", () => {
  test("each variant gets today's kWh plus the full curve as retained attributes", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    const f = forecast(31.5, 24.25);
    h.bridge.publishForecast(f);
    expect(h.client.published.map((p) => p.topic)).toEqual([
      "sunreye/deye-sg05lp3/forecast/raw",
      "sunreye/deye-sg05lp3/forecast/raw/attributes",
      "sunreye/deye-sg05lp3/forecast/usable",
      "sunreye/deye-sg05lp3/forecast/usable/attributes",
    ]);
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/raw")).toBe("31.5");
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/usable")).toBe("24.25");
    expect(
      JSON.parse(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/usable/attributes") ?? "null"),
    ).toEqual(f.usable);
    expect(h.client.published.every((p) => p.opts.retain === true)).toBe(true);
  });

  test("a nightly zero forecast is published, not mistaken for 'no forecast'", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishForecast(forecast(0, 0));
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/raw")).toBe("0");
  });

  test("no forecast at all publishes nothing", () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    h.bridge.publishForecast(null);
    expect(h.client.published).toEqual([]);
  });

  test("a forecast produced while offline is restored on the next connect", () => {
    const h = start();
    h.bridge.publishForecast(forecast(12, 9));
    expect(h.client.published).toEqual([]);
    h.connect();
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/raw")).toBe("12");
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/usable")).toBe("9");
  });

  test("a reconnect restores the latest forecast rather than the first one", () => {
    const h = start();
    h.connect();
    h.bridge.publishForecast(forecast(12, 9));
    h.bridge.publishForecast(forecast(20, 18));
    h.drop();
    h.client.published.length = 0;
    h.connect();
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/raw")).toBe("20");
  });

  test("a null forecast does not erase the one kept for reconnect", () => {
    const h = start();
    h.connect();
    h.bridge.publishForecast(forecast(12, 9));
    h.bridge.publishForecast(null);
    h.drop();
    h.client.published.length = 0;
    h.connect();
    expect(h.client.payloadOf("sunreye/deye-sg05lp3/forecast/raw")).toBe("12");
  });

  test("a connect with no forecast yet publishes only availability", () => {
    const h = start();
    h.connect();
    expect(h.client.topics().filter((t) => t.includes("forecast"))).toEqual([]);
  });
});

describe("home assistant discovery", () => {
  test("stays silent when discovery is off", () => {
    const h = start({ haDiscoveryEnabled: false });
    h.connect();
    expect(h.client.topics().some((t) => t.startsWith("homeassistant/"))).toBe(false);
  });

  test("announces one retained config per entity plus both forecast sensors", () => {
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    const discovery = h.client.published.filter((p) => p.topic.startsWith("homeassistant/"));
    expect(discovery.map((p) => p.topic)).toEqual([
      "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config",
      "homeassistant/sensor/sunreye_deye-sg05lp3/battery_temperature/config",
      "homeassistant/sensor/sunreye_deye-sg05lp3/grid_import/config",
      "homeassistant/number/sunreye_deye-sg05lp3/setting_charge_current/config",
      "homeassistant/select/sunreye_deye-sg05lp3/setting_mode/config",
      "homeassistant/sensor/sunreye_deye-sg05lp3/system_time/config",
      "homeassistant/sensor/sunreye_deye-sg05lp3/forecast/config",
      "homeassistant/sensor/sunreye_deye-sg05lp3/forecast_usable/config",
    ]);
    // Retained, so HA re-reads them when *it* restarts, not only when we do.
    expect(discovery.every((p) => p.opts.retain === true)).toBe(true);
  });

  test("the announced config carries the state topic the bridge actually publishes on", () => {
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    const config = JSON.parse(
      h.client.payloadOf(
        "homeassistant/number/sunreye_deye-sg05lp3/setting_charge_current/config",
      ) ?? "null",
    );
    expect(config.state_topic).toBe("sunreye/deye-sg05lp3/setting/charge/current");
    expect(config.command_topic).toBe("sunreye/deye-sg05lp3/setting/charge/current/set");
    expect(config.availability_topic).toBe("sunreye/deye-sg05lp3/status");
    expect(config.min).toBe(0);
    expect(config.max).toBe(185);
  });

  test("a custom discovery prefix moves every announcement", () => {
    const h = start({ haDiscoveryEnabled: true, haDiscoveryPrefix: "ha" });
    h.connect();
    expect(h.client.topics()).toContain("ha/sensor/sunreye_deye-sg05lp3/pv_power/config");
  });

  test("a metric with no register definition is skipped instead of crashing the announcement", () => {
    const partial = new Map(defByKey);
    partial.delete("pv.power");
    const h = start({ haDiscoveryEnabled: true }, { defByKey: partial });
    h.connect();
    const discovery = h.client.topics().filter((t) => t.startsWith("homeassistant/"));
    expect(discovery).not.toContain("homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config");
    expect(discovery).toContain("homeassistant/sensor/sunreye_deye-sg05lp3/grid_import/config");
  });

  // THE MIGRATION GATE. A discovery announcement is retained on the broker and
  // Home Assistant keys its entities on `unique_id`, so announcing under a
  // placeholder identity is not something a later rename can take back: the old
  // entities stay, the new ones appear beside them, and every automation the
  // operator built points at the wrong half. The 1.2.0 -> 2.0.0 upgrade
  // synthesises a plant and a device whose slugs the operator has not chosen yet,
  // so the announcement has to WAIT for them. See ../migration/discovery-gate.ts.
  test("a held gate suppresses the announcement entirely", () => {
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    expect(h.client.topics().some((t) => t.startsWith("homeassistant/"))).toBe(false);
  });

  test("availability and commands still work while discovery is held", () => {
    // Holding discovery must not hold the BRIDGE. The dashboard is live from the
    // first minute after the upgrade and the operator can still control the
    // inverter; only the retained HA announcement waits.
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    expect(h.client.published.map((p) => p.topic)).toContain("sunreye/deye-sg05lp3/status");
  });

  test("a reconnect while held STAYS silent — a retry is not a release", () => {
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    h.drop();
    h.connect();
    expect(h.client.topics().some((t) => t.startsWith("homeassistant/"))).toBe(false);
  });

  test("releasing the gate announces immediately, without waiting for a reconnect", () => {
    // The operator confirms their names and expects their entities to appear. A
    // gate that only published on the next connect would wait for the broker to
    // drop, which on a healthy broker is never.
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    releaseDiscovery();
    expect(h.client.topics()).toContain(
      "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config",
    );
  });

  test("releasing while DISCONNECTED does not publish — the next connect does", () => {
    // Publishing into a closed socket would drop the announcement silently, and
    // the gate is already lifted, so nothing would ever retry it.
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    h.drop();
    h.client.published.length = 0;
    releaseDiscovery();
    expect(h.client.topics().some((t) => t.startsWith("homeassistant/"))).toBe(false);
    h.connect();
    expect(h.client.topics()).toContain(
      "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config",
    );
  });

  test("a release published once is not re-published by a later release", () => {
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    releaseDiscovery();
    h.client.published.length = 0;
    releaseDiscovery();
    expect(h.client.topics().some((t) => t.startsWith("homeassistant/"))).toBe(false);
  });

  test("a closed bridge does not announce when the gate lifts later", async () => {
    // The listener has to be removed on stop, or a released gate publishes
    // through a bridge that has been torn down — and on a profile swap, under the
    // OLD profile's identity.
    holdDiscovery("migration onboarding not completed");
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    await h.bridge.close();
    h.client.published.length = 0;
    releaseDiscovery();
    expect(h.client.topics().some((t) => t.startsWith("homeassistant/"))).toBe(false);
  });

  test("a reconnect re-announces, so a broker restart does not lose the entities", () => {
    const h = start({ haDiscoveryEnabled: true });
    h.connect();
    h.drop();
    h.client.published.length = 0;
    h.connect();
    expect(
      h.client
        .topics()
        .filter((t) => t === "homeassistant/sensor/sunreye_deye-sg05lp3/pv_power/config"),
    ).toHaveLength(1);
  });
});

describe("inbound commands", () => {
  test("a valid setpoint is written to the inverter", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "40");
    expect(h.writes).toEqual([{ key: "setting.charge.current", value: 40 }]);
  });

  test("zero is a legitimate setpoint, not a missing value", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "0");
    expect(h.writes).toEqual([{ key: "setting.charge.current", value: 0 }]);
  });

  test("surrounding whitespace from a hand-typed payload is tolerated", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "  60\n");
    expect(h.writes).toEqual([{ key: "setting.charge.current", value: 60 }]);
  });

  test("a fractional setpoint reaches the inverter unrounded", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "12.5");
    expect(h.writes).toEqual([{ key: "setting.charge.current", value: 12.5 }]);
  });

  test("a message on a topic the bridge does not own is ignored", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/pv/power", "1234");
    await h.deliver("evcc/loadpoints/1/limitSoc", "80");
    expect(h.writes).toEqual([]);
  });

  test("the state topic of a writable entity is not a command topic", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current", "40");
    expect(h.writes).toEqual([]);
  });

  test("a non-numeric payload is refused rather than coerced", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "ON");
    expect(h.writes).toEqual([]);
  });

  test("clearing the retained command topic does not write zero to the register", async () => {
    const h = start();
    h.connect();
    // Deleting a retained message is a zero-length publish. `Number("")` is 0,
    // so an unguarded bridge would drive max charge current to 0 A on a tidy-up.
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "");
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "   ");
    expect(h.writes).toEqual([]);
  });

  test("a setpoint above the profile's range is rejected before it reaches the wire", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "300");
    expect(h.writes).toEqual([]);
  });

  test("a negative setpoint below the profile's minimum is rejected", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "-5");
    expect(h.writes).toEqual([]);
  });

  test("an enum accepts a declared raw value and refuses an undeclared one", async () => {
    const h = start();
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/mode/set", "1");
    await h.deliver("sunreye/deye-sg05lp3/setting/mode/set", "7");
    expect(h.writes).toEqual([{ key: "setting.mode", value: 1 }]);
  });

  test("a rw RAW register is refused by the validator even though it has a command topic", async () => {
    const h = start();
    h.connect();
    expect(h.client.subscribed[0]).toContain("sunreye/deye-sg05lp3/system/time/set");
    await h.deliver("sunreye/deye-sg05lp3/system/time/set", "1");
    expect(h.writes).toEqual([]);
  });

  test("the validator's verdict is honoured for every entity", async () => {
    const seen: { key: string; value: number }[] = [];
    const h = start(
      {},
      {
        validateWrite: (key, value) => {
          seen.push({ key, value });
          return "nope";
        },
      },
    );
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "40");
    expect(seen).toEqual([{ key: "setting.charge.current", value: 40 }]);
    expect(h.writes).toEqual([]);
  });

  test("a failing inverter write is contained, and the next command still lands", async () => {
    let fail = true;
    const h = start(
      {},
      {
        write: async () => {
          if (fail) throw new Error("modbus timeout");
        },
      },
    );
    h.connect();
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "40");
    fail = false;
    await h.deliver("sunreye/deye-sg05lp3/setting/charge/current/set", "50");
    expect(h.writes).toEqual([
      { key: "setting.charge.current", value: 40 },
      { key: "setting.charge.current", value: 50 },
    ]);
    expect(h.bridge.status().lastError).toBeNull();
  });

  test("two commands arriving back to back both reach the inverter, in order", async () => {
    const h = start();
    h.connect();
    h.client.emit("message", "sunreye/deye-sg05lp3/setting/charge/current/set", Buffer.from("10"));
    h.client.emit("message", "sunreye/deye-sg05lp3/setting/mode/set", Buffer.from("0"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.writes).toEqual([
      { key: "setting.charge.current", value: 10 },
      { key: "setting.mode", value: 0 },
    ]);
  });
});

describe("shutting down", () => {
  test("flips availability to offline before ending the connection", async () => {
    const h = start();
    h.connect();
    h.client.published.length = 0;
    await h.bridge.close();
    expect(h.client.published).toEqual([
      { topic: "sunreye/deye-sg05lp3/status", payload: "offline", opts: { retain: true } },
    ]);
    expect(h.client.ended).toBe(1);
  });

  test("waits for the broker to ack the offline notice before disconnecting", async () => {
    const h = start();
    h.connect();
    h.client.deferAcks = true;
    let closed = false;
    const closing = h.bridge.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(false);
    expect(h.client.ended).toBe(0);
    h.client.releaseAcks();
    await closing;
    expect(closed).toBe(true);
    expect(h.client.ended).toBe(1);
  });

  test("closing an already-dropped bridge still ends cleanly", async () => {
    const h = start();
    h.connect();
    h.drop();
    await h.bridge.close();
    expect(h.client.ended).toBe(1);
    expect(h.bridge.status().connected).toBe(false);
  });
});
