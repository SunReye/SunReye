/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  depths,
  left,
  lines,
  move,
  propose,
  reading,
  remainder,
  remove,
  targets,
} from "./topology.ts";

const INVERTER = { id: 1, name: "Wechselrichter", profile: "p", connection: 1, unit: 1 };
const WALLBOX = { id: 2, name: "Wallbox", profile: "q", connection: 2, unit: 1 };

const label = (role: string) => `<${role}>`;

test("the grid meter claims the root and each other power role hangs below it", () => {
  const values = {
    devices: {
      "1": {
        "grid.power": -300,
        "pv.power": 1200,
        "pv.mppt.power[1]": 600,
        "battery.power": 0,
        "battery.soc": 60,
      },
      "2": { "ev.charge.power": 0, "ev.soc": 40 },
    },
  };

  expect(propose([INVERTER, WALLBOX], values, "Netz", label)).toEqual([
    { name: "Netz", parent: null, claims: [{ device: 1, role: "grid.power" }] },
    { name: "<pv.power>", parent: 0, claims: [{ device: 1, role: "pv.power" }] },
    { name: "<battery.power>", parent: 0, claims: [{ device: 1, role: "battery.power" }] },
    { name: "<ev.charge.power>", parent: 0, claims: [{ device: 2, role: "ev.charge.power" }] },
  ]);
});

test("two devices measuring one role are told apart by the device's name", () => {
  const values = { devices: { "1": { "pv.power": 900 }, "2": { "pv.power": 400 } } };

  expect(propose([INVERTER, WALLBOX], values, "Netz", label).map(({ name }) => name)).toEqual([
    "Netz",
    "<pv.power> (Wechselrichter)",
    "<pv.power> (Wallbox)",
  ]);
});

/** A Deye SUN-15K-SG05LP3 with its own grid CT and nothing on its GEN port. */
const DEYE = {
  devices: {
    "1": {
      "grid.power": 250,
      "pv.power": 0,
      "pv.energy.total": 18_400,
      "generator.power": 0,
      "generator.energy.total": 0,
      "battery.power": 0,
      "battery.soc": 55,
      "load.power": 250,
    },
  },
};

test("a zero, unwired generator port is not proposed; an idle battery and PV at night are", () => {
  expect(propose([INVERTER], DEYE, "Netz", label).map(({ claims }) => claims[0]?.role)).toEqual([
    "grid.power",
    "pv.power",
    "battery.power",
    "load.power",
  ]);
});

test("a generator that once ran is proposed while it stands", () => {
  const ran = { devices: { "1": { ...DEYE.devices["1"], "generator.energy.total": 12 } } };

  expect(propose([INVERTER], ran, "Netz", label).map(({ name }) => name)).toContain(
    "<generator.power>",
  );
});

test("a device whose only power role reads zero is still proposed", () => {
  const values = { devices: { "2": { "ev.charge.power": 0 } } };

  expect(propose([WALLBOX], values, "Netz", label)).toHaveLength(2);
});

test("what the tree leaves out can be added back below the root", () => {
  const points = propose([INVERTER], DEYE, "Netz", label);

  expect(left(points, [INVERTER], DEYE, label)).toEqual([
    { name: "<generator.power>", parent: 0, claims: [{ device: 1, role: "generator.power" }] },
  ]);
});

test("a device not yet read proposes nothing", () => {
  expect(propose([INVERTER], { devices: {} }, "Netz", label)).toEqual([
    { name: "Netz", parent: null, claims: [] },
  ]);
});

test("a removed point's children move to its parent and later parents follow the shift", () => {
  const points = [
    { name: "Netz", parent: null, claims: [] },
    { name: "Haus", parent: 0, claims: [] },
    { name: "Wärmepumpe", parent: 1, claims: [] },
    { name: "Wallbox", parent: 2, claims: [] },
  ];

  expect(remove(points, 1)).toEqual([
    { name: "Netz", parent: null, claims: [] },
    { name: "Wärmepumpe", parent: 0, claims: [] },
    { name: "Wallbox", parent: 1, claims: [] },
  ]);
});

const named = (name: string, parent: number | null) => ({ name, parent, claims: [] });

test("a point moved under a later one follows it, with its own children", () => {
  const points = [
    named("Netz", null),
    named("Haus", 0),
    named("Wärmepumpe", 1),
    named("Wallbox", 0),
  ];

  expect(move(points, 1, 3)).toEqual([
    named("Netz", null),
    named("Wallbox", 0),
    named("Haus", 1),
    named("Wärmepumpe", 2),
  ]);
});

test("a point can move under any point but itself and what hangs below it", () => {
  const points = [
    named("Netz", null),
    named("Haus", 0),
    named("Wärmepumpe", 1),
    named("Wallbox", 0),
  ];

  expect(targets(points, 1)).toEqual([0, 3]);
});

const point = (parent: number | null) => ({ name: "", parent, claims: [] });

test("each point sits one level below its parent, the root at none", () => {
  expect(depths([point(null), point(0), point(1), point(0)])).toEqual([0, 1, 2, 1]);
});

const claim = (role: string, parent: number | null) => ({
  name: role,
  parent,
  claims: [{ device: 1, role }],
});

test("a point reads its first claim with a fresh value", () => {
  const values = { devices: { "1": { "pv.power": 900 } }, stale: { "1": { "pv.power": 1 } } };

  expect(reading(claim("pv.power", 0), values)).toBeUndefined();
  expect(reading(claim("pv.power", 0), { devices: values.devices })).toBe(900);
});

test("the root's remainder is what its measured children do not explain", () => {
  const points = [
    claim("grid.power", null),
    claim("pv.power", 0),
    claim("battery.power", 0),
    claim("load.power", 0),
  ];

  // 300 W bought + 2000 W PV − 1200 W charging − 1000 W load.
  const values = {
    devices: {
      "1": { "grid.power": 300, "pv.power": 2000, "battery.power": 1200, "load.power": 1000 },
    },
  };

  expect(remainder(points, values, 0)).toBe(100);
});

test("an unmeasured child gives way to its measured children; an unmeasured root has none", () => {
  const points = [
    claim("grid.power", null),
    { name: "Haus", parent: 0, claims: [] },
    claim("load.power", 1),
  ];

  const values = { devices: { "1": { "grid.power": 800, "load.power": 500 } } };

  expect(remainder(points, values, 0)).toBe(300);
  expect(remainder(points, values, 1)).toBeUndefined();
});

test("the tree reads root first, each point's children under it and then its remainder", () => {
  const points = [
    claim("grid.power", null),
    claim("load.power", 0),
    claim("pv.power", 0),
    claim("ev.charge.power", 1),
  ];

  const values = {
    devices: {
      "1": { "grid.power": 1000, "load.power": 3000, "pv.power": 2500, "ev.charge.power": 2000 },
    },
  };

  expect(lines(points, values)).toEqual([
    { index: 0, depth: 0 },
    { index: 1, depth: 1 },
    { index: 3, depth: 2 },
    { of: 1, rest: 1000, depth: 2 },
    { index: 2, depth: 1 },
    { of: 0, rest: 500, depth: 1 },
  ]);
});
