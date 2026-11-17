import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { reset, show } from "./explore.harness.ts";

afterEach(() => {
  reset();
  vi.restoreAllMocks();
});

const PV = "4294967294:pv.power";

/** The files the browser was handed, as it saves them. */
function downloads() {
  const blobs = new Map<string, Blob>();
  const saved: Promise<{ name: string; text: string }>[] = [];

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = `blob:test/${blobs.size}`;

    if (blob instanceof Blob) blobs.set(url, blob);

    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);

    if (blob) saved.push(blob.text().then((text) => ({ name: this.download, text })));
  });

  return { saved, type: () => [...blobs.values()][0]?.type };
}

async function exported(query: string) {
  await page.viewport(1280, 800);

  const files = downloads();
  const { screen } = await show(query);
  const button = screen.getByRole("button", { name: "Als CSV exportieren" });

  await expect.element(button).toBeEnabled();
  await button.click();

  expect(files.saved).toHaveLength(1);
  expect(files.type()).toBe("text/csv;charset=utf-8");

  return files.saved[0]!;
}

test("series: the plotted points download as a CSV named for the range and tier", async () => {
  expect(await exported("range=day&at=2026-11-10")).toEqual({
    name: "sunreye-2026-11-10-raw.csv",
    text: [
      `start,end,${PV} [W],4294967294:load.power [W]`,
      "2026-11-10T00:00:00Z,2026-11-10T12:00:00Z,100,100",
      "2026-11-10T12:00:00Z,2026-11-11T00:00:00Z,300,300",
      "",
    ].join("\n"),
  });
});

test("overlay: a column per period, the earlier day on the range's clock", async () => {
  expect(await exported("mode=overlay&range=day&at=2026-11-10&vs=2026-11-09")).toEqual({
    name: "sunreye-2026-11-10-raw.csv",
    text: [
      `start,end,${PV} 2026-11-10 [W],${PV} 2026-11-09 [W]`,
      "2026-11-10T00:00:00Z,2026-11-10T12:00:00Z,100,100",
      "2026-11-10T12:00:00Z,2026-11-11T00:00:00Z,300,300",
      "",
    ].join("\n"),
  });
});

test("fold: the bars download, a week by day with its plant-local dates", async () => {
  const { name, text } = await exported("mode=fold&range=week&at=2026-11-03");
  const lines = text.split("\n");

  expect(name).toBe("sunreye-2026-11-02_2026-11-08-day.csv");
  expect(lines.slice(0, 2)).toEqual([
    `start,end,date,${PV} [W],${PV} min [W],${PV} max [W]`,
    "2026-11-02T00:00:00Z,2026-11-03T00:00:00Z,2026-11-02,200,150,250",
  ]);
  // Seven days and the line's end.
  expect(lines).toHaveLength(9);
});

test("the export follows the open mode through every switch, and ends with the last series", async () => {
  await page.viewport(1280, 800);

  const files = downloads();
  const { screen } = await show("range=week&at=2026-11-03");
  const button = screen.getByRole("button", { name: "Als CSV exportieren" });
  const open = (query: string) => screen.rerender({ params: new URLSearchParams(query) });

  await expect.element(button).toBeEnabled();
  await open("mode=fold&range=week&at=2026-11-03");
  await expect.element(screen.getByRole("table", { name: "Statistik je Zeitraum" })).toBeVisible();
  await button.click();
  await open("range=week&at=2026-11-03");
  await expect.element(screen.getByRole("group", { name: /^Reihen über die Zeit/u })).toBeVisible();
  await button.click();

  const [fold, series] = await Promise.all(files.saved);

  expect([fold?.name, series?.name]).toEqual([
    "sunreye-2026-11-02_2026-11-08-day.csv",
    "sunreye-2026-11-02_2026-11-08-hour.csv",
  ]);

  await open("s=");
  await expect.element(button).toBeDisabled();
});

/** The header's controls and its title, each by the middle of its height. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's locator.
function rows(screen: Awaited<ReturnType<typeof show>>["screen"]) {
  const [title, ...controls] = [
    screen.getByRole("heading", { name: "Erkunden", level: 1 }),
    screen.getByRole("button", { name: "Als CSV exportieren" }),
    screen.getByRole("group", { name: "Ansicht" }),
    screen.getByRole("button", { name: "Vollbild", exact: true }),
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the browser's locator.
  ].map((locator) => {
    const box = locator.element().getBoundingClientRect();

    return box.top + box.height / 2;
  });

  return { title: title!, controls };
}

test("on a phone the export stands in one row with the title, the mode switch and fullscreen", async () => {
  await page.viewport(390, 844);

  const { screen } = await show();

  await expect.element(screen.getByRole("button", { name: "Als CSV exportieren" })).toBeVisible();

  const { title, controls } = rows(screen);
  const tops = [title, ...controls];

  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(8);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});

test("on a phone too narrow for that the controls share a row of their own under the title", async () => {
  await page.viewport(360, 740);

  const { screen } = await show();

  await expect.element(screen.getByRole("button", { name: "Als CSV exportieren" })).toBeVisible();

  const { title, controls } = rows(screen);

  expect(Math.max(...controls) - Math.min(...controls)).toBeLessThanOrEqual(8);
  expect(Math.min(...controls)).toBeGreaterThan(title + 8);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(360);
});

test("with nothing plotted there is nothing to export", async () => {
  await page.viewport(1280, 800);

  const { screen } = await show("s=");

  await expect.element(screen.getByRole("button", { name: "Als CSV exportieren" })).toBeDisabled();
});
