import { expect, test } from "bun:test";
import { sidesOf } from "./roles.ts";

test("a signed series' sides are named by its sign: the grid imports above, exports below", () => {
  expect(sidesOf("grid.power")).toEqual([
    { label: "Bezogen", colour: "var(--e-import)" },
    { label: "Eingespeist", colour: "var(--e-export)" },
  ]);
});

test("a battery charges above and discharges below, both in its own flow's colour", () => {
  expect(sidesOf("battery.power")).toEqual([
    { label: "Geladen", colour: "var(--e-battery)" },
    { label: "Entladen", colour: "var(--e-battery)" },
  ]);
});

test("a signed series of no named sides is above and below zero", () => {
  expect(sidesOf("price.spot").map((s) => s.label)).toEqual(["Über null", "Unter null"]);
});
