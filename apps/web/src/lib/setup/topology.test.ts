/// <reference types="bun" />
import { expect, test } from "bun:test";
import { propose, remove } from "./topology.ts";

const INVERTER = { id: 1, name: "Wechselrichter", profile: "p", connection: 1, unit: 1 };
const WALLBOX = { id: 2, name: "Wallbox", profile: "q", connection: 2, unit: 1 };

const label = (role: string) => `<${role}>`;

test("the grid meter claims the root and each other power role hangs below it", () => {
  const values = {
    devices: {
      "1": { "grid.power": -300, "pv.power": 1200, "pv.mppt.power[1]": 600, "battery.power": 0 },
      "2": { "ev.charge.power": 0, "ev.soc": 40 },
    },
  };

  expect(propose([INVERTER, WALLBOX], values, "Netz", label)).toEqual([
    { name: "Netz", parent: null, claims: [{ device: 1, role: "grid.power" }] },
    { name: "Wechselrichter <pv.power>", parent: 0, claims: [{ device: 1, role: "pv.power" }] },
    {
      name: "Wechselrichter <battery.power>",
      parent: 0,
      claims: [{ device: 1, role: "battery.power" }],
    },
    {
      name: "Wallbox <ev.charge.power>",
      parent: 0,
      claims: [{ device: 2, role: "ev.charge.power" }],
    },
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
