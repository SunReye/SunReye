import { expect, test } from "bun:test";
import { kilowatts, modelOf } from "./shared.ts";

const WIDE = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };
const NARROW = { maxCurrent: 20, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };
const SHEET = { name: "15K", rated: 15_000, inputs: 4, current: 280, mppt: WIDE } as const;

test("a model's rated power identifies it, caps it and names its variant", () => {
  const model = modelOf(SHEET, 800);

  expect(model.rated).toBe(15_000);
  expect(model.inverter).toEqual({ maxInputVoltage: 800, acRating: 15_000, mppt: [WIDE, WIDE] });
  expect(kilowatts(model.rated)).toBe("15k");
});

test("two trackers with their own limits are declared apart", () => {
  const model = modelOf({ ...SHEET, mppt: [WIDE, NARROW] }, 1000);

  expect(model.inverter.mppt).toEqual([WIDE, NARROW]);
});

test.each([0, -5000, Number.NaN])("a model without a rated power is refused: %p", (watts) => {
  expect(() => kilowatts(watts)).toThrow("a model needs its rated power");
  expect(() => modelOf({ ...SHEET, rated: watts }, 800)).toThrow("a model needs its rated power");
});
