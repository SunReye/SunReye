/// <reference types="bun" />
import { expect, test } from "bun:test";
import { valueText } from "../../../../../../packages/builder/src/builder/handles/value.ts";

test("lengths show to the decimetre, angles whole, a move as x and z", () => {
  expect(valueText({ value: [12], unit: "m" }, "de")).toBe("12,0 m");
  expect(valueText({ value: [45], unit: "°" }, "de")).toBe("45°");
  expect(valueText({ value: [3, -1.5], unit: "m" }, "en")).toBe("x 3.0 · z -1.5 m");
});

test("a chimney or a roof window on its face shows how far it stands from the eave and the verge", () => {
  expect(valueText({ value: [2.2, 4.7], unit: "roof" }, "en")).toBe("Eave 2.2 m · Verge 4.7 m");
  expect(valueText({ value: [2.2, 4.7], unit: "roof" }, "de")).toBe("Traufe 2,2 m · Ortgang 4,7 m");
});

test("a roof object's size shows to the centimetre", () => {
  expect(valueText({ value: [1.03], unit: "size" }, "en")).toBe("1.03 m");
});

test("a size stopped at the edge says so", () => {
  expect(valueText({ value: [7.3], unit: "size", edge: true }, "en")).toBe("7.30 m · at the edge");
  expect(valueText({ value: [7.3], unit: "size", edge: true }, "de")).toBe("7,30 m · an der Kante");
});
