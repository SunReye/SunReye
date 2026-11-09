/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { PvString } from "../api/core.ts";
import type { Equipment, Mount } from "../builder/pv.ts";
import { PLANT, liveScene, type Live3d } from "./labels.ts";

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
  faces: [
    {
      surface: "wall",
      corners: [
        [0, 0, 0],
        [10, 0, 0],
        [10, -8, 7],
      ],
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

test("a string is tinted by its share of its own peak and labelled at its modules' centre", () => {
  const [south, west] = liveScene(scene).strings;

  // 600 W of 2 × 400 W; 100 W of 1 × 400 W.
  expect(south).toEqual({
    name: "Süd",
    watts: 600,
    share: 0.75,
    estimated: false,
    centre: [1.5, -5.5, 4],
  });
  expect(west).toMatchObject({ watts: 100, share: 0.25, estimated: true, centre: [8.5, -5.5, 4] });
});

test("a string with no module placed has no centre", () => {
  expect(liveScene({ ...scene, panels: [] }).strings[0]?.centre).toBeNull();
});

test("each module takes its string's share; an unassigned one none", () => {
  expect(liveScene(scene).shares).toEqual([0.75, 0.75, 0.25, null]);
});

test("a string without a live value has no share, and never more than its peak", () => {
  const silent = liveScene({ ...scene, values: { "1": { "pv.string.power[11]": 1000 } } });

  expect(silent.strings.map(({ watts, share }) => [watts, share])).toEqual([
    [1000, 1],
    [null, null],
  ]);
});

test("without markers, grid, house, battery and inverter sit in one label beside the house", () => {
  const { labels } = liveScene(scene);

  expect(labels).toEqual([
    {
      // 2 m east of the house's eastmost point, at its middle and its top.
      anchor: [12, -4, 7],
      leader: null,
      quantities: [
        { kind: "grid", watts: -1200, stale: false },
        { kind: "house", watts: 450, stale: false },
        { kind: "battery", watts: -350, soc: 64, stale: false },
        { kind: "inverter", device: 1, watts: 700, stale: false },
      ],
    },
  ]);
});

function marker(kind: Equipment["kind"]): Equipment {
  return { device: 1, kind, block: 0, wall: "front", along: 2, inside: false };
}

test("a marker carries its device's label on a leader line; the rest stays beside the house", () => {
  const mount: Mount = { at: [2, -8.1, 1.5], above: [2, -8.1, 8] };

  const { labels } = liveScene({
    ...scene,
    equipment: [marker("inverter"), marker("battery")],
    mounts: [mount, mount],
  });

  expect(labels).toEqual([
    {
      anchor: [12, -4, 7],
      leader: null,
      quantities: [
        { kind: "grid", watts: -1200, stale: false },
        { kind: "house", watts: 450, stale: false },
      ],
    },
    {
      anchor: [2, -8.1, 8],
      leader: [2, -8.1, 1.5],
      quantities: [{ kind: "inverter", device: 1, watts: 700, stale: false }],
    },
    {
      anchor: [2, -8.1, 8],
      leader: [2, -8.1, 1.5],
      quantities: [{ kind: "battery", watts: -350, soc: 64, stale: false }],
    },
  ]);
});

test("a connected car carries its charge power and its vehicle's SOC above it", () => {
  const place = { device: 7, x: 13, z: 0.5, width: 2, length: 5, rotation: 0 };
  const stand = { at: [14, -3, 0], forward: [0, 1, 0], above: [14, -3, 2.5] } as const;

  const values = {
    ...scene.values,
    "7": { "ev.connected": 1, "ev.charge.power": 7360, "ev.vehicle.soc": 63 },
  };

  const { labels, cars } = liveScene({ ...scene, places: [place], stands: [stand], values });

  expect(cars).toHaveLength(1);

  expect(labels.at(-1)).toEqual({
    anchor: [14, -3, 2.5],
    leader: [14, -3, 0],
    quantities: [{ kind: "car", device: 7, watts: 7360, soc: 63 }],
  });
});
