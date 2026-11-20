// How many requests a detail sheet makes as it opens on the dashboard: a redundant read shows here.
import { afterEach, beforeEach, expect, test } from "vitest";
import "../../app.css";
import { settled, tally } from "../api/core.harness.ts";
import { asked, fetched, INVERTER, PLANT, prepare, restore, show } from "./detail.harness.ts";

beforeEach(prepare);

afterEach(restore);

/** Every request so far, by path. */
const requests = () => [
  ...asked.map(({ device }) => `/api/v1/devices/${device}/statistics`),
  ...fetched.map((line) => line.split(" ")[0] ?? ""),
];

/** The requests the dashboard makes as it opens with sheet `detail`, by path. */
async function opening(detail: string | null) {
  asked.length = 0;
  fetched.length = 0;

  const { screen } = await show(detail);

  await expect
    .element(
      detail === null ? screen.getByRole("group", { name: "Heute" }) : screen.getByRole("dialog"),
    )
    .toBeVisible();
  await settled(() => requests().length);
  await screen.unmount();

  return tally(requests());
}

test("the PV sheet opens on what its tabs and facts read, and nothing the dashboard read", async () => {
  const dashboard = await opening(null);
  const both = await opening("production");

  // What the sheet adds to the dashboard's own reads.
  const sheet = new Map<string, number>();

  for (const [path, count] of Object.entries(both))
    if (count !== (dashboard[path] ?? 0)) sheet.set(path, count - (dashboard[path] ?? 0));

  expect(Object.fromEntries(sheet)).toEqual({
    // The dashboard knows neither the topology nor the stored series.
    topology: 1,
    series: 1,
    // Every tab's range, hidden ones' too, and the PV facts below the tabs.
    [`devices/${PLANT}/statistics`]: 11,
    [`devices/${INVERTER}/statistics`]: 4,
    [`devices/${INVERTER}/forecasts`]: 4,
    "module-types": 1,
    corrections: 2,
  });
});
