// The fake core's plant as the API describes it: devices, layout, capabilities, and the reads
// that do not follow the clock.

import type { components } from "../src/lib/api/schema";
import { BATTERY, CHARGER, INVERTER, plantAt } from "./plant.ts";

type Schemas = components["schemas"];

const DAY = 86_400_000;

const MODULE = {
  id: 7,
  name: "Owner 400",
  pmax: 400,
  vmp: 34,
  imp: 11.76,
  voc: 41,
  isc: 12.5,
  powerCoefficient: -0.35,
  voltageCoefficient: -0.27,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
} satisfies Schemas["ModuleType"];

/** Portrait modules in rows and columns from the 0.3 m setback, 2 cm apart. */
const cells = (rows: number, columns: number, string: number) =>
  Array.from({ length: rows * columns }, (_, i) => ({
    across: Math.round((0.3 + (i % columns) * 1.154) * 1000) / 1000,
    up: Math.round((0.3 + Math.floor(i / columns) * 1.742) * 1000) / 1000,
    landscape: false,
    string,
    optimized: false,
  }));

/** A gable house: ten modules south, five north, an inverter and a battery on the wall, an EV out front. */
export const SCENE = {
  north: 0,
  blocks: [
    { x: 0, z: 0, width: 11, depth: 8, eave: 3, rotation: 0, roof: { kind: "gable", pitch: 35 } },
  ],
  obstacles: [{ kind: "tree", x: -9, z: 4, height: 7, radius: 2 }],
  grids: [
    { block: 0, face: 1, moduleType: 7, landscape: false, setback: 0.3, modules: cells(2, 5, 0) },
    { block: 0, face: 0, moduleType: 7, landscape: false, setback: 0.3, modules: cells(1, 5, 1) },
  ],
  equipment: [
    { device: INVERTER, kind: "inverter", block: 0, wall: "front", along: 2, inside: false },
    { device: BATTERY, kind: "battery", block: 0, wall: "front", along: 3, inside: false },
  ],
  carPlaces: [{ device: CHARGER, x: 4, z: 8, width: 2.5, length: 5, rotation: 0 }],
} satisfies Schemas["Scene"];

const WIRING = { device: INVERTER, moduleType: 7, optimized: 0, tilt: 35, loss: 2 };

const LAYOUT = {
  appliesFrom: "2025-01-01T00:00:00Z",
  scene: SCENE,
  strings: [
    { id: 1, name: "Süd", input: 1, modules: 10, azimuth: 0, ...WIRING },
    { id: 2, name: "Nord", input: 2, modules: 5, azimuth: 180, ...WIRING },
  ],
  warnings: [],
} satisfies Schemas["Layout"];

const DEVICES = [
  { id: INVERTER, name: "Wechselrichter", profile: "deye-sg05lp3", connection: 1, unit: 1 },
  { id: BATTERY, name: "Batterie", profile: "deye-sg05lp3", connection: 1, unit: 1 },
  { id: CHARGER, name: "Wallbox", profile: "evcc", connection: 2, unit: 1 },
];

const current = (key: string) => ({
  key,
  range: { min: 0, max: 185 },
  step: 1,
  enable: "on" as const,
});

const CAPABILITIES = {
  version: "5.0.0",
  schema: { min: 1, max: 1 },
  capabilities: [],
  transports: [],
  devices: {
    [INVERTER]: {
      estimated: [],
      series: Object.keys(plantAt(0, 0)[INVERTER]),
      writes: true,
      maxInputVoltage: 500,
      settings: [
        current("battery.max_charge_current"),
        current("battery.max_discharge_current"),
        {
          key: "grid.export_limit",
          range: { min: 0, max: 10_000 },
          step: 100,
          enable: "on" as const,
        },
      ],
    },
    [BATTERY]: {
      estimated: [],
      series: ["battery.power", "battery.soc"],
      writes: false,
      settings: [],
    },
    [CHARGER]: { estimated: [], series: ["ev.charge.power"], writes: false, settings: [] },
  },
};

/** A series' unit by its role's last word. */
const UNITS = new Map([
  ["power", "W"],
  ["voltage", "V"],
  ["current", "A"],
  ["soc", "%"],
  ["efficiency", "%"],
  ["temperature", "°C"],
  ["frequency", "Hz"],
  ["total", "kWh"],
  ["energy", "kWh"],
]);

const unitOf = (series: string) =>
  UNITS.get(
    series
      .replace(/\[\d+\]$/u, "")
      .split(".")
      .at(-1) ?? "",
  ) ?? null;

/** The series catalog (ADR 22): every device the plant publishes, with all it publishes, since `start`. */
function catalog(start: number): Schemas["SeriesCatalog"] {
  const names = new Map(
    DEVICES.map((device: Readonly<(typeof DEVICES)[number]>) => [String(device.id), device.name]),
  );

  const [first, last] = [iso(start), iso(Date.now())];

  return {
    devices: Object.entries(plantAt(0, 0)).map(
      ([id, values]: readonly [string, Readonly<Record<string, number>>]) => ({
        id: Number(id),
        name: names.get(id) ?? null,
        removed: false,
        series: Object.keys(values).map((series) => ({
          series,
          kind: series.endsWith(".total") ? ("counter" as const) : ("measurement" as const),
          unit: unitOf(series),
          first,
          last,
        })),
      }),
    ),
  };
}

const figures = (production: number, saved: number) => ({
  production,
  consumption: 5200,
  selfSupply: 3100,
  saved,
});

function records(): Schemas["Records"] {
  const year = new Date().getUTCFullYear();

  return {
    years: [
      { year, running: true, figures: figures(6100, 980), before: figures(5600, 900) },
      { year: year - 1, running: false, figures: figures(6900, 1120), before: null },
    ],
    bestDay: { date: `${year}-06-21`, value: 61.2 },
    bestMonth: { date: `${year - 1}-06-01`, value: 1040 },
    bestSaving: { date: `${year}-07-02`, value: 9.8 },
  };
}

const iso = (t: number) => new Date(t).toISOString();

function capacity(start: number): Schemas["Capacity"] {
  const kwh = [10, 9.9, 9.85, 9.8, 9.7, 9.65];

  return {
    measurements: kwh.map((v, i) => ({ end: iso(Date.now() - (150 - i * 30) * DAY), kwh: v })),
    now: 9.7,
    first: 9.9,
    perYear: -0.08,
    nameplate: 10,
    discharged: 2234,
    cycles: 223.4,
    since: iso(start),
  };
}

const month = (back: number, saved: number) => ({
  date: iso(Date.now() - back * 30 * DAY).slice(0, 10),
  saved,
});

const PAYBACK = {
  investment: 14_000,
  remaining: 9800,
  savings: 4200,
  pace: 1250,
  reached: "2030-04-15",
  months: [month(3, 3500), month(2, 3800), month(1, 4000), month(0, 4200)],
} satisfies Schemas["Payback"];

const schedule = (price: number) => ({ price, bands: [] });

/** Each read that does not follow the clock, by path; recording began at `start`. */
export function fixed(zone: string, start: number) {
  return {
    "/api/v1/timezone": () => ({ name: zone }),
    "/api/v1/sun-tint": () => ({ tint: "noon" }),
    "/api/v1/location": () => ({ latitude: 50.1, longitude: 8.7 }),
    "/api/v1/layout": () => LAYOUT,
    "/api/v1/module-types": () => ({ moduleTypes: [MODULE] }),
    "/api/v1/devices": () => ({ devices: DEVICES }),
    "/api/v1/capabilities": () => CAPABILITIES,
    "/api/v1/series": () => catalog(start),
    "/api/v1/records": records,
    "/api/v1/battery/capacity": () => capacity(start),
    "/api/v1/payback": () => PAYBACK,
    "/api/v1/tariff": () => ({
      appliesFrom: "2025-01-01T00:00:00Z",
      import: schedule(0.32),
      export: schedule(0.08),
    }),
    "/api/v1/spot-prices": () => ({ zone: "DE-LU" }),
    "/api/v1/corrections": () => ({ inputs: [] }),
    "/api/v1/problems": () => ({ problems: [] }),
    "/api/v1/profile-updates": () => ({ updates: [] }),
    "/api/v1/writes": () => ({ attempts: [] }),
    "/api/v1/connections": () => ({ connections: [] }),
    "/api/v1/logs": () => ({ lines: [] }),
    "/api/v1/viewers": () => ({ viewers: [] }),
    "/api/v1/tokens": () => ({ tokens: [] }),
    "/api/v1/import": () => ({ state: "idle", done: 0, total: 0 }),
    "/api/v1/import/files": () => ({ files: [] }),
  } satisfies Record<string, () => object>;
}
