import { expect, test } from "bun:test";
import { PLANT } from "../api/computed-devices.ts";
import { exploreHash, seriesParam, toggled, viewOf } from "./view.ts";

const params = (query: string) => new URLSearchParams(query);

const PV = { device: PLANT, series: "pv.power" };
const LOAD = { device: PLANT, series: "load.power" };

test("a route that names nothing shows the plant's PV power and house load as series", () => {
  expect(viewOf(params(""))).toEqual({
    mode: "series",
    series: [PV, LOAD],
    periods: [],
    picking: false,
  });
});

test("devices, series, mode and overlay periods are read from the route", () => {
  const view = viewOf(
    params(
      "mode=overlay&s=3:pv.mppt.power[2],4294967294:load.power&vs=2026-11-14,2025-11-15&pick=1",
    ),
  );

  expect(view).toEqual({
    mode: "overlay",
    series: [{ device: 3, series: "pv.mppt.power[2]" }, LOAD],
    periods: ["2026-11-14", "2025-11-15"],
    picking: true,
  });
});

test("a series survives the route both ways, whatever its name holds", () => {
  const refs = [
    { device: 3, series: "pv.mppt.power[2]" },
    { device: 7, series: "extra.Zähler, alt: 100%" },
  ];

  const query = new URLSearchParams({ s: seriesParam(refs)! }).toString();

  expect(viewOf(params(query)).series).toEqual(refs);
});

test("the default series leave the route bare; none chosen is an empty list, not the default", () => {
  expect(seriesParam([PV, LOAD])).toBeNull();
  expect(seriesParam([])).toBe("");
  expect(viewOf(params("s=")).series).toEqual([]);
});

test("what the route cannot mean is dropped: an unknown mode, a broken series, a repeat, a date", () => {
  const view = viewOf(
    params("mode=pie&s=x:pv.power,3:,3:pv.power,3:pv.power&vs=tomorrow,2026-11-14"),
  );

  expect(view.mode).toBe("series");
  expect(view.series).toEqual([{ device: 3, series: "pv.power" }]);
  expect(view.periods).toEqual(["2026-11-14"]);
});

test("overlay offsets are read beside dates; an unknown offset is dropped", () => {
  const view = viewOf(params("vs=-1d,-1w,-1y,-2d,+1d,-1m,1d,2026-11-14"));

  expect(view.periods).toEqual(["-1d", "-1w", "-1y", "2026-11-14"]);
});

test("picking a series adds it after the chosen ones, picking it again removes it", () => {
  const input = { device: 3, series: "pv.mppt.voltage[1]" };
  const added = toggled([PV, LOAD], input);

  expect(added).toEqual([PV, LOAD, input]);
  expect(toggled(added, { ...input })).toEqual([PV, LOAD]);
});

test("a link to a device's series at a range is the Explore hash route", () => {
  expect(
    exploreHash({ device: 3, series: "pv.mppt.power[2]" }, { range: "week", at: "2026-08-31" }),
  ).toBe("#/explore?range=week&at=2026-08-31&s=3%3Apv.mppt.power%5B2%5D");
  expect(exploreHash({ device: 3, series: "extra.fan" }, { range: "day", at: null })).toBe(
    "#/explore?range=day&s=3%3Aextra.fan",
  );
});
