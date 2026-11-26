/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Listing } from "../api/core.ts";
import { catalogue } from "./catalogue.ts";

function variant(id: string, name: string, acRating: number): Listing["variants"][number] {
  return { id, name, acRating };
}

function listing(
  id: string,
  manufacturer: string,
  name: string,
  acRating: number | null,
  variants: readonly Readonly<Listing["variants"][number]>[] = [],
): Listing {
  return {
    id,
    manufacturer,
    name,
    version: "1.0.0",
    official: true,
    acRating,
    variants: [...variants],
  };
}

const SERVED: readonly Readonly<Listing>[] = [
  listing("deye-sg01hp3", "Deye", "SG01HP3", 25_000, [
    variant("12k", "SUN-12K-SG01HP3", 12_000),
    variant("5k", "SUN-5K-SG01HP3", 5000),
  ]),
  listing("deye-sg05lp3", "Deye", "SG05LP3", 20_000, [
    variant("5k", "SUN-5K-SG05LP3-EU-SM2", 5000),
    variant("15k", "SUN-15K-SG05LP3-EU-SM2", 15_000),
    variant("12k", "SUN-12K-SG05LP3-EU-SM2", 12_000),
  ]),
  listing("evcc", "EVCC", "Loadpoint", null),
  listing("shelly-pro-3em", "Shelly", "Pro 3EM", null),
];

/** Each manufacturer's families, each offer as its profile and, for a variant, `profile/variant`. */
function ids(query: string): Record<string, string[][]> {
  return Object.fromEntries(
    catalogue(SERVED, query).map(({ name, families }) => [
      name,
      families.map((family) =>
        family.map((offer) =>
          offer.variant === undefined ? offer.profile : `${offer.profile}/${offer.variant}`,
        ),
      ),
    ]),
  );
}

test("profiles group by manufacturer, then by family: its base first, then its variants by rating", () => {
  expect(ids("")).toEqual({
    Deye: [
      ["deye-sg01hp3", "deye-sg01hp3/5k", "deye-sg01hp3/12k"],
      ["deye-sg05lp3", "deye-sg05lp3/5k", "deye-sg05lp3/12k", "deye-sg05lp3/15k"],
    ],
    EVCC: [["evcc"]],
    Shelly: [["shelly-pro-3em"]],
  });
});

test("a family's base is marked as the base and carries no variant; a variant has its own name and rating", () => {
  const [base, small] = catalogue(SERVED, "sg05")[0]?.families[0] ?? [];

  expect(base).toMatchObject({ profile: "deye-sg05lp3", name: "SG05LP3", base: true });
  expect(base?.variant).toBeUndefined();
  expect(small).toMatchObject({
    profile: "deye-sg05lp3",
    variant: "5k",
    name: "SUN-5K-SG05LP3-EU-SM2",
    acRating: 5000,
    base: false,
  });
  expect(catalogue(SERVED, "evcc")[0]?.families[0]?.[0]?.base).toBe(false);
});

test("search finds a model by any token of its name or ids, in any case", () => {
  expect(ids("sg05")).toEqual({
    Deye: [["deye-sg05lp3", "deye-sg05lp3/5k", "deye-sg05lp3/12k", "deye-sg05lp3/15k"]],
  });
  expect(ids("12k")).toEqual({ Deye: [["deye-sg01hp3/12k"], ["deye-sg05lp3/12k"]] });
  expect(Object.keys(ids("deye"))).toEqual(["Deye"]);
  expect(ids("SG05LP3 15k")).toEqual({ Deye: [["deye-sg05lp3/15k"]] });
});

test("search ignores separators and finds a model by its rating", () => {
  expect(ids("SUN-15K")).toEqual({ Deye: [["deye-sg05lp3/15k"]] });
  expect(ids("15 kW")).toEqual({ Deye: [["deye-sg05lp3/15k"]] });
  expect(ids("pro3em")).toEqual({ Shelly: [["shelly-pro-3em"]] });
});

test("a search nothing matches leaves no group", () => {
  expect(catalogue(SERVED, "fronius")).toEqual([]);
});
