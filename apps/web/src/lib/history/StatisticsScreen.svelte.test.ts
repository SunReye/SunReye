import { tick } from "svelte";
import { afterEach, expect, test, vi } from "vitest";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { settled } from "../api/settled.harness.ts";
import { iso } from "../range/calendar.ts";
import { asked, plant, reset, show, TODAY, YESTERDAY, zone } from "./statistics.harness.ts";
import { appears, fakeFrames, realTimers } from "../motion/clock.harness.ts";

afterEach(() => {
  realTimers();
  reset();
});

const DAY = `range=day&at=${YESTERDAY}`;

/** The movement, a finger's pace and the address's catching up, on the test's clock. */
function fakeClock(): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "performance",
    ],
  });
}

test("the range's answer: production against the day before, and a breakdown that balances", async () => {
  const { screen } = await show(DAY);

  await expect
    .element(
      screen.getByText(/^Gestern hat die Anlage 6,0 kWh erzeugt, 50\u00A0% mehr als am Vortag\./u),
    )
    .toBeVisible();

  const breakdown = screen.getByRole("region", { name: "Aufschlüsselung" });

  await expect.element(breakdown.getByText("Produktion")).toBeVisible();
  // 2,0 kWh self-used and 4,0 kWh fed in make the 6,0 kWh; 2,0 self-covered and 11,0 bought the 13,0.
  await expect.element(breakdown.getByText("4,0 kWh").first()).toBeVisible();
  await expect.element(breakdown.getByText("13,0 kWh")).toBeVisible();
  await expect.element(breakdown.getByText("11,0 kWh")).toBeVisible();
});

/** How often `urls` asked for the route ending in `name`. */
const times = (urls: readonly string[], name: string) =>
  urls.filter((url) => (url.split("?")[0] ?? "").endsWith(`/${name}`)).length;

test("stepping to another day reads only that day: what holds for every range is read once", async () => {
  const { screen, urls } = await show(DAY);

  await expect.poll(() => times(urls, "corrections")).toBe(1);

  await screen.rerender({ params: new URLSearchParams(`range=day&at=${iso(TODAY - 2)}`) });
  await expect.poll(() => asked.some(({ from }) => from === (TODAY - 2) * 86_400_000)).toBe(true);

  for (const once of ["corrections", "capabilities", "records", "layout", "payback"])
    expect(times(urls, once), once).toBe(1);
});

test("a step the router then catches up with reads the new day once", async () => {
  const { screen, went, urls } = await show(DAY);

  // The first day is drawn: its reads are done.
  await expect.element(screen.getByText(/^Gestern hat die Anlage 6,0 kWh erzeugt/u)).toBeVisible();
  urls.length = 0;
  fakeClock();

  await screen.getByRole("button", { name: "Früher" }).first().click();
  // The address follows once the movement is over; the router hands the screen its params.
  await vi.advanceTimersByTimeAsync(1000);
  expect(went.length).toBeGreaterThan(0);
  await screen.rerender({ params: new URLSearchParams(`range=day&at=${iso(TODAY - 2)}`) });
  // A second load would start as the screen takes the params.
  await settled(() => urls.length);

  const reads = urls.filter((url) => /\/(statistics|history)\?/u.test(url));

  expect(reads.length).toBeGreaterThan(0);
  expect(reads.filter((read, i) => reads.indexOf(read) !== i)).toEqual([]);
  expect(times(urls, "timezone")).toBe(0);
});

test("the breakdown says what its rows changed against, and the peaks name their hour", async () => {
  const { screen } = await show(DAY);
  const breakdown = screen.getByRole("region", { name: "Aufschlüsselung" });

  // 6,0 kWh against the day before's 4,0 kWh.
  await expect.element(breakdown.getByText("+50 %")).toBeVisible();
  await expect.element(breakdown.getByText("Änderung zum Vortag")).toBeVisible();

  const peaks = screen.getByRole("region", { name: "Spitzenwerte" });

  await expect.element(peaks.getByText("PV-Leistung")).toBeVisible();
  await expect.element(peaks.getByText("3,0 kW")).toBeVisible();
  await expect.element(peaks.getByText("10:00–11:00 Uhr").first()).toBeVisible();
});

test("over several days a peak names its day and opens it", async () => {
  const { screen, went } = await show(`range=week&at=${YESTERDAY}`);
  const peaks = screen.getByRole("region", { name: "Spitzenwerte" });

  await peaks.getByRole("button", { name: /^PV-Leistung: .* öffnen$/u }).click();

  await expect.poll(() => went.at(-1)?.patch).toMatchObject({ range: "day", at: YESTERDAY });
});

test("a plant too young to judge its strings says it is learning, not a dash", async () => {
  plant.age = 10;

  const { screen } = await show(DAY);

  await expect.element(screen.getByRole("tab", { name: /^Anlage lernt/u })).toBeVisible();
});

test("a gap is hatched, never drawn as zero, and named in the verdict", async () => {
  const { screen } = await show(DAY);

  await expect.element(screen.getByText("11 h ohne Daten.")).toBeVisible();
  await expect
    .poll(() => screen.container.querySelectorAll(".gap.hatch").length)
    .toBeGreaterThan(0);
  await expect
    .element(
      screen.getByRole("region", { name: "Auffälligkeiten" }).getByText(/^10 h ohne Daten ab/u),
    )
    .toBeVisible();
});

test("question and tab go into the route with the range, and come back from it", async () => {
  const { screen, went } = await show(DAY);

  await screen.getByRole("tab", { name: /^Ersparnis/u }).click();
  await screen.getByRole("tab", { name: "Amortisation" }).click();

  await expect
    .poll(() => went.at(-1))
    .toEqual({
      patch: {
        range: "day",
        at: YESTERDAY,
        from: null,
        to: null,
        metric: "money",
        tab: "payback",
        cmp: null,
        sid: null,
      },
      push: false,
    });
});

test("a route that names question and tab opens them, as after a reload or back", async () => {
  const { screen } = await show(`${DAY}&metric=money&tab=payback`);

  await expect
    .element(screen.getByRole("tab", { name: "Amortisation" }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(screen.getByText("November 2033")).toBeVisible();
});

test("while the range loads, the figures dash and the space is held", async () => {
  fakeFrames();

  const open = Promise.withResolvers<void>();

  plant.gate = open.promise;

  const { screen } = await show(DAY);
  const figure = screen.getByRole("tab", { name: /^Produktion/u });

  await expect.element(figure.getByText("–")).toBeVisible();

  const card = screen.container.querySelector<HTMLElement>(".min-h-\\[348px\\]");

  expect(card?.getBoundingClientRect().height).toBeGreaterThanOrEqual(348);

  open.resolve();
  await appears(figure.getByText("6,0"));
});

test("the first week lists what fills in, and compares with nothing yet", async () => {
  plant.age = 2;

  const { screen } = await show(DAY);
  const filling = screen.getByRole("region", { name: "Der Verlauf füllt sich" });

  await expect.element(filling).toBeVisible();
  await expect.element(filling.getByText(/^Vergleich mit der Vorwoche/u)).toBeVisible();
  await expect.element(screen.getByText(/^Aufzeichnung seit/u)).toBeVisible();
  await expect
    .element(screen.getByRole("radiogroup", { name: "Vergleich mit" }))
    .not.toBeInTheDocument();
});

test("without a battery the plant has no battery tab; with one it has", async () => {
  const { screen } = await show(`${DAY}&metric=plant&tab=data`);

  await expect.element(screen.getByRole("tab", { name: "Daten" })).toBeVisible();
  await expect.element(screen.getByRole("tab", { name: "Batterie" })).not.toBeInTheDocument();

  plant.battery = true;

  const again = await show(`${DAY}&metric=plant&tab=battery`);

  await expect
    .element(again.screen.getByRole("tab", { name: "Batterie" }))
    .toHaveAttribute("aria-selected", "true");
});

test("no battery and no car add no rows to the breakdown", async () => {
  const { screen } = await show(DAY);
  const breakdown = screen.getByRole("region", { name: "Aufschlüsselung" });

  await expect.element(breakdown.getByText("Hausverbrauch")).toBeVisible();
  expect(breakdown.element().textContent).not.toMatch(/Batterie|Auto/u);
});

test("six strings each have their row", async () => {
  plant.strings = 6;

  const { screen } = await show(`${DAY}&metric=plant`);

  await expect.element(screen.getByText("String 6")).toBeVisible();
  await expect.element(screen.getByText("String 1")).toBeVisible();
});

test("ten years read in pieces and chart as years", async () => {
  const from = iso(TODAY - 3650);
  const { screen } = await show(`range=custom&from=${from}&to=${iso(TODAY)}`);

  await expect.element(screen.getByText(/^Im gewählten Zeitraum hat die Anlage/u)).toBeVisible();
  expect(asked.filter((a) => a.series === "pv.power").length).toBeGreaterThan(2);
  await expect.element(screen.getByText(String(new Date().getUTCFullYear() - 10))).toBeVisible();
  await expect.element(screen.getByText(String(new Date().getUTCFullYear() - 1))).toBeVisible();
});

test("a finger dragging the card pages the range to the neighbour it uncovers", async () => {
  const { screen, went } = await show(DAY);

  await expect.poll(() => zone.read).toBe(true);

  const verdict = screen.getByText(/^Gestern hat die Anlage/u);

  await expect.element(verdict).toBeVisible();

  const target = verdict.element();

  expect(went).toEqual([]);

  const { left, top } = target.getBoundingClientRect();

  const at = (x: number) => ({
    pointerId: 1,
    pointerType: "touch",
    clientX: left + 260 + x,
    clientY: top + 4,
    bubbles: true,
  });

  fakeClock();
  target.dispatchEvent(new PointerEvent("pointerdown", at(0)));

  for (let i = 1; i <= 8; i++) {
    vi.advanceTimersByTime(16);
    target.dispatchEvent(new PointerEvent("pointermove", at(-30 * i)));
  }

  await tick();

  // The day after is drawn beside the card's pane while the finger holds it.
  expect(document.querySelectorAll(".pane.aside").length).toBeGreaterThan(0);
  target.dispatchEvent(new PointerEvent("pointerup", at(-240)));
  await vi.advanceTimersByTimeAsync(1000);

  // Today is the default day, so the address names no date.
  expect(went.at(-1)?.patch).toMatchObject({ range: "day", at: null });
});
