import { expect, test } from "bun:test";
import { roleWord } from "./point-look.ts";

test("a point's word is its role's plain word, else the role's name", () => {
  expect(roleWord("pv.power")).toBe("PV");
  expect(roleWord("inverter.power")).toBe("Wechselrichter · Leistung");
});
