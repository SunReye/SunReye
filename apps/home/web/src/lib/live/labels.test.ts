/// <reference types="bun" />
import { expect, test } from "bun:test";
import { PLANT, type PvString } from "../api/core.ts";
import type { Equipment, Mount } from "../../../../../../packages/builder/src/builder/pv.ts";
import { liveScene, type Live3d } from "./labels.ts";

const string = (id: number, name: string, input: number, modules: number): PvString => ({
  id,
  name,
  moduleType: 7,
  device: 1,
  input,
  modules,
  optimized: 0,
  tilt: 35,
  azimuth: 0,
  loss: 2,
});

/** Two 400 W modules in string 0 on the south roof, one in string 1, one unassigned. */
const scene: Live3d = {
  strings: [string(11, "Süd", 1, 2), string(12, "West", 2, 1)],
  peaks: { 7: 400 },
  panels: [
    {
      corners: [
        [0, -5, 4],
        [1, -5, 4],
        [1, -6, 4],
        [0, -6, 4],
      ],
      string: 0,
    },
    {
      corners: [
        [2, -5, 4],
        [3, -5, 4],
        [3, -6, 4],
        [2, -6, 4],
      ],
      string: 0,
    },
    {
      corners: [
        [8, -5, 4],
        [9, -5, 4],
        [9, -6, 4],
        [8, -6, 4],
      ],
      string: 1,
    },
    {
      corners: [
        [5, -5, 4],
        [6, -5, 4],
        [6, -6, 4],
        [5, -6, 4],
      ],
      string: null,
    },
  ],
  equipment: [],
  mounts: [],
  estimated: { "1": ["pv.string.power[12]"] },
  values: {
    "1": {
      "pv.string.power[11]": 600,
      "pv.string.power[12]": 100,
      "pv.power": 700,
      "battery.power": -350,
      "battery.soc": 64,
    },
    [PLANT]: { "grid.power": -1200, "load.power": 450, "battery.power": -350, "battery.soc": 64 },
  },
};

const strings = (input: Live3d) => liveScene(input).chips.filter(({ kind }) => kind === "string");

test("a string's chip points at its modules' centre and opens the string's sheet", () => {
  const [south, west] = strings(scene);

  expect(south).toEqual({
    key: "string-11",
    id: "string-11",
    kind: "string",
    name: "Süd",
    watts: 600,
    soc: null,
    estimated: false,
    stale: false,
    leader: [1.5, -5.5, 4],
  });
  expect(west).toMatchObject({
    id: "string-12",
    watts: 100,
    estimated: true,
    leader: [8.5, -5.5, 4],
  });
});

test("a string with no module placed has no chip", () => {
  expect(strings({ ...scene, panels: [] })).toEqual([]);
});

test("a stale string value is marked stale", () => {
  const [south] = strings({ ...scene, stale: { "1": { "pv.string.power[11]": 40 } } });

  expect(south?.stale).toBe(true);
});

test("each module takes its string's share of its own peak; an unassigned one none", () => {
  // 600 W of 2 × 400 W; 100 W of 1 × 400 W.
  expect(liveScene(scene).shares).toEqual([0.75, 0.75, 0.25, null]);
});

test("a string without a live value has no share, and never more than its peak", () => {
  const silent = liveScene({ ...scene, values: { "1": { "pv.string.power[11]": 1000 } } });

  expect(silent.shares).toEqual([1, 1, null, null]);
  expect(strings({ ...scene, values: {} }).map(({ watts }) => watts)).toEqual([null, null]);
});

const equipment = (input: Live3d) => liveScene(input).chips.filter(({ kind }) => kind !== "string");

test("without markers, grid, house, battery and inverter chips have no leader line", () => {
  const beside = {
    leader: null,
    name: null,
    estimated: false,
    stale: false,
  };

  expect(equipment(scene)).toEqual([
    { ...beside, key: "grid", id: "grid", kind: "grid", watts: -1200, soc: null },
    { ...beside, key: "house", id: "house", kind: "house", watts: 450, soc: null },
    { ...beside, key: "battery", id: "battery", kind: "battery", watts: -350, soc: 64 },
    { ...beside, key: "inverter-1", id: "inverter", kind: "inverter", watts: 700, soc: null },
  ]);
});

test("a stale plant flow is marked stale", () => {
  const [grid, house] = equipment({ ...scene, stale: { [PLANT]: { "grid.power": 40 } } });

  expect([grid?.stale, house?.stale]).toEqual([true, false]);
});

function marker(kind: Equipment["kind"]): Equipment {
  return { device: 1, kind, block: 0, wall: "front", along: 2, inside: false };
}

test("a marker carries its device's chip on a leader line; the rest has none", () => {
  const mount: Mount = { at: [2, -8.1, 1.5], above: [2, -8.1, 8], out: [0, -1, 0] };

  const chips = equipment({
    ...scene,
    equipment: [marker("inverter"), marker("battery")],
    mounts: [mount, mount],
  });

  expect(chips.map(({ key, leader }) => [key, leader])).toEqual([
    ["grid", null],
    ["house", null],
    ["inverter-1", [2, -8.1, 1.5]],
    ["battery-1", [2, -8.1, 1.5]],
  ]);
  expect(chips.at(-1)).toMatchObject({ id: "battery", watts: -350, soc: 64 });
});

test("a connected car carries its charge power and its vehicle's SOC on a line to it", () => {
  const place = { device: 7, x: 13, z: 0.5, width: 2, length: 5, rotation: 0 };
  const stand = { at: [14, -3, 0], forward: [0, 1, 0], above: [14, -3, 2.5] } as const;

  const values = {
    ...scene.values,
    "7": { "ev.connected": 1, "ev.charge.power": 7360, "ev.vehicle.soc": 63 },
  };

  const { chips, cars } = liveScene({ ...scene, places: [place], stands: [stand], values });

  expect(cars).toHaveLength(1);

  expect(chips.at(-1)).toEqual({
    key: "ev-7",
    id: "ev-7",
    kind: "ev",
    name: null,
    watts: 7360,
    soc: 63,
    estimated: false,
    stale: false,
    leader: [14, -3, 0],
  });
});

test("an inverter's chip reads its AC power, as its sheet does, and its PV without one", () => {
  const values = { ...scene.values, "1": { ...scene.values["1"], "inverter.power": 650 } };
  const inverter = (input: Live3d) => equipment(input).find(({ kind }) => kind === "inverter");

  expect(inverter({ ...scene, values })?.watts).toBe(650);
  expect(inverter(scene)?.watts).toBe(700);
  expect(
    equipment({
      ...scene,
      values,
      equipment: [marker("inverter")],
      mounts: [{ at: [0, 0, 0], above: [0, 0, 1], out: [0, -1, 0] }],
    }).find(({ kind }) => kind === "inverter")?.watts,
  ).toBe(650);
});
