/// <reference types="bun" />
import { expect, test } from "bun:test";
import { loadPv } from "@sunreye/pv-wasm";
import type { Sizing } from "./pv.ts";

// The engine as @sunreye/pv-wasm ships it.
const wasm = new URL(import.meta.resolve("@sunreye/pv-wasm/pv.wasm"));

const pv = await loadPv(await Bun.file(wasm).bytes());

const datasheet = {
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
};

const wired = (input: number, modules: number, device = 1) => ({
  name: "",
  moduleType: 7,
  device,
  input,
  modules,
  optimized: 0,
  tilt: 35,
  azimuth: 0,
  loss: 2,
});

/** Two inputs, each tracking 160–650 V from 160 V at up to 36 A. */
const INPUT = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };
const INVERTERS = { 1: [INPUT, INPUT] };

/** Each warning with its volts rounded to a hundredth. */
const rounded = (found: readonly Sizing[]) =>
  found.map((item) =>
    "volts" in item ? { ...item, volts: Math.round(item.volts * 100) / 100 } : item,
  );

test("the crate finds where strings leave their MPPT inputs' windows", () => {
  const found = pv.sizing(
    [datasheet],
    [wired(1, 3), wired(1, 10), wired(2, 18), wired(3, 10), wired(1, 10, 9)],
    INVERTERS,
  );

  expect(rounded(found)).toEqual([
    { kind: "start", string: 0, volts: 134.62, limit: 160 },
    { kind: "low", string: 0, volts: 89.61, limit: 160 },
    { kind: "high", string: 2, volts: 669.83, limit: 650 },
    { kind: "noInput", string: 3 },
    { kind: "uneven", device: 1, input: 1 },
  ]);
});

test("three parallel strings exceed an input's current; a hot short string runs under its window", () => {
  expect(pv.sizing([datasheet], [wired(2, 10), wired(2, 10), wired(2, 10)], INVERTERS)).toEqual([
    { kind: "current", device: 1, input: 2, amperes: 37.5, limit: 36 },
  ]);
  expect(rounded(pv.sizing([datasheet], [wired(1, 5)], INVERTERS))).toEqual([
    { kind: "low", string: 0, volts: 149.35, limit: 160 },
  ]);
});

test("the longest string stays under the inverter's voltage and the window's top in the cold", () => {
  expect(pv.longest(datasheet, 800, INPUT)).toBe(17);
  expect(pv.longest(datasheet, 600, null)).toBe(13);
  expect(pv.longest(datasheet, null, null)).toBeNull();
});
