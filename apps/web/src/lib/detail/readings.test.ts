import { expect, test } from "bun:test";
import { ago, nodeReadings, type Source } from "./readings.ts";

const NOW = 1_000_000;
const INVERTER = 1;
const BATTERY = 2;
const LOADPOINT = 3;
const PLANT = 4_294_967_294;
const GENERATOR = 5;

function plant(patch: Partial<Source> = {}): Source {
  return {
    strings: [
      { id: 1, name: "Süd", input: 1, device: INVERTER },
      { id: 2, name: "Nord", input: 1, device: INVERTER },
      { id: 3, name: "West", input: 2, device: INVERTER },
    ],
    values: {
      [INVERTER]: {
        "pv.power": 7800,
        "inverter.power": 7600,
        "inverter.status": 1,
        "inverter.temperature": 41,
        "pv.mppt.power[1]": 4300,
        "pv.mppt.voltage[1]": 536,
        "pv.mppt.current[1]": 8,
        "pv.mppt.power[2]": 3500,
        "pv.mppt.voltage[2]": 469,
        "pv.mppt.current[2]": 7.5,
        "pv.string.power[1]": 3100,
        "pv.string.power[2]": 1200,
        "pv.string.power[3]": 3500,
        "load.power": 900,
        "load.phase.power[1]": 300,
        "load.phase.power[2]": 400,
        "load.phase.power[3]": 200,
      },
      [BATTERY]: { "battery.power": -900, "battery.temperature": 24, "battery.cycles": 412 },
      [LOADPOINT]: { "ev.charge.power": 3700, "ev.connected": 1, "ev.charging": 1, "ev.mode": 3 },
      [PLANT]: { "pv.power": 7800, "battery.power": -900, "load.power": 900 },
    },
    stale: {},
    estimated: { [INVERTER]: ["pv.string.power[1]", "pv.string.power[2]"] },
    names: { [BATTERY]: "Akku" },
    points: [],
    now: NOW,
    status: "live",
    series: {
      [`${PLANT}/grid.power`]: [{ t: NOW, v: PLANT }],
      [`${INVERTER}/pv.string.power[3]`]: [{ t: NOW, v: INVERTER }],
      [`${INVERTER}/inverter.power`]: [{ t: NOW, v: INVERTER }],
      [`${LOADPOINT}/ev.charge.power`]: [{ t: NOW, v: LOADPOINT }],
    },
    ...patch,
  };
}

const read = (id: string, s = plant()) => nodeReadings(id, s);
const titles = (id: string, s = plant()) => read(id, s)?.groups.map((g) => g.title);

const row = (id: string, key: string, s = plant()) =>
  read(id, s)
    ?.groups.flatMap((g) => g.rows)
    .find((r) => r.key === key);

test("a string sharing its MPPT input is an estimate with its share and its siblings", () => {
  expect(read("string-1")?.leadEstimated).toBe(true);
  expect(read("string-1")?.lead).toBe(3100);
  expect(row("string-1", "share")).toMatchObject({ value: (3100 / 4300) * 100, est: true });
  expect(row("string-1", "pv.string.power[2]")).toMatchObject({
    label: "Nord",
    est: true,
    to: "string-2",
  });
  expect(row("string-1", "pv.mppt.power[1]")).toMatchObject({ value: 4.3, unit: "kW" });
});

test("a string alone on its input is measured and does not repeat the input's power", () => {
  expect(read("string-3")?.leadEstimated).toBe(false);
  expect(titles("string-3")).toEqual(["MPPT-Eingang 2"]);
  expect(row("string-3", "pv.mppt.power[2]")).toBeUndefined();
});

test("a role the profile does not map gives no row and no column", () => {
  const {
    "pv.mppt.voltage[1]": _a,
    "pv.mppt.voltage[2]": _b,
    ...rest
  } = plant().values[INVERTER] ?? {};

  const s = plant({ values: { ...plant().values, [INVERTER]: rest } });

  expect(row("string-1", "pv.mppt.voltage[1]", s)).toBeUndefined();

  const table = read("inverter", s)?.groups.find((g) => g.title === "MPPT-Eingänge")?.table;

  expect(table?.cols.map((c) => c.label)).toEqual(["Strom", "Leistung"]);
});

test("a group without readings is dropped", () => {
  expect(titles("battery")).toEqual(["Zustand", "Zähler"]);
});

test("the inverter's state reads in words, with its temperature", () => {
  expect(row("inverter", "inverter.status")).toMatchObject({ label: "Betrieb", text: "Normal" });
  expect(row("inverter", "inverter.temperature")).toMatchObject({ value: 41, unit: "°C" });
});

test("the house lists its phases from the per-phase load", () => {
  const phases = read("house")?.groups.find((g) => g.title === "Phasen")?.table;

  expect(phases?.rows.map((r) => r.label)).toEqual(["L1", "L2", "L3"]);
  expect(phases?.rows[1]?.cells[0]?.value).toBe(0.4);
});

/** The grid connection, a wallbox the loadpoint measures, and a heat pump below it. */
const POINTS: Source["points"] = [
  { id: 1, name: "Netzanschluss", parent: null, contested: false, claims: [] },
  {
    id: 4,
    name: "Wallbox",
    parent: 1,
    contested: false,
    claims: [{ device: LOADPOINT, role: "ev.charge.power" }],
  },
  { id: 6, name: "Wärmepumpe", parent: 1, contested: false, claims: [] },
];

test("the house lists each measured point's consumption, and what none explains", () => {
  const s = plant();

  const values = {
    ...s.values,
    [PLANT]: {
      ...s.values[PLANT],
      "point.power[1]": 600,
      "point.power[4]": 3700,
      "point.power[6]": 1500,
    },
  };

  const consumers = read("house", plant({ values, points: POINTS }))?.groups.find(
    (g) => g.title === "Verbraucher",
  );

  expect(consumers?.rows.map((r) => [r.label, r.value, r.to])).toEqual([
    ["Wallbox", 3.7, `ev-${LOADPOINT}`],
    ["Wärmepumpe", 1.5, undefined],
    ["Nicht einzeln gemessen", 0.6, undefined],
  ]);
  // Without the topology no point can be named.
  expect(titles("house", plant({ values }))).not.toContain("Verbraucher");
});

test("the generator leads with the plant's generator power and counts its energy", () => {
  const s = plant();

  const values = {
    ...s.values,
    [PLANT]: { ...s.values[PLANT], "generator.power": 2100 },
    [GENERATOR]: { "generator.power": 2100, "generator.energy.total": 3400 },
  };

  const generator = plant({ values });

  expect(read("generator", generator)?.lead).toBe(2100);
  expect(row("generator", "generator.energy.total", generator)).toMatchObject({ value: 3.4 });
});

test("the battery counts its cycles", () => {
  expect(row("battery", "battery.cycles")).toMatchObject({ value: 412, digits: 0 });
});

test("a loadpoint reads its state and mode in words", () => {
  expect(row("ev-3", "ev.connected")).toMatchObject({ text: "Lädt" });
  expect(row("ev-3", "ev.mode")).toMatchObject({ text: "PV" });
});

test("the sign never reaches the reader", () => {
  const s = plant({
    values: { ...plant().values, [BATTERY]: { "battery.current": -17.5 } },
  });

  expect(row("battery", "battery.current", s)?.value).toBe(17.5);
});

test("a stale reading carries its age; a fresh one does not", () => {
  const s = plant({ stale: { [BATTERY]: { "battery.temperature": NOW - 240_000 } } });

  expect(row("battery", "battery.temperature", s)?.age).toBe(240);
  expect(row("battery", "battery.temperature")?.age).toBeUndefined();
});

test("an offline device says so once, not on every row", () => {
  const at = NOW - 720_000;

  const s = plant({
    stale: {
      [BATTERY]: { "battery.power": at, "battery.temperature": at, "battery.cycles": at },
    },
  });

  expect(read("battery", s)?.silent).toBe(720);
  expect(row("battery", "battery.temperature", s)?.age).toBeUndefined();
});

test("a stopped stream marks no single row stale", () => {
  const s = plant({
    status: "stopped",
    stale: { [BATTERY]: { "battery.temperature": NOW - 240_000 } },
  });

  expect(row("battery", "battery.temperature", s)?.age).toBeUndefined();
});

test("efficiency is derived from the two powers", () => {
  expect(row("inverter", "efficiency")?.value).toBeCloseTo(97.44, 1);
});

test("the device is named when the core names it", () => {
  expect(read("battery")?.device).toBe("Akku");
  expect(read("inverter")?.device).toBeNull();
});

test("a figure that is not a node has no readings", () => {
  expect(read("production")).toBeNull();
});

test("ages read in the largest sensible unit", () => {
  expect([ago(42), ago(240), ago(3 * 3600)]).toEqual(["vor 42 s", "vor 4 min", "vor 3 h"]);
});

const drawn = (id: string) => read(id)?.points.map((p) => p.v);

test("a node's live graph draws its own figure: the plant's total, or its device's", () => {
  expect(drawn("grid")).toEqual([PLANT]);
  expect(drawn("string-3")).toEqual([INVERTER]);
  expect(drawn("inverter")).toEqual([INVERTER]);
  expect(drawn(`ev-${LOADPOINT}`)).toEqual([LOADPOINT]);
});

test("a string on no known device has nothing to draw", () => {
  expect(read("string-9")?.points).toEqual([]);
});
