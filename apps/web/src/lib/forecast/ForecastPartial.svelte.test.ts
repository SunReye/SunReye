import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
// The chart is laid out by the SPA's utilities.
import "../../app.css";
import { connect } from "../api/core.ts";
import ForecastScreen from "./ForecastScreen.svelte";
import { card, DAY, legendValue, MONDAY, PAST_WEEK, testCore, WEEK } from "./forecast.harness.ts";

test("a shared input measured before its strings were laid out keeps that energy in the stack", async () => {
  // Input 1's strings were laid out on Tuesday: Monday's input 1 has no split.
  const plant = {
    ...WEEK,
    series: {
      "pv.power": [
        [MONDAY, 14],
        [MONDAY + DAY, 16],
      ],
      "pv.mppt.power[1]": [
        [MONDAY, 10],
        [MONDAY + DAY, 12],
      ],
      "pv.mppt.power[2]": [
        [MONDAY, 4],
        [MONDAY + DAY, 4],
      ],
      "pv.string.power[4]": [[MONDAY + DAY, 7]],
      "pv.string.power[5]": [[MONDAY + DAY, 5]],
    },
  } as const;

  await render(ForecastScreen, { core: connect(testCore(plant)), ...PAST_WEEK });

  await expect.poll(() => legendValue(1, "south ≈")).toBe("7,0 kWh");
  await expect.poll(() => legendValue(1, "north ≈")).toBe("5,0 kWh");
  await expect.poll(() => legendValue(1, "MPPT 1 ohne Aufteilung")).toBe("10,0 kWh");
  await expect.poll(() => legendValue(1, "MPPT 2")).toBe("8,0 kWh");
});

test("a day the forecast covers only in part is left out of the comparison", async () => {
  // The forecast starts at Tuesday noon, when the layout came into force.
  const plant = { ...WEEK, forecast: { ...WEEK.forecast, from: MONDAY + 1.5 * DAY } };

  await render(ForecastScreen, { core: connect(testCore(plant)), ...PAST_WEEK });

  // Only Wednesday is compared: 8 kWh measured against 12 forecast.
  await expect
    .element(card(2).getByText("In KW 45 wurden 30,0 kWh erzeugt, 33 % weniger als vorhergesagt."))
    .toBeVisible();
  await expect.poll(() => legendValue(2, "Prognose")).toBe("12,0 kWh");
});
