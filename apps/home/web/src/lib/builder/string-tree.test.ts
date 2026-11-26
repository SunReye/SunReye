/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { StringDraft } from "../api/core.ts";
import { stringTree } from "../../../../../../packages/builder/src/builder/string-tree.ts";

const string = (name: string, device: number, input: number): StringDraft => ({
  name,
  moduleType: 7,
  device,
  input,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 2,
});

const INPUT = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };
const DEVICES = [{ id: 1, name: "Deye", profile: "deye", connection: 1, unit: 1 }];

test("the strings stand under their inverter's MPPT inputs, a free input and each warning with them", () => {
  const tree = stringTree({
    strings: [string("Süd", 1, 2), string("Ost", 1, 1), string("West", 1, 2)],
    devices: DEVICES,
    inputs: { 1: [INPUT, INPUT, INPUT] },
    warnings: [
      { string: 2, text: "West: zu kurz" },
      { device: 1, input: 2, text: "MPPT-Eingang 2: ungleich lang" },
    ],
  });

  expect(tree).toEqual([
    {
      device: 1,
      name: "Deye",
      inputs: [
        { input: 1, warnings: [], strings: [{ index: 1, warnings: [] }] },
        {
          input: 2,
          warnings: ["MPPT-Eingang 2: ungleich lang"],
          strings: [
            { index: 0, warnings: [] },
            { index: 2, warnings: ["West: zu kurz"] },
          ],
        },
        { input: 3, warnings: [], strings: [] },
      ],
    },
  ]);
});

test("an inverter without listed inputs shows the inputs its strings name, by its number unnamed", () => {
  const tree = stringTree({
    strings: [string("Garage", 4, 2)],
    devices: DEVICES,
    inputs: { 1: [INPUT] },
    warnings: [],
  });

  expect(tree).toEqual([
    { device: 1, name: "Deye", inputs: [{ input: 1, warnings: [], strings: [] }] },
    {
      device: 4,
      name: "4",
      inputs: [{ input: 2, warnings: [], strings: [{ index: 0, warnings: [] }] }],
    },
  ]);
});
