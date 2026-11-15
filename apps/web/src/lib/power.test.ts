import { expect, test } from "bun:test";
import { formatPower } from "./power.ts";

test("below 1 kW a power reads in whole watts", () => {
  expect([formatPower(10), formatPower(999), formatPower(0.4)]).toEqual(["10 W", "999 W", "0 W"]);
});

test("from 1 kW it reads in kilowatts to a tenth", () => {
  expect([formatPower(1000), formatPower(12_345)]).toEqual(["1,0 kW", "12,3 kW"]);
});

test("a power that rounds to 1 000 W reads as 1,0 kW", () => {
  expect(formatPower(999.6)).toBe("1,0 kW");
});

test("the sign is kept, the unit chosen by magnitude", () => {
  expect([formatPower(-450), formatPower(-2500), formatPower(-0.4)]).toEqual([
    "-450 W",
    "-2,5 kW",
    "0 W",
  ]);
});
