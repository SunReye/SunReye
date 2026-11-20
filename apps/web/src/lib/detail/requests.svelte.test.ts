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

test("the PV sheet opens on one read of each thing its shown tab needs", async () => {
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
    // The overview tab's range and the PV facts below the tabs, no hidden tab's; a range read
    // asked twice at once, once.
    [`devices/${PLANT}/statistics`]: 5,
    [`devices/${INVERTER}/forecasts`]: 2,
  });
});

/** The string comparison's reads: each string's energy from the inverter. */
const strings = () => asked.filter(({ series }) => series.startsWith("pv.string.")).length;

test("a hidden tab reads nothing until it is shown", async () => {
  const { screen } = await show("production");
  const sheet = screen.getByRole("dialog");

  await expect.element(sheet.getByRole("tab", { name: "Vergleich" })).toBeVisible();
  await settled(() => requests().length);

  expect(strings()).toBe(0);

  await sheet.getByRole("tab", { name: "Vergleich" }).click();
  await settled(() => requests().length);

  expect(strings()).toBe(2);
});
