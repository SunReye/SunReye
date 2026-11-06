import { describe, expect, test } from "bun:test";
import { SECTIONS, servedSections } from "./sections";

const ids = (served: (name: string) => boolean) =>
  servedSections(SECTIONS, served).map((section) => section.id);

describe("servedSections", () => {
  test("a core without prices and costs shows the energy section alone", () => {
    expect(ids((name) => name !== "pricesAndCosts")).toEqual(["energy"]);
  });

  test("a core with them shows every section, in registry order", () => {
    expect(ids(() => true)).toEqual(["cost", "energy", "prices", "records", "amortisation"]);
  });

  test("another capability does not stand in for the one a section needs", () => {
    expect(ids((name) => name === "statistics")).toEqual(["energy"]);
  });
});
