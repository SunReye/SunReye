/**
 * Oracle group 8 — MQTT and Home Assistant export.
 *
 * What the 3.x publisher puts on the wire, over fixed inputs: the topic layout, the namespace
 * resolved from the plant spine, the discovery announcement of every entity kind, and the bridge
 * driven through connect, state cycles, forecast and close against a recording link. The bridge
 * is the 3.x code itself; only the broker link is a double, so retain and QoS flags are the ones
 * the publisher passes.
 *
 * Monitoring only (ADR 0005): every catalog metric is read-only, so no command topic exists.
 * `number` and `select`, the two kinds that carry `command_topic` and `/set`, are not recorded.
 */
import type { MqttConfig } from "@SunReye/db/mqtt-config";
import type { PlantDb } from "@SunReye/db/plant-repo";
import {
  type InverterProfile,
  type ManifestMetric,
  type MetricDef,
  buildManifest,
  decode,
} from "@SunReye/inverter-core";
import { slugify } from "@SunReye/inverter-core/slug";

import type { BrokerLink, BrokerSubscription } from "../../apps/server/src/devices/broker-pool";
import type { MqttBridge } from "../../apps/server/src/inverter/mqtt";
import type { ProfileContext } from "../../apps/server/src/inverter/inverter";
import type { MqttNamespace } from "../../apps/server/src/inverter/mqtt-discovery";
import type {
  ForecastVariant,
  SolarForecastExport,
  buildSolarForecast as BuildSolarForecast,
} from "../../apps/server/src/forecast/solar-forecast";
import { type CorpusFiles, ndjson } from "./corpus";
import type { OracleGenerator } from "./registry";

type ForecastConfig = Parameters<typeof BuildSolarForecast>[0];

interface Modules {
  mqtt: typeof import("../../apps/server/src/inverter/mqtt");
  discovery: typeof import("../../apps/server/src/inverter/mqtt-discovery");
  namespace: typeof import("../../apps/server/src/inverter/mqtt-namespace");
  forecast: typeof import("../../apps/server/src/forecast/solar-forecast");
  inverter: typeof import("../../apps/server/src/inverter/inverter");
}

/** 2026-03-01T00:02:30.000Z: the instant every cycle runs at. */
const NOW_MS = 1_772_323_350_000;
const NOW = new Date(NOW_MS).toISOString();
/** A reading from before midnight, so the plant's date has turned since. */
const STALE_TIME = "2026-02-28T23:45:00.000Z";
const FRESH_TIME = "2026-03-01T00:02:29.000Z";

const NS: MqttNamespace = { plantSlug: "haus-sud", deviceSlug: "inverter" };
const CONFIG: MqttConfig = {
  connectionId: 1,
  topicPrefix: "sunreye",
  haDiscoveryEnabled: false,
  haDiscoveryPrefix: "homeassistant",
};

// ---------------------------------------------------------------------------
// The catalog: one read-only metric per way the publisher maps a metric to an entity.

type Registers = Record<number, number>;

const def = (
  over: Partial<MetricDef> & { key: string; topic: string; addresses: number[] },
): MetricDef => {
  const type = over.type ?? "U_WORD";
  return {
    label: over.key,
    unit: null,
    group: "test",
    type,
    binding: { via: "modbus", addr: over.addresses, type },
    scale: 1,
    access: "r",
    kind: "measurement",
    ...over,
  } as MetricDef;
};

const METRICS: MetricDef[] = [
  def({ key: "pv.power", topic: "pv/power", label: "PV power", unit: "W", addresses: [1] }),
  def({
    key: "grid.apparent",
    topic: "grid/apparent",
    label: "Apparent power",
    unit: "VA",
    addresses: [2],
  }),
  def({
    key: "grid.import",
    topic: "grid/import",
    label: "Grid import",
    unit: "kWh",
    kind: "cumulative",
    scale: 0.1,
    addresses: [3],
  }),
  def({
    key: "ac.l1.voltage",
    topic: "ac/l1/voltage",
    label: "L1 voltage",
    unit: "V",
    scale: 0.1,
    addresses: [4],
  }),
  def({
    key: "battery.current",
    topic: "battery/current",
    label: "Battery current",
    unit: "A",
    type: "S_WORD",
    scale: 0.01,
    addresses: [5],
  }),
  def({
    key: "grid.frequency",
    topic: "grid/frequency",
    label: "Grid frequency",
    unit: "Hz",
    scale: 0.01,
    addresses: [6],
  }),
  def({
    key: "battery.temperature",
    topic: "battery/temperature",
    label: "Battery temperature",
    unit: "°C",
    type: "S_WORD",
    scale: 0.1,
    offset: -100,
    addresses: [7],
  }),
  def({
    key: "battery.soc",
    topic: "battery/soc",
    label: "Battery SOC",
    unit: "%",
    role: "battery.soc",
    addresses: [8],
  }),
  def({ key: "pv.ratio", topic: "pv/ratio", label: "PV ratio", unit: "%", addresses: [9] }),
  def({ key: "system.counter", topic: "system/counter", label: "Counter", addresses: [10] }),
  def({ key: "fan.speed", topic: "fan/speed", label: "Fan speed", unit: "rpm", addresses: [11] }),
  def({
    key: "status.code",
    topic: "status/code",
    label: "Status",
    kind: "status",
    enumLabels: { 0: "Standby", 1: "Normal", 2: "Fault" },
    addresses: [12],
  }),
  def({
    key: "status.flags",
    topic: "status/flags",
    label: "Flags",
    kind: "status",
    addresses: [13],
  }),
];

const profileOf = (id: string, name: string, manufacturer: string): InverterProfile => ({
  id,
  name,
  manufacturer,
  metrics: METRICS,
});

const DEYE = profileOf("deye-sg05lp3", "Deye SG05LP3", "Deye");
const SOFAR = profileOf("sofar-hyd-6000", "Sofar HYD 6000", "Sofar");

/** A register map to the readings the 3.x codec makes of it. */
function readingsOf(registers: Registers): Record<string, number> {
  const words = new Map(Object.entries(registers).map(([addr, word]) => [Number(addr), word]));
  const readings: Record<string, number> = {};
  for (const m of METRICS) {
    const value = decode(m, words);
    if (value !== undefined) readings[m.key] = value;
  }
  return readings;
}

// ---------------------------------------------------------------------------
// The recording link

interface Publish {
  topic: string;
  options: Record<string, unknown>;
  /** A non-JSON payload, verbatim. */
  payload?: string;
  /** A JSON payload, parsed. */
  json?: unknown;
}

const recorded = (topic: string, payload: string, options: Record<string, unknown>): Publish => {
  const base = { topic, options };
  if (/^[{[]/.test(payload)) return { ...base, json: JSON.parse(payload) };
  return { ...base, payload };
};

/** The members the bridge calls on its link; `status` and `update` belong to the pool's other callers. */
type BridgeLink = Pick<
  BrokerLink,
  "connectionId" | "brokerUrl" | "connected" | "subscribe" | "publish" | "release"
>;

interface Wire {
  link: BridgeLink;
  setConnected(connected: boolean): void;
  subscription(): BrokerSubscription | null;
  declareWill(will: unknown): void;
  will(): unknown;
  /** What went out since the last call. */
  take(): Publish[];
}

function createWire(): Wire {
  let connected = false;
  let subscription: BrokerSubscription | null = null;
  let will: unknown = null;
  const log: Publish[] = [];
  const link: BridgeLink = {
    connectionId: 1,
    brokerUrl: "mqtt://broker.test:1883",
    get connected() {
      return connected;
    },
    subscribe: (next) => {
      subscription = next;
    },
    publish: (topic, payload, options, callback) => {
      log.push(recorded(topic, payload, { ...options }));
      callback?.();
    },
    release: async () => {},
  };
  return {
    link,
    setConnected: (next) => {
      connected = next;
    },
    subscription: () => subscription,
    declareWill: (next) => {
      will = next;
    },
    will: () => will,
    take: () => log.splice(0),
  };
}

// ---------------------------------------------------------------------------
// Bridge scripts

type Step =
  | { do: "connect" }
  | { do: "drop" }
  | { do: "sample"; time: string; registers: Registers }
  | { do: "forecast"; forecast: "fixed" | null }
  | { do: "close" };

interface BridgeInput {
  catalog: "main";
  config: MqttConfig;
  namespace: MqttNamespace;
  profile: { id: string; name: string; manufacturer: string };
  steps: Step[];
}

interface BridgeOutput {
  will: unknown;
  /** Topics the bridge subscribed to: the command topics of writable entities. */
  subscribed: readonly string[];
  steps: Array<{ do: Step["do"]; readings?: Record<string, number>; published: Publish[] }>;
}

/** The forecast every `forecast` step publishes. */
const FORECAST_INPUT = {
  config: {
    enabled: true,
    provider: "open-meteo",
    arrays: [{ kwp: 10, tilt: 30, azimuth: 0 }],
    tempCoefficient: -0.4,
    systemLoss: 14,
    maxOutputW: null,
    battery: null,
    houseLoadW: null,
    smartMeterSince: null,
    correction: { enabled: false },
  } satisfies ForecastConfig,
  data: {
    times: ["2026-03-01T09:00", "2026-03-01T10:00", "2026-03-01T11:00", "2026-03-01T12:00"],
    utcOffsetSeconds: 3600,
    location: { latitude: 50.39, longitude: 8.06 },
    temperature: [4.5, 6, 7.5, 8],
    gti: [[120, 340, 520, 610]],
  },
  provider: "open-meteo",
  timeZone: "Europe/Berlin",
  nowMs: NOW_MS,
};

const forecastExports = (m: Modules): Record<ForecastVariant, SolarForecastExport> => {
  const { config, data, provider, timeZone, nowMs } = FORECAST_INPUT;
  const built = m.forecast.buildSolarForecast(config, data, provider, timeZone, nowMs);
  return {
    raw: m.forecast.toForecastExport(built, "raw"),
    usable: m.forecast.toForecastExport(built, "usable"),
  };
};

function contextOf(m: Modules, input: BridgeInput): ProfileContext & MqttNamespace {
  const profile = profileOf(input.profile.id, input.profile.name, input.profile.manufacturer);
  return { ...m.inverter.buildProfileContext(profile), ...input.namespace };
}

/** What one step does to the bridge and the wire; the readings a sample step decoded come back. */
interface Run {
  m: Modules;
  wire: Wire;
  bridge: MqttBridge;
  inverterId: string;
}

type StepHandlers = { [K in Step["do"]]: (run: Run, step: Extract<Step, { do: K }>) => object };

const STEP_HANDLERS: StepHandlers = {
  connect: ({ wire }) => {
    wire.setConnected(true);
    wire.subscription()?.onConnect?.();
    return {};
  },
  drop: ({ wire }) => {
    wire.setConnected(false);
    return {};
  },
  sample: ({ bridge, inverterId }, step) => {
    const readings = readingsOf(step.registers);
    bridge.publishSample({ time: step.time, inverterId, metrics: readings });
    return { readings };
  },
  forecast: ({ bridge, m }, step) => {
    bridge.publishForecast(step.forecast === null ? null : forecastExports(m));
    return {};
  },
  close: ({ bridge }) => {
    void bridge.close();
    return {};
  },
};

const stepHandler = <K extends Step["do"]>(step: Extract<Step, { do: K }>): StepHandlers[K] =>
  STEP_HANDLERS[step.do as K];

type BridgeDeps = Parameters<Modules["mqtt"]["startMqttBridge"]>[1];

function startBridge(m: Modules, input: BridgeInput, wire: Wire): MqttBridge {
  const bridge = m.mqtt.startMqttBridge(input.config, {
    ctx: contextOf(m, input),
    // The recorded bridge owns no command topic, so nothing calls `write`; and a sweep recorded
    // as done today reads its state and stops, so `writeState` and `legacyProfileIds` stay unread.
    legacyRetirement: {
      readState: async () => ({ at: NOW, profileIds: [], topics: 0 }),
    },
    acquire: (options: Parameters<BridgeDeps["acquire"]>[0]) => {
      wire.declareWill(options.will);
      return wire.link;
    },
  } as unknown as BridgeDeps);
  if (!bridge) throw new Error("the bridge did not start");
  return bridge;
}

function runBridge(m: Modules, input: BridgeInput): BridgeOutput {
  const wire = createWire();
  const run: Run = { m, wire, bridge: startBridge(m, input, wire), inverterId: input.profile.id };
  const steps = input.steps.map((step) => {
    const extra = stepHandler(step)(run, step as never);
    return { do: step.do, ...extra, published: wire.take() };
  });
  return { will: wire.will(), subscribed: wire.subscription()?.topics ?? [], steps };
}

const bridgeInput = (over: Partial<BridgeInput> & { steps: Step[] }): BridgeInput => ({
  catalog: "main",
  config: CONFIG,
  namespace: NS,
  profile: { id: DEYE.id, name: DEYE.name, manufacturer: DEYE.manufacturer },
  ...over,
});

const withDiscovery = (over: Partial<MqttConfig> = {}): MqttConfig => ({
  ...CONFIG,
  haDiscoveryEnabled: true,
  ...over,
});

const CONNECT: Step = { do: "connect" };
const sampleStep = (registers: Registers, time = FRESH_TIME): Step => ({
  do: "sample",
  time,
  registers,
});

/** Every register of the catalog, a plausible mid-day state. */
const FULL: Registers = {
  1: 4321,
  2: 5000,
  3: 12345,
  4: 2304,
  5: 64302,
  6: 5001,
  7: 1234,
  8: 87,
  9: 55,
  10: 7,
  11: 1500,
  12: 1,
  13: 3,
};

interface BridgeCase {
  case: string;
  input: BridgeInput;
}

const BRIDGE_CASES: BridgeCase[] = [
  { case: "bridge/connect", input: bridgeInput({ steps: [CONNECT] }) },
  {
    case: "bridge/connect-discovery",
    input: bridgeInput({ config: withDiscovery(), steps: [CONNECT] }),
  },
  {
    case: "bridge/discovery-custom-prefixes",
    input: bridgeInput({
      config: withDiscovery({ topicPrefix: "home/solar", haDiscoveryPrefix: "ha" }),
      namespace: { plantSlug: "haus-sud", deviceSlug: "inverter-2" },
      steps: [CONNECT],
    }),
  },
  {
    case: "bridge/reconnect-republishes",
    input: bridgeInput({
      config: withDiscovery(),
      steps: [CONNECT, { do: "drop" }, CONNECT],
    }),
  },
  { case: "bridge/close", input: bridgeInput({ steps: [CONNECT, { do: "close" }] }) },
  {
    case: "state/rounding-and-sign",
    input: bridgeInput({ steps: [CONNECT, sampleStep(FULL)] }),
  },
  {
    case: "state/zero-and-missing",
    input: bridgeInput({
      steps: [CONNECT, sampleStep({ 1: 0, 4: 0, 5: 0, 7: 1000, 8: 0, 12: 0 })],
    }),
  },
  { case: "state/empty-sample", input: bridgeInput({ steps: [CONNECT, sampleStep({})] }) },
  {
    case: "state/stale-sample-across-midnight",
    input: bridgeInput({ steps: [CONNECT, sampleStep(FULL, STALE_TIME)] }),
  },
  {
    case: "state/offline-publishes-nothing",
    input: bridgeInput({ steps: [CONNECT, { do: "drop" }, sampleStep(FULL)] }),
  },
  {
    case: "state/second-cycle-republishes-unchanged",
    input: bridgeInput({ steps: [CONNECT, sampleStep(FULL), sampleStep(FULL)] }),
  },
  {
    case: "forecast/connected",
    input: bridgeInput({ steps: [CONNECT, { do: "forecast", forecast: "fixed" }] }),
  },
  {
    case: "forecast/null-is-a-noop",
    input: bridgeInput({ steps: [CONNECT, { do: "forecast", forecast: null }] }),
  },
  {
    case: "forecast/offline-then-restored-on-connect",
    input: bridgeInput({ steps: [{ do: "forecast", forecast: "fixed" }, CONNECT] }),
  },
];

const withTimes = (c: BridgeCase): BridgeCase["input"] & { now: string; sampleTime?: string } => {
  const sample = c.input.steps.find((s) => s.do === "sample");
  return {
    ...c.input,
    now: NOW,
    ...(sample?.do === "sample" ? { sampleTime: sample.time } : {}),
  };
};

// ---------------------------------------------------------------------------
// Discovery: one case per entity kind, read off the announcements of a connect with discovery on.

/** Entity kind to the catalog metric it is shown by; `null` is a forecast variant. */
const KINDS: Array<{ kind: string; objectId: string }> = [
  { kind: "sensor-power", objectId: "pv_power" },
  { kind: "sensor-apparent-power", objectId: "grid_apparent" },
  { kind: "sensor-energy-cumulative", objectId: "grid_import" },
  { kind: "sensor-voltage", objectId: "ac_l1_voltage" },
  { kind: "sensor-current", objectId: "battery_current" },
  { kind: "sensor-frequency", objectId: "grid_frequency" },
  { kind: "sensor-temperature", objectId: "battery_temperature" },
  { kind: "sensor-battery-soc", objectId: "battery_soc" },
  { kind: "sensor-percent-plain", objectId: "pv_ratio" },
  { kind: "sensor-unitless", objectId: "system_counter" },
  { kind: "sensor-unit-without-class", objectId: "fan_speed" },
  { kind: "sensor-enum-label", objectId: "status_code" },
  { kind: "sensor-status-no-state-class", objectId: "status_flags" },
  { kind: "forecast-raw", objectId: "forecast" },
  { kind: "forecast-usable", objectId: "forecast_usable" },
];

const announcementOf = (m: Modules, input: BridgeInput, objectId: string): Publish => {
  const [connect] = runBridge(m, input).steps;
  const found = connect?.published.find((p) => p.topic.endsWith(`/${objectId}/config`));
  if (!found) throw new Error(`no announcement for ${objectId}`);
  return found;
};

function discoveryRows(m: Modules): unknown[] {
  const input = bridgeInput({ config: withDiscovery(), steps: [CONNECT] });
  const kindRows = KINDS.map(({ kind, objectId }) => ({
    case: `discovery/${kind}`,
    entityKind: kind,
    input: { catalog: "main", objectId, config: input.config, namespace: input.namespace },
    output: { announcement: announcementOf(m, input, objectId) },
  }));
  const at = (namespace: MqttNamespace, over: Partial<BridgeInput> = {}): BridgeInput =>
    bridgeInput({ config: withDiscovery(), namespace, steps: [CONNECT], ...over });
  const power = (b: BridgeInput) => ({
    catalog: "main",
    objectId: "pv_power",
    config: b.config,
    namespace: b.namespace,
    profile: b.profile,
  });
  const dashed = at({ plantSlug: "haus-sud", deviceSlug: "inverter-2" });
  const separators = at({ plantSlug: "haus-sud", deviceSlug: "--" });
  const swapped = at(NS, {
    profile: { id: SOFAR.id, name: SOFAR.name, manufacturer: SOFAR.manufacturer },
  });
  const plain = at(NS);
  return [
    ...kindRows,
    {
      case: "discovery/dashed-device-slug",
      input: power(dashed),
      output: { announcement: announcementOf(m, dashed, "pv_power") },
    },
    {
      case: "discovery/separator-only-device-slug",
      input: power(separators),
      output: { announcement: announcementOf(m, separators, "pv_power") },
    },
    {
      case: "discovery/profile-swap",
      input: { before: power(plain), after: power(swapped) },
      output: {
        before: announcementOf(m, plain, "pv_power"),
        after: announcementOf(m, swapped, "pv_power"),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Topics, slugs and the namespace

const MANIFEST_METRICS: ManifestMetric[] = buildManifest(DEYE).metrics;

function topicsRow(m: Modules, name: string, prefix: string, ns: MqttNamespace): unknown {
  const topics = m.discovery.topicsFor(prefix, ns);
  const variants = m.discovery.FORECAST_VARIANTS;
  return {
    case: `topics/${name}`,
    input: { prefix, namespace: ns, metrics: MANIFEST_METRICS.map((x) => x.key) },
    output: {
      base: topics.base,
      availability: topics.availability,
      state: Object.fromEntries(MANIFEST_METRICS.map((x) => [x.key, topics.state(x)])),
      forecastState: Object.fromEntries(variants.map((v) => [v, topics.forecastState(v)])),
      forecastAttributes: Object.fromEntries(variants.map((v) => [v, topics.forecastAttrs(v)])),
      identityPrefix: m.discovery.identityPrefix(ns),
      forecastObjectIds: Object.fromEntries(
        variants.map((v) => [v, m.discovery.forecastObjectId(v)]),
      ),
    },
  };
}

function topicRows(m: Modules): unknown[] {
  return [
    topicsRow(m, "plain", "sunreye", NS),
    topicsRow(m, "custom-prefix", "home/solar", {
      plantSlug: "haus-sud",
      deviceSlug: "inverter-2",
    }),
    topicsRow(m, "awkward-slugs-verbatim", "sunreye", {
      plantSlug: "Haus Süd",
      deviceSlug: "wr.1",
    }),
    topicsRow(m, "empty-slugs-verbatim", "sunreye", { plantSlug: "", deviceSlug: "" }),
  ];
}

const METRIC_KEYS = [
  "pv.power",
  "battery.soc",
  "ac.l1.voltage",
  "Süd Dach",
  "a b.c",
  "x-y_z",
  "a/b",
  "",
];
const DEVICE_NAMES = ["Haus Süd", "Wechselrichter 1.0", "Dach.Ost / 2", "  Ünïcode  ", "!!!", ""];

function slugRows(m: Modules): unknown[] {
  return [
    {
      case: "slug/metric-keys",
      input: { keys: METRIC_KEYS },
      output: { slugs: Object.fromEntries(METRIC_KEYS.map((k) => [k, m.discovery.slug(k)])) },
    },
    {
      case: "slugify/device-names",
      input: { names: DEVICE_NAMES },
      output: { slugs: Object.fromEntries(DEVICE_NAMES.map((n) => [n, slugify(n)])) },
    },
  ];
}

interface RosterDevice {
  id: number;
  slug: string;
  profileId: string;
  role: string;
  retired: boolean;
}

const rosterDevice = (
  over: Partial<RosterDevice> & { id: number; slug: string },
): RosterDevice => ({
  profileId: DEYE.id,
  role: "inverter",
  retired: false,
  ...over,
});

interface NamespaceCase {
  case: string;
  plant: { name: string; slug: string } | null;
  devices: RosterDevice[];
  profileId: string;
}

const NAMESPACE_CASES: NamespaceCase[] = [
  {
    case: "namespace/plain",
    plant: { name: "Haus Süd", slug: "haus-sud" },
    devices: [rosterDevice({ id: 1, slug: "inverter" })],
    profileId: DEYE.id,
  },
  {
    case: "namespace/slug-of-an-umlaut-name",
    plant: { name: "Ferienhaus Süd", slug: slugify("Ferienhaus Süd") },
    devices: [rosterDevice({ id: 1, slug: slugify("Wechselrichter Dach.Ost") })],
    profileId: DEYE.id,
  },
  {
    case: "namespace/retired-lowest-id",
    plant: { name: "Haus Süd", slug: "haus-sud" },
    devices: [
      rosterDevice({ id: 1, slug: "inverter", profileId: "old", retired: true }),
      rosterDevice({ id: 2, slug: "inverter-2", profileId: "old" }),
    ],
    profileId: DEYE.id,
  },
  {
    case: "namespace/blank-device-slug",
    plant: { name: "Haus Süd", slug: "haus-sud" },
    devices: [rosterDevice({ id: 1, slug: " " })],
    profileId: DEYE.id,
  },
  {
    case: "namespace/no-plant",
    plant: null,
    devices: [rosterDevice({ id: 1, slug: "inverter" })],
    profileId: DEYE.id,
  },
];

const sqlText = (query: unknown): string => {
  const chunks = (query as { queryChunks?: unknown[] }).queryChunks;
  if (!chunks) return "";
  return chunks
    .map((chunk) => {
      const value = (chunk as { value?: unknown }).value;
      if (Array.isArray(value)) return value.join("");
      if (typeof value === "string") return value;
      return sqlText(chunk);
    })
    .join(" ");
};

/** Answers the plant read, then the device read; honours a `retired_at is null` clause in the statement. */
function rosterDb(c: NamespaceCase): PlantDb {
  let calls = 0;
  return {
    execute: async (query: unknown) => {
      calls += 1;
      if (calls === 1) {
        return { rows: c.plant === null ? [] : [plantRow(c.plant)] };
      }
      const live = /retired_at\s+is\s+null/i.test(sqlText(query));
      return { rows: c.devices.filter((d) => !(live && d.retired)).map(deviceRow) };
    },
  } as PlantDb;
}

const plantRow = (plant: { name: string; slug: string }) => ({
  id: 1,
  ...plant,
  timeZone: "Europe/Berlin",
  latitude: null,
  longitude: null,
  label: "",
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  maxOutputW: null,
  houseLoadW: null,
  smartMeterSince: null,
  biddingZone: null,
  tariffKey: null,
});

const deviceRow = (d: RosterDevice) => ({
  id: d.id,
  slug: d.slug,
  name: d.slug,
  profileId: d.profileId,
  role: d.role,
  unitId: 1,
  connectionId: 1,
  arrays: [],
  tempCoefficient: -0.4,
  systemLoss: 14,
  retiredAt: d.retired ? "2026-01-01T00:00:00.000Z" : null,
});

async function namespaceRows(m: Modules): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const c of NAMESPACE_CASES) {
    const output = await m.namespace
      .readMqttNamespace(c.profileId, rosterDb(c))
      .then((namespace) => ({ namespace }))
      .catch((error: Error) => ({ error: { name: error.name, message: error.message } }));
    rows.push({
      case: c.case,
      input: { plant: c.plant, devices: c.devices, profileId: c.profileId },
      output,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------

/** Everything the bridge puts on the wire, and everything it subscribes to. */
function noCommandRow(m: Modules): unknown {
  const input = bridgeInput({
    config: withDiscovery(),
    steps: [
      CONNECT,
      sampleStep(FULL),
      { do: "forecast", forecast: "fixed" },
      { do: "drop" },
      CONNECT,
      { do: "close" },
    ],
  });
  const out = runBridge(m, input);
  const published = out.steps.flatMap((s) => s.published);
  const topics = [...new Set([...published.map((p) => p.topic), ...out.subscribed])].sort();
  return {
    case: "topics/no-command-topic",
    input,
    output: {
      topics,
      subscribed: out.subscribed,
      commandTopics: topics.filter((t) => t.endsWith("/set")),
      commandTopicFields: published.flatMap((p) =>
        p.json !== undefined && "command_topic" in (p.json as object) ? [p.topic] : [],
      ),
    },
  };
}

async function loadModules(): Promise<Modules> {
  // The 3.x modules import the server env through their logger; the pure paths read none of it.
  process.env.SKIP_ENV_VALIDATION ??= "1";
  return {
    mqtt: await import("../../apps/server/src/inverter/mqtt"),
    discovery: await import("../../apps/server/src/inverter/mqtt-discovery"),
    namespace: await import("../../apps/server/src/inverter/mqtt-namespace"),
    forecast: await import("../../apps/server/src/forecast/solar-forecast"),
    inverter: await import("../../apps/server/src/inverter/inverter"),
  };
}

async function buildMqttCorpus(): Promise<CorpusFiles> {
  const m = await loadModules();
  const catalog = {
    case: "catalog/main",
    profile: { id: DEYE.id, name: DEYE.name, manufacturer: DEYE.manufacturer },
    swappedProfile: { id: SOFAR.id, name: SOFAR.name, manufacturer: SOFAR.manufacturer },
    now: NOW,
    metrics: METRICS.map((metric, i) => ({
      ...MANIFEST_METRICS[i],
      register: {
        addr: metric.addresses,
        type: metric.type,
        scale: metric.scale,
        offset: metric.offset ?? 0,
      },
    })),
    forecast: FORECAST_INPUT,
  };
  return {
    "mqtt.ndjson": ndjson([
      catalog,
      ...slugRows(m),
      ...(await namespaceRows(m)),
      ...topicRows(m),
      ...discoveryRows(m),
      ...BRIDGE_CASES.map((c) => ({
        case: c.case,
        input: withTimes(c),
        output: runBridge(m, c.input),
      })),
      noCommandRow(m),
    ]),
  };
}

export const oracle: OracleGenerator = {
  files: ["mqtt.ndjson"],
  build: buildMqttCorpus,
};
