/// <reference types="bun" />
import { expect, test } from "bun:test";
import { limitsOf } from "./checks.ts";

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
