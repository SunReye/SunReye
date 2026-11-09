import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect, type Transport } from "./api/core.ts";
import DayChart from "./DayChart.svelte";

const WIRING = { moduleType: 1, modules: 16, optimized: 0, tilt: 35, loss: 2 };

/** The owner's layout: south and north on device 1, and a string on another inverter. */
const LAYOUT = {
  appliesFrom: "2026-11-01T00:00:00Z",
  strings: [
    { ...WIRING, id: 4, name: "south", device: 1, input: 1, azimuth: 0 },
    { ...WIRING, id: 5, name: "north", device: 1, input: 1, azimuth: 180 },
    { ...WIRING, id: 6, name: "garage", device: 2, input: 1, azimuth: 0 },
  ],
};

/** A test core: the layout, one forecast point per string and no history. */
function testCore(): Transport & { readonly asked: string[] } {
  const asked: string[] = [];

  return {
    base: "http://core.test/",
    asked,
    fetch: (request) => {
      const url = new URL(request.url);

      asked.push(url.pathname + url.search);

      if (url.pathname.endsWith("/layout")) return Promise.resolve(Response.json(LAYOUT));

      if (url.pathname.endsWith("/forecasts")) {
        const target = "2026-11-09T11:00:00Z";

        return Promise.resolve(
          Response.json({ points: [{ target, issued: "2026-11-09T10:00:00Z", value: 2400 }] }),
        );
      }

      return Promise.resolve(Response.json({ tier: "raw", points: [] }));
    },
  };
}

test("the day chart shows each of its inverter's strings' forecast", async () => {
  const transport = testCore();

  const chart = await render(DayChart, {
    core: connect(transport),
    device: 1,
    series: ["pv.power"],
  });

  await expect
    .poll(() => transport.asked.filter((path) => path.includes("/forecasts")).toSorted())
    .toEqual([
      expect.stringMatching(/^\/api\/v1\/devices\/1\/forecasts\?series=pv\.string\.power%5B4%5D&/u),
      expect.stringMatching(/^\/api\/v1\/devices\/1\/forecasts\?series=pv\.string\.power%5B5%5D&/u),
    ]);
  await expect.element(chart.getByText("south forecast")).toBeVisible();
  await expect.element(chart.getByText("north forecast")).toBeVisible();
});
