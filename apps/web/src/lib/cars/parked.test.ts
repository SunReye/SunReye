/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { CarPlace, Point } from "../../../../../packages/builder/src/builder/pv.ts";
import { parked } from "../../../../../packages/builder/src/cars/parked.ts";

const place: CarPlace = {
  device: 7,
  x: 0,
  z: 0,
  width: 2.5,
  length: 5,
  rotation: 0,
  colour: "#123456",
};

const stand = {
  at: [1.25, -2.5, 0],
  forward: [0, 1, 0],
  above: [1.25, -2.5, 2.5],
} satisfies Record<string, Point>;

test("with no car connected the place is empty", () => {
  expect(parked([place], [stand], {})).toEqual([]);
  expect(parked([place], [stand], { "7": { "ev.connected": 0 } })).toEqual([]);
});

test("a connected car stands with its charge power and SOC, in the admin's pick", () => {
  const values = { "7": { "ev.connected": 1, "ev.charge.power": 7360, "ev.vehicle.soc": 63 } };

  expect(parked([place], [stand], values)).toEqual([
    {
      ...stand,
      device: 7,
      length: 5,
      width: 2.5,
      colour: "#123456",
      model: null,
      watts: 7360,
      soc: 63,
    },
  ]);
});

test("a place without a colour paints the default body its own grey", () => {
  const bare = { ...place, colour: null, model: "ab".repeat(32) };

  expect(parked([bare], [stand], { "7": { "ev.connected": 1 } })[0]).toMatchObject({
    colour: "#232528",
    model: "ab".repeat(32),
    watts: null,
    soc: null,
  });
});

test("without stands, a refused place, no car is drawn", () => {
  expect(parked([place], null, { "7": { "ev.connected": 1 } })).toEqual([]);
});
