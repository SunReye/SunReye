/// <reference types="bun" />
import { expect, test } from "bun:test";
import { inputsOf, limitsOf, sized } from "./checks.ts";
import type { Sizing } from "@sunreye/builder/builder/pv.ts";

test("the limits are each inverter's maximum DC input voltage, by device id", () => {
  const support = { estimated: [], series: [], settings: [], writes: false };

  expect(
    limitsOf({
      devices: {
        "1": { ...support, maxInputVoltage: 800 },
        "2": support,
      },
    }),
  ).toEqual({ 1: 800 });
});

const INPUT = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };

test("the inputs are each inverter's MPPT inputs' limits, by device id", () => {
  const support = { estimated: [], series: [], settings: [], writes: false };

  expect(
    inputsOf({ devices: { "1": { ...support, inputs: [INPUT, INPUT] }, "2": support } }),
  ).toEqual({ 1: [INPUT, INPUT] });
});

const STRING = { moduleType: 7, device: 1, modules: 0, optimized: 0, tilt: 0, azimuth: 0, loss: 2 };

const DRAFT = {
  scene: { north: 0, blocks: [], obstacles: [] },
  strings: [
    { ...STRING, name: "Süd", input: 1 },
    { ...STRING, name: "Nord", input: 3 },
  ],
};

/** The draft's warnings where the crate finds `found`. */
const worded = (...found: readonly Sizing[]) =>
  sized({ sizing: () => [...found] }, DRAFT, [], { 1: [INPUT, INPUT] });

test("a string's MPPT window warnings name it, with figure and limit", () => {
  expect(
    worded(
      { kind: "start", string: 0, volts: 134.62, limit: 160 },
      { kind: "low", string: 0, volts: 149.35, limit: 160 },
      { kind: "high", string: 0, volts: 669.83, limit: 650 },
      { kind: "noInput", string: 1 },
    ),
  ).toEqual([
    {
      string: 0,
      text: "Süd: 135 V Leerlaufspannung bei −10 °C bleiben unter der Startspannung von 160 V. Der String startet nie.",
    },
    {
      string: 0,
      text: "Süd: 149 V im Arbeitspunkt bei 70 °C Zelltemperatur liegen unter dem MPPT-Bereich ab 160 V.",
    },
    {
      string: 0,
      text: "Süd: 670 V im Arbeitspunkt bei −10 °C liegen über dem MPPT-Bereich bis 650 V.",
    },
    { string: 1, text: "Nord: Der Wechselrichter hat keinen MPPT-Eingang 3." },
  ]);
});

test("an input's warnings name the input; no inverter's inputs, no warning", () => {
  expect(
    worded(
      { kind: "current", device: 1, input: 2, amperes: 37.5, limit: 36 },
      { kind: "uneven", device: 1, input: 2 },
    ),
  ).toEqual([
    {
      device: 1,
      input: 2,
      text: "MPPT-Eingang 2: 37,5 A Kurzschlussstrom der parallelen Strings übersteigen die 36 A des Eingangs.",
    },
    { device: 1, input: 2, text: "MPPT-Eingang 2: Die parallelen Strings sind ungleich lang." },
  ]);
  expect(sized({ sizing: () => [{ kind: "noInput", string: 1 }] }, DRAFT, [], {})).toEqual([]);
});
