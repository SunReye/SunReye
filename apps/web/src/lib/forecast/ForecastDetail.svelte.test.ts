/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { built } from "../chart-entrance/built.harness.ts";
import { INPUTS, show, STRINGS } from "./forecast-detail.harness.ts";
import { holdEntrances } from "../motion/animations.harness.ts";
import { motion } from "../motion/tier.svelte.ts";

// Still: a figure stands at its value at once, where it would roll up to it frame by frame.
beforeEach(() => {
  motion.lowPower = true;
});

afterEach(() => {
  motion.lowPower = false;
});

/** Each line's name and expected energy, as its bar's row reads. */
const lines = () =>
  [...document.querySelectorAll<HTMLElement>("[data-line]")].map((line) =>
    line.innerText.replaceAll(/\s+/gu, " ").trim(),
  );

/** The figure under `term`, in the group named `group`. */
function figure(group: string, term: string): string | undefined {
  const all = document.querySelectorAll<HTMLElement>(`[data-${group}] dt`);
  const dd = [...all].find((dt) => dt.innerText.trim() === term)?.nextElementSibling;

  return dd instanceof HTMLElement ? dd.innerText.replaceAll(/\s+/gu, " ").trim() : undefined;
}

/** The facts row's cells. */
const row = () => [...document.querySelectorAll<HTMLElement>("[data-facts] dl > div")];

const headline = () =>
  document.querySelector<HTMLElement>("[data-energy]")?.innerText.replaceAll(/\s+/gu, " ").trim();

test("today heads with what is still to come of the day's total", async () => {
  const { screen } = await show();

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();
  await expect.poll(headline).toBe("3,0 kWh noch heute");
  expect(figure("headline", "Gesamt")).toBe("8,0 kWh");
  // Measured against the forecast, one chart.
  await expect.element(screen.getByRole("img", { name: "Leistung" })).toBeVisible();
  await expect.element(screen.getByText("Prognose", { exact: true })).toBeVisible();
  // Its row states its range, which the head does not.
  await expect.element(screen.getByText(/^0 – 2,0\skW$/u)).toBeVisible();
});

test("each string's expected energy is a small bar, the sky stands by three hours", async () => {
  const { screen } = await show();

  await expect.element(screen.getByText("Erwartet je String")).toBeVisible();
  expect(lines()).toEqual(["Süd 4,0 kWh", "Nord 2,0 kWh", "Ost 2,0 kWh"]);
  // Each against the widest bar of the three days: south's 10.5 kWh tomorrow.
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-line] [data-bar]")].map((bar) =>
      Math.round(Number(bar.style.width.replace("%", ""))),
    ),
  ).toEqual([38, 19, 19]);
  // Eight marks over the day, each with the sky's icon.
  expect(document.querySelectorAll("[data-hours] svg.lucide")).toHaveLength(8);
  await expect.poll(() => figure("facts", "Sonnenschein")).toBe("3,0 h");
});

test("the best window is the day's three hours that make the most", async () => {
  await show();

  await expect.poll(() => figure("facts", "Beste 3 h")).toBe("10–13 Uhr");
});

test("today alone says how the forecast holds: so far, and over the whole days before", async () => {
  const { screen } = await show();

  // 3 kWh measured of 5 kWh forecast by 12:30; 15 and 10 kWh against 12 kWh on the days before.
  await expect.poll(() => figure("facts", "Heute bisher")).toBe("−40 %");
  expect(figure("facts", "Ø Abweichung")).toBe("21 %");

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect.poll(() => figure("facts", "Heute bisher")).toBeUndefined();
  expect(figure("facts", "Ø Abweichung")).toBeUndefined();
});

test("today's facts are one row on a narrow phone: the sky's sunshine, the best window, the forecast's hold", async () => {
  await show();
  await page.viewport(360, 800);

  await expect
    .poll(() => row().map((cell) => cell.querySelector("dt")?.textContent.trim()))
    .toEqual(["Sonnenschein", "Beste 3 h", "Heute bisher", "Ø Abweichung"]);
  expect(document.querySelectorAll("[data-facts] dl")).toHaveLength(1);
  // Polled: the figures follow the read.
  await expect.poll(() => figure("facts", "Sonnenschein")).toBe("3,0 h");
  // One line inside the screen, nothing cut short.
  expect(new Set(row().map((cell) => Math.round(cell.getBoundingClientRect().top))).size).toBe(1);
  expect(Math.max(...row().map((cell) => cell.getBoundingClientRect().right))).toBeLessThanOrEqual(
    360,
  );
  expect(
    row().filter((cell) =>
      [...cell.querySelectorAll<HTMLElement>("dt, dd")].some((t) => t.scrollWidth > t.clientWidth),
    ),
  ).toEqual([]);
});

test("as the hour goes on less is still to come, and so far stays as of its read", async () => {
  const { asked, later } = await show();

  await expect.poll(() => figure("facts", "Heute bisher")).toBe("−40 %");

  const reads = asked.length;

  await later(15);

  // Half an hour of 2 kW is gone from what is to come.
  await expect.poll(headline).toBe("2,5 kWh noch heute");
  // The measurement is the read's, so its forecast is too.
  expect(figure("facts", "Heute bisher")).toBe("−40 %");
  expect(asked).toHaveLength(reads);
});

test("a later day heads with its expected total, its peak and its change against today", async () => {
  const { screen } = await show();

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect.poll(headline).toBe("21,0 kWh erwartet");
  expect(figure("headline", "Spitze · 12:00")).toBe("5,0 kW");
  expect(figure("headline", "zu heute")).toBe("+163 %");
  // The forecast alone.
  await expect.element(screen.getByRole("img", { name: "Prognose" })).toBeVisible();
  expect(lines()).toEqual(["Süd 10,5 kWh", "Nord 5,3 kWh", "Ost 5,3 kWh"]);
  await expect.poll(() => figure("facts", "Sonnenschein")).toBe("1,0 h");
  expect(figure("facts", "Beste 3 h")).toBe("11–14 Uhr");
  // The head states the peak; the chart's row does not again.
  expect(screen.getByText(/^0 – /u).query()).toBeNull();

  await screen.getByRole("tab", { name: "Montag" }).click();

  await expect.poll(headline).toBe("2,0 kWh erwartet");
  expect(figure("headline", "zu heute")).toBe("−75 %");
});

test("the pointer over the chart reads the quarter hour under it", async () => {
  const { screen } = await show();

  await expect.element(screen.getByRole("img", { name: "Leistung" })).toBeVisible();

  const slots = document.querySelector<HTMLElement>("[data-hours]")!;
  const box = slots.getBoundingClientRect();
  const read = () => slots.querySelector<HTMLElement>("[data-figure]")?.innerText;

  expect(read()).toBeUndefined();

  // 11:15, the 46th quarter of 96.
  await userEvent.hover(slots, { position: { x: (box.width * 45.5) / 96, y: box.height / 2 } });

  await expect.poll(() => read()?.replaceAll(/\s+/gu, " ").trim()).toBe("1,2 kW 11:15");

  // The forecast reads on a line of its own, under the measured power's.
  const header = [...slots.querySelectorAll<HTMLElement>("[data-row-line]")];

  expect(header.map((line) => line.innerText.replaceAll(/\s+/gu, " ").trim())).toEqual([
    "Leistung 1,2 kW 11:15",
    "Prognose 2,0 kW",
  ]);
  expect(header[1]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
    header[0]!.getBoundingClientRect().bottom,
  );
  // One rule, at the quarter hour's middle.
  expect(
    Number(document.querySelector<HTMLElement>("[data-read]")?.style.left.replace("%", "")),
  ).toBeCloseTo((45.5 / 96) * 100, 2);

  await userEvent.unhover(slots);
  await expect.poll(read).toBeUndefined();
});

test("each tab links to the Forecast screen on its day", async () => {
  const { screen } = await show();

  await expect
    .element(screen.getByRole("link", { name: "Zur Solarprognose · Heute" }))
    .toHaveAttribute("href", "#/forecast?range=day&at=2026-11-14");

  await screen.getByRole("tab", { name: "Sonntag" }).click();

  await expect
    .element(screen.getByRole("link", { name: "Zur Solarprognose · Sonntag" }))
    .toHaveAttribute("href", "#/forecast?range=day&at=2026-11-15");
});

test("it reads each series once over all three days, the 33 days judged in pieces under the cap", async () => {
  const { screen, asked } = await show();

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();

  expect(asked.toSorted()).toEqual(
    [
      // 33 days of quarter hours, 3,168 targets: three reads of at most 1,500.
      ...Array.from({ length: 3 }, () => "forecasts 1 pv.power"),
      ...Object.keys(STRINGS)
        .filter((series) => series !== "pv.power")
        .map((series) => `forecasts 1 ${series}`),
      ...["code", "ghi", "sunshine"].flatMap((role) => [
        `forecasts 4294967295 weather.${role}`,
        `history 4294967295 weather.${role}`,
      ]),
      "statistics 1 pv.power day",
    ].toSorted(),
  );
});

test("without a forecast of its strings a plant shows each MPPT input's", async () => {
  const { screen, asked } = await show(INPUTS);

  await expect.element(screen.getByText("Erwartet je MPPT-Eingang")).toBeVisible();
  expect(lines()).toEqual(["Eingang 1 6,0 kWh", "Eingang 2 2,0 kWh"]);
  expect(asked).toContain("forecasts 1 pv.mppt.power[2]");
});

test("a plant without a forecast says so", async () => {
  const { screen } = await show({});

  await expect.element(screen.getByText("Keine Prognose")).toBeVisible();
  expect(screen.getByRole("tab", { name: "Heute" }).query()).toBeNull();
});

/** How the day chart named `name` builds as it first shows. */
async function builds(name: string): Promise<string[]> {
  await expect.element(page.getByRole("img", { name })).toBeVisible();

  const chart = page.getByRole("img", { name }).element();
  const own = () => built().filter((b) => chart.contains(b.target));

  await expect.poll(() => own().length).toBeGreaterThan(0);

  return own().map((b) => b.build);
}

test("today's day chart, which grows live, only fades in; a later day's draws in", async () => {
  motion.lowPower = false;

  const release = holdEntrances();

  try {
    const { screen } = await show();

    expect(new Set(await builds("Leistung"))).toEqual(new Set(["fade"]));

    await screen.getByRole("tab", { name: "Sonntag" }).click();

    expect(await builds("Prognose")).toContain("draw");
  } finally {
    release();
  }
});
