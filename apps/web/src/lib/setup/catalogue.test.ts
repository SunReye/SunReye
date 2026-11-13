/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Listing } from "../api/core.ts";
import { catalogue, covers } from "./catalogue.ts";

function listing(id: string, manufacturer: string, name: string, acRating: number | null): Listing {
  return { id, manufacturer, name, version: "1.0.0", official: true, acRating };
}

const SERVED: readonly Readonly<Listing>[] = [
  listing("deye-sg01hp3", "Deye", "SG01HP3", 25_000),
  listing("deye-sg01hp3-12k", "Deye", "SUN-12K-SG01HP3", 12_000),
  listing("deye-sg01hp3-5k", "Deye", "SUN-5K-SG01HP3", 5000),
  listing("deye-sg05lp3", "Deye", "SG05LP3", 20_000),
  listing("deye-sun12k-sg05lp3", "Deye", "SUN-12K-SG05LP3-EU-SM2", 12_000),
  listing("deye-sun15k-sg05lp3", "Deye", "SUN-15K-SG05LP3-EU-SM2", 15_000),
  listing("deye-sun5k-sg05lp3", "Deye", "SUN-5K-SG05LP3-EU-SM2", 5000),
  listing("evcc", "EVCC", "Loadpoint", null),
  listing("shelly-pro-3em", "Shelly", "Pro 3EM", null),
];

/** Each manufacturer's families as their profiles' ids. */
function ids(query: string): Record<string, string[][]> {
  return Object.fromEntries(
    catalogue(SERVED, query).map(({ name, families }) => [
      name,
      families.map((family) => family.map((p) => p.id)),
    ]),
  );
}

test("profiles group by manufacturer, then by family, its own profile first and models by rating", () => {
  expect(ids("")).toEqual({
    Deye: [
      ["deye-sg01hp3", "deye-sg01hp3-5k", "deye-sg01hp3-12k"],
      ["deye-sg05lp3", "deye-sun5k-sg05lp3", "deye-sun12k-sg05lp3", "deye-sun15k-sg05lp3"],
    ],
    EVCC: [["evcc"]],
    Shelly: [["shelly-pro-3em"]],
  });
});

test("search finds a model by any token of its name or id, in any case", () => {
  expect(ids("sg05")).toEqual({
    Deye: [["deye-sg05lp3", "deye-sun5k-sg05lp3", "deye-sun12k-sg05lp3", "deye-sun15k-sg05lp3"]],
  });
  expect(ids("12k")).toEqual({ Deye: [["deye-sg01hp3-12k"], ["deye-sun12k-sg05lp3"]] });
  expect(Object.keys(ids("deye"))).toEqual(["Deye"]);
  expect(ids("SG05LP3 15k")).toEqual({ Deye: [["deye-sun15k-sg05lp3"]] });
});

test("search ignores separators and finds a model by its rating", () => {
  expect(ids("SUN-15K")).toEqual({ Deye: [["deye-sun15k-sg05lp3"]] });
  expect(ids("15 kW")).toEqual({ Deye: [["deye-sun15k-sg05lp3"]] });
  expect(ids("pro3em")).toEqual({ Shelly: [["shelly-pro-3em"]] });
});

test("a search nothing matches leaves no group", () => {
  expect(catalogue(SERVED, "fronius")).toEqual([]);
});

test("a family profile covers the models whose ids hold its tokens", () => {
  expect(SERVED.flatMap((p) => (covers(p, SERVED) ? [p.id] : []))).toEqual([
    "deye-sg01hp3",
    "deye-sg05lp3",
  ]);
});
