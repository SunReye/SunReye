/// <reference types="bun" />
import { expect, test } from "bun:test";
import { valueText } from "../../../../../../packages/builder/src/builder/handles/value.ts";

test("lengths show to the decimetre, angles whole, a move as x and z", () => {
  expect(valueText({ value: [12], unit: "m" }, "de")).toBe("12,0 m");
  expect(valueText({ value: [45], unit: "°" }, "de")).toBe("45°");
  expect(valueText({ value: [3, -1.5], unit: "m" }, "en")).toBe("x 3.0 · z -1.5 m");
});
