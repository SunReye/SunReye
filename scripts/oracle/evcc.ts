/**
 * Oracle group — EVCC read-only ingest.
 *
 * What the 3.x ingest (`apps/server/src/evcc/`) makes of EVCC's MQTT state, over fixed inputs:
 * the topic grammar and payload coercion, the fold of retained and live topics into `EvccState`,
 * the charge-power estimator on an injected clock, and the device rows and readings the registrar
 * commits. The ingest runs against a recording broker link; no timer fires (each run is stopped
 * before its emit debounce), so every state is read with `snapshot()`.
 *
 * Monitoring only (ADR 0005): `control` and the `mode/set` feed-forward are never driven.
 */
import type { EvccLoadpoint, EvccState } from "@SunReye/contracts/evcc";
import type { MqttParams } from "@SunReye/db/connection-kinds";
import type { EvccConfig } from "@SunReye/db/evcc-config";
import type { DeviceInstance } from "@SunReye/inverter-core";

import type { BrokerLink, BrokerSubscription } from "../../apps/server/src/devices/broker-pool";
import {
  type LoadpointParams,
  createEvPowerEstimator,
} from "../../apps/server/src/evcc/ev-power-estimator";
import { createEvccIngest } from "../../apps/server/src/evcc/evcc";
import { LOADPOINT_METRICS, loadpointDeviceSpec } from "../../apps/server/src/evcc/evcc-devices";
import {
  type DeviceRowState,
  createLoadpointRegistrar,
} from "../../apps/server/src/evcc/evcc-registrar";
import {
  coercePayload,
  parseLoadpointTopic,
  parseVehicleTopic,
} from "../../apps/server/src/evcc/evcc-topics";
import { type CorpusFiles, ndjson } from "./corpus";
import type { OracleGenerator } from "./registry";

// ---------------------------------------------------------------------------
// Topic grammar and payload coercion

const DEFAULT_ROOT_TOPICS = [
  "evcc/loadpoints/1/chargePower",
  "evcc/loadpoints/2/mode",
  "evcc/loadpoints/1/chargeCurrents/l1",
  "evcc/loadpoints",
  "evcc/loadpoints/1",
  "evcc/loadpoints/1/",
  "evcc/loadpoints//mode",
  "evcc/loadpoints/0/mode",
  "evcc/loadpoints/-1/mode",
  "evcc/loadpoints/1.5/mode",
  "evcc/loadpoints/x/mode",
  "evcc/loadpoints/01/mode",
  "evcc/loadpoints/1e0/mode",
  "evcc/loadpoints/1/mode/set",
  "evcc/loadpoints/1/limitSoc/set",
  "evcc/vehicles/tesla_ble/capacity",
  "evcc/vehicles/tesla_ble/limitSoc",
  "evcc/vehicles/tesla_ble/limitSoc/set",
  "evcc/vehicles",
  "evcc/vehicles/tesla_ble",
  "evcc/status",
  "evcc/site/pvPower",
  "evccx/loadpoints/1/mode",
  "",
];

const CUSTOM_ROOT_TOPICS = [
  "home/evcc/loadpoints/2/mode",
  "home/evcc/vehicles/zoe/soc",
  "home/evcc/status",
  "evcc/loadpoints/2/mode",
];

const topicRow = (name: string, root: string, topics: readonly string[]) => ({
  case: `topic/${name}`,
  input: { root, topics },
  output: topics.map((topic) => ({
    topic,
    loadpoint: parseLoadpointTopic(root, topic),
    vehicle: parseVehicleTopic(root, topic),
  })),
});

const PAYLOADS = [
  "",
  "  ",
  "null",
  "true",
  "false",
  "True",
  "0",
  "-12.5",
  " 42 ",
  "1e3",
  "0x10",
  "NaN",
  "abc",
  "1x",
  "online",
  '[{"soc":80}]',
];

function grammarRows(): unknown[] {
  return [
    topicRow("default-root", "evcc", DEFAULT_ROOT_TOPICS),
    topicRow("custom-root", "home/evcc", CUSTOM_ROOT_TOPICS),
    {
      case: "payload/coercion",
      input: { raws: PAYLOADS },
      output: PAYLOADS.map((raw) => ({ raw, value: coercePayload(raw) })),
    },
  ];
}

// ---------------------------------------------------------------------------
// The ingest against a recording link

type IngestStep =
  | { do: "connect" }
  | { do: "drop" }
  | { do: "message"; topic: string; payload: string; retained: boolean }
  | { do: "load"; watts: number | null };

interface IngestInput {
  config: EvccConfig;
  /** The `evcc-ingest` row's topic root, or null when the setting answers. */
  rowTopicRoot: string | null;
  steps: IngestStep[];
}

interface Wire {
  link: BrokerLink;
  subscription(): BrokerSubscription | null;
  setConnected(connected: boolean): void;
  published: Array<{ topic: string; payload: string }>;
}

function createWire(): Wire {
  let connected = false;
  let subscription: BrokerSubscription | null = null;
  const published: Wire["published"] = [];
  const link = {
    connectionId: 3,
    brokerUrl: "mqtt://broker.test:1883",
    get connected() {
      return connected;
    },
    subscribe: (next: BrokerSubscription) => {
      subscription = next;
    },
    publish: (topic: string, payload: string) => {
      published.push({ topic, payload });
    },
    release: async () => {},
  } as unknown as BrokerLink;
  return {
    link,
    subscription: () => subscription,
    setConnected: (next) => {
      connected = next;
    },
    published,
  };
}

type Ingest = ReturnType<typeof createEvccIngest>;
type StepHandlers = {
  [K in IngestStep["do"]]: (
    wire: Wire,
    ingest: Ingest,
    step: Extract<IngestStep, { do: K }>,
  ) => void;
};

const STEP_HANDLERS: StepHandlers = {
  connect: (wire) => {
    wire.setConnected(true);
    wire.subscription()?.onConnect?.();
  },
  drop: (wire) => {
    wire.setConnected(false);
    wire.subscription()?.onClose?.();
  },
  message: (wire, _ingest, step) => {
    wire.subscription()?.onMessage?.(step.topic, Buffer.from(step.payload));
  },
  load: (_wire, ingest, step) => ingest.onLoadSample(step.watts),
};

const applyStep = <K extends IngestStep["do"]>(
  wire: Wire,
  ingest: Ingest,
  step: Extract<IngestStep, { do: K }>,
): void => (STEP_HANDLERS[step.do as K] as StepHandlers[K])(wire, ingest, step);

const silent = { info: () => {}, error: () => {}, warn: () => {} };

async function runIngest(input: IngestInput) {
  const wire = createWire();
  const ingest = createEvccIngest({
    streams: { emit: () => {} },
    readConfig: async () => input.config,
    readBroker: async (id) =>
      id === null ? null : ({ brokerUrl: "mqtt://broker.test:1883" } as MqttParams),
    readTopicRoot: async (fallback) => input.rowTopicRoot ?? fallback,
    pool: { acquire: () => wire.link },
    logger: silent,
  });
  await ingest.rebuild();
  const steps = input.steps.map((step) => {
    applyStep(wire, ingest, step as never);
    return { do: step.do, state: ingest.snapshot() };
  });
  // Clears the emit debounce the messages armed, so no timer outlives the run.
  await ingest.stop();
  return {
    subscribed: wire.subscription()?.topics ?? [],
    published: wire.published,
    steps,
  };
}

const CONFIG: EvccConfig = {
  enabled: true,
  connectionId: 3,
  topicRoot: "evcc",
  subtractFromHome: false,
};

const CONNECT: IngestStep = { do: "connect" };
const ONLINE = msg("evcc/status", "online");

function msg(topic: string, payload: string, retained = true): IngestStep {
  return { do: "message", topic, payload, retained };
}

const lp = (index: number, key: string, payload: string, retained = true): IngestStep =>
  msg(`evcc/loadpoints/${index}/${key}`, payload, retained);

const ingestInput = (steps: IngestStep[], over: Partial<IngestInput> = {}): IngestInput => ({
  config: CONFIG,
  rowTopicRoot: null,
  steps,
  ...over,
});

const RETAINED_LP1: IngestStep[] = [
  ONLINE,
  msg("evcc/loadpoints", "1"),
  lp(1, "title", "Carport"),
  lp(1, "mode", "pv"),
  lp(1, "chargePower", "0"),
  lp(1, "charging", "false"),
  lp(1, "connected", "true"),
  lp(1, "vehicleSoc", "54"),
  lp(1, "phasesActive", "3"),
  lp(1, "chargeCurrents/l1", "6"),
];

const FOLD_CASES: Array<{ case: string; input: IngestInput }> = [
  {
    case: "fold/retained-snapshot-then-live",
    input: ingestInput([
      CONNECT,
      ...RETAINED_LP1,
      lp(1, "chargePower", "4140", false),
      lp(1, "charging", "true", false),
    ]),
  },
  {
    case: "fold/vehicle-joined-by-name",
    input: ingestInput([
      CONNECT,
      ONLINE,
      msg("evcc/vehicles/tesla_ble/capacity", "75"),
      msg("evcc/vehicles/tesla_ble/title", "Model 3"),
      msg("evcc/vehicles/zoe/capacity", "0"),
      lp(1, "vehicleName", "tesla_ble"),
      lp(2, "vehicleName", "guest"),
      lp(2, "vehicleTitle", "Guest car"),
      lp(3, "vehicleName", "zoe"),
    ]),
  },
  {
    case: "fold/effective-limit-soc",
    input: ingestInput([
      CONNECT,
      ONLINE,
      lp(1, "limitSoc", "0"),
      lp(1, "effectiveLimitSoc", "80"),
      lp(1, "vehicleLimitSoc", "90"),
      lp(1, "batteryBoost", "false"),
      lp(1, "batteryBoostLimit", "100"),
    ]),
  },
  {
    case: "fold/evcc-offline",
    input: ingestInput([CONNECT, ...RETAINED_LP1, msg("evcc/status", "offline", false)]),
  },
  {
    case: "fold/status-never-seen",
    input: ingestInput([CONNECT, lp(1, "chargePower", "1000")]),
  },
  {
    case: "fold/broker-dropped",
    input: ingestInput([CONNECT, ...RETAINED_LP1, { do: "drop" }]),
  },
  {
    case: "fold/loadpoint-vanishing",
    input: ingestInput([
      CONNECT,
      ONLINE,
      msg("evcc/loadpoints", "2"),
      lp(1, "title", "Carport"),
      lp(2, "title", "Garage"),
      lp(2, "chargePower", "2000"),
      msg("evcc/loadpoints", "1"),
      lp(2, "title", ""),
      lp(2, "chargePower", ""),
    ]),
  },
  {
    case: "fold/charge-power-boundaries",
    input: ingestInput([
      CONNECT,
      ONLINE,
      lp(1, "chargePower", "0"),
      lp(1, "chargePower", "-50"),
      lp(1, "chargePower", "abc"),
      lp(1, "vehicleSoc", " "),
    ]),
  },
  {
    case: "fold/loadpoints-sorted-by-index",
    input: ingestInput([CONNECT, ONLINE, lp(10, "title", "Ten"), lp(2, "title", "Two")]),
  },
  {
    case: "fold/custom-topic-root",
    input: ingestInput(
      [
        CONNECT,
        msg("home/evcc/status", "online"),
        msg("home/evcc/loadpoints/1/chargePower", "2300"),
        msg("evcc/loadpoints/2/chargePower", "999"),
      ],
      { rowTopicRoot: "home/evcc" },
    ),
  },
  {
    case: "fold/load-sample-without-subtract",
    input: ingestInput([
      CONNECT,
      ...RETAINED_LP1,
      lp(1, "charging", "true"),
      lp(1, "chargePower", "4140"),
      { do: "load", watts: 4640 },
      { do: "load", watts: 6020 },
    ]),
  },
  {
    case: "fold/disabled",
    input: ingestInput([CONNECT, ...RETAINED_LP1], { config: { ...CONFIG, enabled: false } }),
  },
  {
    case: "fold/no-connection",
    input: ingestInput([CONNECT, ...RETAINED_LP1], { config: { ...CONFIG, connectionId: null } }),
  },
];

async function foldRows(): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const c of FOLD_CASES)
    rows.push({ case: c.case, input: c.input, output: await runIngest(c.input) });
  return rows;
}

// ---------------------------------------------------------------------------
// Estimator, on an injected clock

type EstimatorStep =
  | { at: number; do: "anchor"; index: number; watts: number }
  | { at: number; do: "params"; index: number; params: Partial<LoadpointParams> }
  | { at: number; do: "load"; watts: number | null };

type Estimator = ReturnType<typeof createEvPowerEstimator>;

const ESTIMATOR_HANDLERS: {
  [K in EstimatorStep["do"]]: (
    e: Estimator,
    step: Extract<EstimatorStep, { do: K }>,
  ) => boolean | null;
} = {
  anchor: (e, step) => e.anchorPower(step.index, step.watts),
  params: (e, step) => {
    e.updateParams(step.index, step.params);
    return null;
  },
  load: (e, step) => e.onLoadSample(step.watts),
};

function runEstimator(steps: readonly EstimatorStep[], indices: readonly number[]) {
  let now = 0;
  const estimator = createEvPowerEstimator(() => now);
  return steps.map((step) => {
    now = step.at;
    const handler = ESTIMATOR_HANDLERS[step.do] as (
      e: Estimator,
      s: EstimatorStep,
    ) => boolean | null;
    const changed = handler(estimator, step);
    return { changed, live: Object.fromEntries(indices.map((i) => [i, estimator.live(i)])) };
  });
}

const CHARGING_3P: Partial<LoadpointParams> = {
  charging: true,
  connected: true,
  mode: "pv",
  phasesActive: 3,
  maxCurrentA: 16,
};

const anchor = (at: number, watts: number, index = 1): EstimatorStep => ({
  at,
  do: "anchor",
  index,
  watts,
});
const params = (at: number, p: Partial<LoadpointParams>, index = 1): EstimatorStep => ({
  at,
  do: "params",
  index,
  params: p,
});
const load = (at: number, watts: number | null): EstimatorStep => ({ at, do: "load", watts });

/** Anchored at 4140 W (3 × 6 A), house at 500 W. */
const ANCHORED: EstimatorStep[] = [
  anchor(10_000, 4140),
  params(10_000, CHARGING_3P),
  load(10_000, 4640),
];

const ESTIMATOR_CASES: Array<{ case: string; indices: number[]; steps: EstimatorStep[] }> = [
  { case: "estimator/never-anchored", indices: [1], steps: [load(10_000, 500)] },
  {
    case: "estimator/anchor-zero-and-negative",
    indices: [1],
    steps: [anchor(10_000, 0), anchor(11_000, 0), anchor(12_000, -40)],
  },
  {
    case: "estimator/residual-then-re-anchor",
    indices: [1],
    steps: [...ANCHORED, load(12_000, 6020), anchor(20_000, 5000)],
  },
  {
    case: "estimator/re-anchor-rebases-house",
    indices: [1],
    steps: [
      ...ANCHORED,
      load(12_000, 6020),
      anchor(20_000, 5000),
      load(21_000, 6020),
      load(25_000, 6710),
    ],
  },
  {
    case: "estimator/noise-absorbed",
    indices: [1],
    steps: [...ANCHORED, load(12_000, 4789), load(16_000, 4640)],
  },
  {
    case: "estimator/house-step-absorbed",
    indices: [1],
    steps: [...ANCHORED, load(12_000, 6490)],
  },
  {
    case: "estimator/unknown-phases-single-phase-step",
    indices: [1],
    steps: [
      anchor(10_000, 1380),
      params(10_000, { charging: true, connected: true, mode: "pv" }),
      load(10_000, 1880),
      load(12_000, 2340),
    ],
  },
  {
    case: "estimator/above-max-current-absorbed",
    indices: [1],
    steps: [
      anchor(10_000, 1380),
      params(10_000, { ...CHARGING_3P, phasesActive: 1, maxCurrentA: 6 }),
      load(10_000, 1880),
      load(12_000, 3490),
    ],
  },
  {
    case: "estimator/now-mode-downward-only",
    indices: [1],
    steps: [
      anchor(10_000, 11_040),
      params(10_000, { ...CHARGING_3P, mode: "now" }),
      load(10_000, 11_540),
      load(12_000, 12_920),
      load(16_000, 11_540),
    ],
  },
  {
    case: "estimator/rate-limit-2999ms",
    indices: [1],
    steps: [...ANCHORED, load(12_000, 6020), load(14_999, 7400)],
  },
  {
    case: "estimator/rate-limit-3000ms",
    indices: [1],
    steps: [...ANCHORED, load(12_000, 6020), load(15_000, 7400)],
  },
  {
    case: "estimator/clamp-at-zero",
    indices: [1],
    steps: [
      anchor(10_000, 690),
      params(10_000, CHARGING_3P),
      load(10_000, 1190),
      load(12_000, -190),
    ],
  },
  {
    case: "estimator/clamp-at-max",
    indices: [1],
    steps: [
      anchor(10_000, 3450),
      params(10_000, { ...CHARGING_3P, phasesActive: 1, maxCurrentA: 16 }),
      load(10_000, 3950),
      load(12_000, 7400),
    ],
  },
  {
    case: "estimator/not-charging-absorbed",
    indices: [1],
    steps: [
      anchor(10_000, 0),
      params(10_000, { ...CHARGING_3P, charging: false }),
      load(10_000, 500),
      load(12_000, 1880),
    ],
  },
  {
    case: "estimator/two-charging-no-owner",
    indices: [1, 2],
    steps: [
      anchor(10_000, 4140, 1),
      anchor(10_000, 4140, 2),
      params(10_000, CHARGING_3P, 1),
      params(10_000, CHARGING_3P, 2),
      load(10_000, 8780),
      load(12_000, 10_160),
    ],
  },
  {
    case: "estimator/absent-load-resets-baseline",
    indices: [1],
    steps: [...ANCHORED, load(11_000, null), load(12_000, 6020), load(16_000, 7400)],
  },
  {
    case: "estimator/zero-load",
    indices: [1],
    steps: [anchor(10_000, 0), params(10_000, CHARGING_3P), load(10_000, 0), load(12_000, 0)],
  },
];

const estimatorRows = (): unknown[] =>
  ESTIMATOR_CASES.map((c) => ({
    case: c.case,
    input: { indices: c.indices, steps: c.steps },
    output: runEstimator(c.steps, c.indices),
  }));

// ---------------------------------------------------------------------------
// Registrar: device rows and readings

const T0 = Date.UTC(2026, 2, 1, 12, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

const loadpointOf = (index: number, over: Partial<EvccLoadpoint> = {}): EvccLoadpoint => ({
  index,
  title: `LP ${index}`,
  mode: "pv",
  chargePower: 4140,
  chargePowerLive: 4140,
  chargePowerSource: "measured",
  charging: true,
  connected: true,
  vehicleSoc: 54,
  vehicleRange: 210,
  vehicleTitle: "Model 3",
  vehicleName: "tesla_ble",
  sessionEnergy: 3200,
  chargeRemainingEnergy: 18000,
  limitSoc: 0,
  effectiveLimitSoc: 80,
  vehicleLimitSoc: 80,
  batteryBoost: false,
  batteryBoostLimit: null,
  vehicleCapacityKwh: 75,
  phasesActive: 3,
  ...over,
});

interface Sync {
  at: string;
  loadpoints: EvccLoadpoint[];
}

interface RegistrarInput {
  /** What `ensureDevice` answers per device id; absent ids answer `ready`. */
  rows: Record<string, DeviceRowState>;
  syncs: Sync[];
}

type Call = Record<string, unknown>;

async function runRegistrar(input: RegistrarInput): Promise<{ syncs: Call[][] }> {
  const rows = new Map<string, DeviceRowState>();
  const roster = new Set<string>();
  let calls: Call[] = [];
  const registrar = createLoadpointRegistrar({
    ensureDevice: async (id, index, title) => {
      calls.push({ ensure: { id, index, title } });
      const state = input.rows[id] ?? "ready";
      rows.set(id, state);
      return state;
    },
    reloadRegistry: async () => {
      calls.push({ reload: true });
      for (const [id, state] of rows) if (state === "ready") roster.add(id);
    },
    device: (id) => (roster.has(id) ? ({ id } as DeviceInstance) : undefined),
    commit: (device, sample) => calls.push({ commit: { device: device.id, sample } }),
    forgetDevice: (id) => {
      calls.push({ forget: id });
      roster.delete(id);
    },
    logger: { warn: (_template, values) => calls.push({ warn: values }) },
  });
  const syncs: Call[][] = [];
  for (const sync of input.syncs) {
    calls = [];
    await registrar.sync(sync.loadpoints, new Date(sync.at));
    syncs.push(JSON.parse(JSON.stringify(calls)) as Call[]);
  }
  return { syncs };
}

/** Two loadpoints registered, then the second gone. */
const RETIRE_SYNCS: Sync[] = [
  { at: iso(T0), loadpoints: [loadpointOf(1), loadpointOf(2)] },
  { at: iso(T0 + 1000), loadpoints: [loadpointOf(1)] },
];

const REGISTRAR_CASES: Array<{ case: string; input: RegistrarInput }> = [
  {
    case: "readings/register-and-retire",
    input: { rows: {}, syncs: RETIRE_SYNCS },
  },
  {
    case: "readings/steady-roster-no-reload",
    input: {
      rows: {},
      syncs: [
        { at: iso(T0), loadpoints: [loadpointOf(1)] },
        {
          at: iso(T0 + 1000),
          loadpoints: [loadpointOf(1, { chargePower: 0, chargePowerLive: 0 })],
        },
      ],
    },
  },
  {
    case: "readings/loadpoint-returns",
    input: {
      rows: {},
      syncs: [
        ...RETIRE_SYNCS,
        { at: iso(T0 + 2000), loadpoints: [loadpointOf(1), loadpointOf(2)] },
      ],
    },
  },
  {
    case: "readings/sample-boundaries",
    input: {
      rows: {},
      syncs: [
        {
          at: iso(T0),
          loadpoints: [
            loadpointOf(1, {
              title: null,
              chargePower: 0,
              chargePowerLive: 0,
              charging: false,
              connected: false,
              vehicleSoc: null,
              sessionEnergy: null,
              vehicleName: null,
            }),
            loadpointOf(2, {
              chargePowerLive: 5520,
              chargePowerSource: "estimated",
              sessionEnergy: 12_345,
              vehicleSoc: 0,
            }),
            loadpointOf(3, { chargePower: -40, chargePowerLive: -40, sessionEnergy: 0 }),
          ],
        },
      ],
    },
  },
  {
    case: "readings/no-plant",
    input: {
      rows: { "evcc-loadpoint-1": "absent", "evcc-loadpoint-2": "absent" },
      syncs: [{ at: iso(T0), loadpoints: [loadpointOf(1), loadpointOf(2)] }],
    },
  },
  {
    case: "readings/retired-row-retry",
    input: {
      rows: { "evcc-loadpoint-1": "retired" },
      syncs: [
        { at: iso(T0), loadpoints: [loadpointOf(1)] },
        { at: iso(T0 + 299_999), loadpoints: [loadpointOf(1)] },
        { at: iso(T0 + 300_000), loadpoints: [loadpointOf(1)] },
      ],
    },
  },
];

async function registrarRows(): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const c of REGISTRAR_CASES) {
    rows.push({ case: c.case, input: c.input, output: await runRegistrar(c.input) });
  }
  return rows;
}

const deviceSpecRow = () => {
  const bindings = [
    { connectionId: 3, topicRoot: "evcc" },
    { connectionId: null, topicRoot: "home/evcc" },
  ];
  const loadpoints = [
    { index: 1, title: "Carport" },
    { index: 2, title: null },
  ];
  return {
    case: "readings/device-spec",
    input: { plantId: 1, loadpoints, bindings },
    output: {
      metrics: LOADPOINT_METRICS,
      devices: bindings.flatMap((binding) =>
        loadpoints.map((l) => loadpointDeviceSpec(1, l.index, l.title, binding)),
      ),
    },
  };
};

function finalState(out: Awaited<ReturnType<typeof runIngest>>): EvccState {
  const state = out.steps.at(-1)?.state;
  if (!state) throw new Error("the ingest is off");
  return state;
}

/** One message set, the flag off and on: the state and what the registrar commits from it. */
async function subtractFromHomeRow(): Promise<unknown> {
  const steps = [
    CONNECT,
    ...RETAINED_LP1,
    lp(1, "chargePower", "4140"),
    lp(1, "sessionEnergy", "1500"),
  ];
  const run = async (subtractFromHome: boolean) => {
    const out = await runIngest(ingestInput(steps, { config: { ...CONFIG, subtractFromHome } }));
    const state = finalState(out);
    const committed = await runRegistrar({
      rows: {},
      syncs: [{ at: iso(T0), loadpoints: state.loadpoints }],
    });
    return { state, committed: committed.syncs[0] };
  };
  return {
    case: "readings/subtract-from-home",
    input: { steps, at: iso(T0) },
    output: { off: await run(false), on: await run(true) },
  };
}

// ---------------------------------------------------------------------------
// No command topic

async function noCommandRow(): Promise<unknown> {
  const input = ingestInput([
    CONNECT,
    ...RETAINED_LP1,
    msg("evcc/vehicles/tesla_ble/limitSoc", "80"),
    lp(1, "chargePower", "4140", false),
    { do: "load", watts: 4640 },
    { do: "drop" },
    CONNECT,
  ]);
  const out = await runIngest(input);
  const topics = [...out.subscribed, ...out.published.map((p) => p.topic)];
  return {
    case: "commands/no-command-topic",
    input,
    output: {
      subscribed: out.subscribed,
      published: out.published,
      commandTopics: topics.filter((t) => t.endsWith("/set")),
    },
  };
}

async function buildEvccCorpus(): Promise<CorpusFiles> {
  return {
    "evcc.ndjson": ndjson([
      ...grammarRows(),
      ...(await foldRows()),
      ...estimatorRows(),
      deviceSpecRow(),
      ...(await registrarRows()),
      await subtractFromHomeRow(),
      await noCommandRow(),
    ]),
  };
}

export const oracle: OracleGenerator = {
  files: ["evcc.ndjson"],
  build: buildEvccCorpus,
};
