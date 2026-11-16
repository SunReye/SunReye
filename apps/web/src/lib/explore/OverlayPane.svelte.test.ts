import { afterEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { PLANT } from "../api/computed-devices.ts";
import { plant, reset, show } from "./explore.harness.ts";

afterEach(reset);

const desk = () => page.viewport(1280, 800);

const iso = (t: number) => new Date(t).toISOString();

/** Each day reads ten times its day of the month, and one more in its second half. */
interface Span {
  readonly from: number;
  readonly to: number;
}

function byDay({ from, to }: Span) {
  const mid = (from + to) / 2;
  const base = new Date(from).getUTCDate() * 10;

  return {
    tier: "raw" as const,
    points: [
      { start: iso(from), end: iso(mid), mean: base },
      { start: iso(mid), end: iso(to), mean: base + 1 },
    ],
  };
}

const TENTH = `mode=overlay&s=${PLANT}:pv.power&range=day&at=2026-11-10`;

test("one series is read once per period, and the legend names each with its value under the pointer", async () => {
  await desk();
  plant.history = byDay;

  const { screen } = await show(`${TENTH}&vs=2026-11-03,2026-11-09`);
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect
    .element(
      chart.getByRole("img", {
        name: "Bahn W: Di., 10. November, Mo., 9. November, Di., 3. November",
      }),
    )
    .toBeVisible();
  expect(plant.asked.map((a) => [a.read, a.series, iso(a.from), iso(a.to)])).toEqual([
    ["history", "pv.power", "2026-11-10T00:00:00.000Z", "2026-11-11T00:00:00.000Z"],
    ["history", "pv.power", "2026-11-09T00:00:00.000Z", "2026-11-10T00:00:00.000Z"],
    ["history", "pv.power", "2026-11-03T00:00:00.000Z", "2026-11-04T00:00:00.000Z"],
  ]);

  const row = (i: number) =>
    chart
      .getByRole("list", { name: "PV · Leistung über die Zeiträume" })
      .getByRole("listitem")
      .nth(i);

  // At rest, each period at the instant the range was last read.
  await expect.element(row(0)).toHaveTextContent("Di., 10. November 101 W");
  await expect.element(row(1)).toHaveTextContent("Mo., 9. November 91 W");
  await expect.element(row(2)).toHaveTextContent("Di., 3. November 31 W");

  const plot = chart.getByRole("group");
  const box = plot.element().getBoundingClientRect();

  await userEvent.hover(plot, { position: { x: box.width * 0.25, y: box.height / 2 } });

  await expect.element(row(0)).toHaveTextContent("Di., 10. November 100 W");
  await expect.element(row(1)).toHaveTextContent("Mo., 9. November 90 W");
  await expect.element(row(2)).toHaveTextContent("Di., 3. November 30 W");
  await expect.element(chart.getByText("PV · Leistung · 06:00")).toBeVisible();
});

test("a quick pick adds its period as a step back can undo, and its chip removes it", async () => {
  await desk();

  const { screen, went } = await show(`${TENTH}&vs=2026-11-03`);
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await chart.getByRole("button", { name: "Tag davor" }).click();

  await expect
    .poll(() => went.at(-1))
    .toMatchObject({ push: true, patch: { vs: "2026-11-03,2026-11-09" } });
  // A period drawn is no longer offered.
  await expect.element(chart.getByRole("button", { name: "Tag davor" })).not.toBeInTheDocument();

  await chart.getByRole("button", { name: "Di., 3. November entfernen" }).click();

  await expect.poll(() => went.at(-1)).toMatchObject({ push: true, patch: { vs: "2026-11-09" } });
});

test("a chart of five periods offers no more, and says why", async () => {
  await desk();

  const { screen } = await show(`${TENTH}&vs=2026-11-09,2026-11-08,2026-11-07,2026-11-06`);
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect
    .element(
      chart.getByText(
        "Ein Diagramm überlagert 5 Zeiträume. Entferne einen, um einen anderen zu wählen.",
      ),
    )
    .toBeVisible();
  expect(chart.getByRole("button", { name: "Woche davor" }).query()).toBeNull();
});

test("the range control offers day and week alone", async () => {
  await desk();

  const { screen } = await show(TENTH);
  const kinds = screen.getByRole("group", { name: "Zeitraum" });

  await expect.element(kinds.getByRole("radio", { name: "Tag" })).toBeChecked();
  await expect.element(kinds.getByRole("radio", { name: "Woche" })).toBeVisible();
  expect(kinds.getByRole("radio").elements()).toHaveLength(2);
});

test("switching in from a longer range opens its last day", async () => {
  await desk();

  const { screen, went } = await show(`s=${PLANT}:pv.power&range=month&at=2026-09-10`);

  await screen.getByRole("radio", { name: "Überlagern" }).click();

  await expect
    .poll(() => went.at(-1))
    .toMatchObject({ push: true, patch: { mode: "overlay", range: "day", at: "2026-09-30" } });
});

test("an address of a longer range draws its last day", async () => {
  await desk();

  const { screen } = await show(`mode=overlay&s=${PLANT}:pv.power&range=month&at=2026-09-10`);
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect
    .element(chart.getByRole("img", { name: /^Bahn W: Mi\., 30\. September/u }))
    .toBeVisible();
  expect(plant.asked.map((a) => iso(a.from))).toEqual(["2026-09-30T00:00:00.000Z"]);
});

test("of several series the first is overlaid, and the chart says so", async () => {
  await desk();

  const { screen } = await show(
    `mode=overlay&s=5:battery.soc,${PLANT}:pv.power&range=day&at=2026-11-10`,
  );

  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect.element(chart.getByRole("img", { name: /^Bahn %/u })).toBeVisible();
  await expect
    .element(chart.getByText("Überlagert wird Batterie · Ladezustand, die erste gewählte Reihe."))
    .toBeVisible();
  expect(plant.asked.map((a) => a.series)).toEqual(["battery.soc"]);
});

test("a week overlays hourly statistics, Monday on Monday", async () => {
  await desk();

  const { screen } = await show(`mode=overlay&s=1:pv.power&range=week&at=2026-11-10&vs=2026-11-05`);

  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect.element(chart.getByRole("img", { name: /^Bahn W: KW 46/u })).toBeVisible();
  expect(plant.asked.map((a) => [a.read, a.period, iso(a.from)])).toEqual([
    ["statistics", "hour", "2026-11-09T00:00:00.000Z"],
    ["statistics", "hour", "2026-11-02T00:00:00.000Z"],
  ]);
});

test("a mouse drag reads the chart and never narrows it", async () => {
  await desk();

  const { screen, went } = await show(TENTH);
  const chart = screen.getByRole("region", { name: "Überlagern" });
  const plot = chart.getByRole("group");

  await expect.element(chart.getByRole("img", { name: /^Bahn W/u })).toBeVisible();

  const box = plot.element().getBoundingClientRect();
  const y = box.top + box.height / 2;
  const [a, b] = [box.left + box.width * 0.25, box.left + box.width * 0.75];
  const mouse = { button: "left", pointerType: "mouse", clickCount: 1 } as const;

  await cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a, y });
  await cdp().send("Input.dispatchMouseEvent", { type: "mousePressed", x: a, y, ...mouse });
  await cdp().send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: b,
    y,
    ...mouse,
    buttons: 1,
  });
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b, y, ...mouse });

  await expect.element(chart.getByText("PV · Leistung · 18:00")).toBeVisible();
  expect(went).toEqual([]);
});

test("a period that cannot be read is named; the others are drawn", async () => {
  await desk();
  plant.history = (asked: Span) => {
    if (new Date(asked.from).getUTCDate() === 9) throw new Error("refused");

    return byDay(asked);
  };

  const { screen } = await show(`${TENTH}&vs=2026-11-09`);
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect.element(chart.getByText("Nicht geladen: Mo., 9. November.")).toBeVisible();

  const rows = chart
    .getByRole("list", { name: "PV · Leistung über die Zeiträume" })
    .getByRole("listitem");

  // The period that failed reads as a gap.
  await expect.element(rows.nth(0)).toHaveTextContent("Di., 10. November 101,0 W");
  await expect.element(rows.nth(1)).toHaveTextContent("Mo., 9. November –");
});

test("a series with nothing stored says so", async () => {
  await desk();

  const { screen } = await show("mode=overlay&s=1:battery.power&range=day&at=2026-11-10");
  const chart = screen.getByRole("region", { name: "Überlagern" });

  await expect
    .element(chart.getByText("Für Batterie · Leistung ist nichts aufgezeichnet."))
    .toBeVisible();
  expect(plant.asked).toEqual([]);
});
