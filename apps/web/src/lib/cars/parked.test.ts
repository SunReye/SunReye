/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { CarPlace, Point } from "../builder/pv.ts";
import { parked } from "./parked.ts";

const place: CarPlace = {
  device: 7,
  x: 0,
  z: 0,
  width: 2.5,
  length: 5,
  rotation: 0,
  body: { class: "van", colour: "#123456" },
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
      body: { class: "van", colour: "#123456" },
      model: null,
      watts: 7360,
      soc: 63,
    },
  ]);
});

test("a vehicle title in the catalogue picks its body; without a pick it is a grey sedan", () => {
  const tesla = { "7": { "ev.connected": 1, "ev.vehicle.model": 1 } };
  const unknown = { "7": { "ev.connected": 1, "ev.vehicle.model": 999 } };
  const bare = { ...place, body: null, model: "ab".repeat(32) };

  expect(parked([place], [stand], tesla)[0]?.body).toEqual({ class: "sedan", colour: "#f2f2ee" });
  expect(parked([place], [stand], unknown)[0]?.body).toEqual({ class: "van", colour: "#123456" });
  expect(parked([bare], [stand], unknown)[0]).toMatchObject({
    body: { class: "sedan", colour: "#8a8f98" },
    model: "ab".repeat(32),
    watts: null,
    soc: null,
  });
});

test("without stands, a refused place, no car is drawn", () => {
  expect(parked([place], null, { "7": { "ev.connected": 1 } })).toEqual([]);
});
