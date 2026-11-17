import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Weather } from "../weather/weather.ts";
import type { Day } from "./day.ts";
import NowStrip from "./NowStrip.svelte";

const NOW = new Date("2026-11-14T12:00:00Z");

/** A day read at noon whose weather is `known`. */
function day(known: Partial<Weather>): Day {
  return {
    zone: "UTC",
    now: NOW,
    start: new Date("2026-11-14T00:00:00Z"),
    end: new Date("2026-11-15T00:00:00Z"),
    today: {
      production: 8,
      consumption: 5,
      feedIn: 4,
      purchase: 1,
      autarky: 80,
      selfUse: 50,
      peaks: { production: null, consumption: null },
    },
    rows: [],
    pv: { total: 12, remaining: 4 },
    prices: [],
    weather: {
      cloud: null,
      code: null,
      precipitation: null,
      snowfall: null,
      snowDepth: null,
      visibility: null,
      wind: null,
      windDirection: null,
      celsius: 7,
      ghi: 300,
      clearness: null,
      dry: null,
      ...known,
    },
    money: null,
  };
}

const strip = (known: Partial<Weather>) =>
  render(NowStrip, {
    spot: undefined,
    tariff: undefined,
    day: day(known),
    onopen: () => {},
  });

test("the weather cell says what the weather code says is falling, with its icon", async () => {
  const screen = await strip({ code: 63, cloud: 0.9 });
  const cell = screen.getByRole("button", { name: /Wetter/u });

  await expect.element(cell.getByText("Regen", { exact: true })).toBeVisible();
  expect(cell.element().querySelector("svg.lucide-cloud-rain")).not.toBeNull();
});

test("under a dry code the cell's word follows the measured sky, not the forecast's code", async () => {
  // The forecast says overcast; the clear-sky index measured an open sky.
  const screen = await strip({ code: 3, cloud: 0.1 });
  const cell = screen.getByRole("button", { name: /Wetter/u });

  await expect.element(cell.getByText("Sonnig", { exact: true })).toBeVisible();
  expect(cell.element().querySelector("svg.lucide-sun")).not.toBeNull();
});

test("without weather the cell shows neither a word nor an icon", async () => {
  const screen = await render(NowStrip, {
    spot: undefined,
    tariff: undefined,
    day: undefined,
    onopen: () => {},
  });

  const cell = screen.getByRole("button", { name: /Wetter/u });

  await expect.element(cell).toBeVisible();
  expect(cell.element().querySelector("svg")).toBeNull();
});
