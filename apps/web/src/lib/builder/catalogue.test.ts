import { expect, test } from "bun:test";
import type { Datasheet } from "../api/core.ts";
import { shelves } from "@sunreye/builder/builder/catalogue.ts";

const module = (name: string, pmax: number): Datasheet => ({
  name,
  pmax,
  vmp: 34,
  imp: 13,
  voc: 41,
  isc: 14,
  powerCoefficient: -0.3,
  voltageCoefficient: -0.25,
  currentCoefficient: 0.05,
  width: 1.134,
  height: 1.722,
  bypassDiodes: 3,
});

const sheet = (
  maker: string,
  series: string,
  revision: string,
  modules: readonly Readonly<Datasheet>[],
) => ({
  maker,
  series,
  source: { title: `${series} sheet`, revision, url: "https://maker.test" },
  modules,
});

const SHEETS = [
  sheet("LONGi", "Hi-MO 6", "V17 HTB", [module("LR5-54HTB-415M", 415)]),
  sheet("AIKO", "Neostar 2S+", "V1.5", [module("A-470", 470), module("A-440", 440)]),
  sheet("LONGi", "Hi-MO 6", "V17 HTH", [module("LR5-54HTH-420M", 420)]),
];

const names = (query: string) =>
  shelves(SHEETS, query).flatMap((maker) =>
    maker.series.map((s) => [maker.name, s.name, s.modules.map((m) => m.datasheet.name)]),
  );

test("sheets group by maker and series, each series' power classes by Pmax", () => {
  expect(names("")).toEqual([
    ["AIKO", "Neostar 2S+", ["A-440", "A-470"]],
    ["LONGi", "Hi-MO 6", ["LR5-54HTB-415M", "LR5-54HTH-420M"]],
  ]);
  expect(shelves(SHEETS, "")[1]?.series[0]?.sources.map((s) => s.revision)).toEqual([
    "V17 HTB",
    "V17 HTH",
  ]);
});

test("every query word must begin a maker, series or name word, or Pmax as 450w", () => {
  expect(names("aiko 470")).toEqual([["AIKO", "Neostar 2S+", ["A-470"]]]);
  expect(names("420 w")).toEqual([["LONGi", "Hi-MO 6", ["LR5-54HTH-420M"]]]);
  expect(names("himo 54htb")).toEqual([["LONGi", "Hi-MO 6", ["LR5-54HTB-415M"]]]);
  expect(names("trina")).toEqual([]);
});
