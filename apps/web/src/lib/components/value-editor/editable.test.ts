/// <reference types="bun" />
import { expect, test } from "bun:test";
import { editable, fits, wheel } from "./editable.ts";

const charge = editable({
  key: "battery.max_charge_current",
  name: "Max battery charge current",
  unit: "A",
  range: { min: 0, max: 240 },
  step: 1,
});

const feedIn = editable({
  key: "grid.export",
  range: { min: 5, max: 100 },
  step: 10,
});

const mode = editable({
  key: "work_mode",
  values: [0, 1, 2],
  labels: [{ value: 1, text: "Zero export" }],
  step: 1,
});

test("a ranged setting edits as a number with its name, unit and bounds", () => {
  expect(charge).toEqual({
    kind: "number",
    name: "Max battery charge current",
    unit: "A",
    min: 0,
    max: 240,
    step: 1,
  });
});

test("an enumerated setting edits as a list of its labelled values", () => {
  expect(mode).toEqual({
    kind: "enum",
    name: "work_mode",
    options: [
      { value: 0, text: "0" },
      { value: 1, text: "Zero export" },
      { value: 2, text: "2" },
    ],
  });
});

test("values outside the bounds or off the step cannot be applied", () => {
  expect(fits(charge, 80)).toBe(true);
  expect(fits(charge, 0)).toBe(true);
  expect(fits(charge, 240)).toBe(true);
  expect(fits(charge, -1)).toBe(false);
  expect(fits(charge, 241)).toBe(false);
  expect(fits(charge, 80.5)).toBe(false);
  expect(fits(charge, Number.NaN)).toBe(false);
  expect(fits(mode, 2)).toBe(true);
  expect(fits(mode, 3)).toBe(false);
});

test("the step counts from zero, as the core's funnel does", () => {
  expect(fits(feedIn, 5)).toBe(false);
  expect(fits(feedIn, 10)).toBe(true);
  expect(fits(feedIn, 100)).toBe(true);
});

test("the wheel's rows are the whole steps inside the bounds", () => {
  const rows = wheel({ kind: "number", name: "grid.export", unit: "", min: 5, max: 100, step: 10 });

  expect(rows.count).toBe(10);
  expect(rows.at(0)).toBe(10);
  expect(rows.at(9)).toBe(100);
  expect(rows.index(40)).toBe(3);
});

test("a fractional step lands on clean values", () => {
  const rows = wheel({ kind: "number", name: "x", unit: "", min: 0, max: 1, step: 0.1 });

  expect(rows.count).toBe(11);
  expect(rows.at(3)).toBe(0.3);
  expect(rows.index(0.7)).toBe(7);
});
