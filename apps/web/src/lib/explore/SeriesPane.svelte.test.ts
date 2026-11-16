import { afterEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
// The screen is laid out by the SPA's utilities.
import "../../app.css";
import { PLANT, WEATHER } from "../api/computed-devices.ts";
import { plant, reset, show } from "./explore.harness.ts";

afterEach(reset);

const desk = () => page.viewport(1280, 800);

const SIX = `s=1:pv.power,1:pv.mppt.power[2],1:pv.string.power[1],${PLANT}:pv.power,${PLANT}:load.power,5:battery.soc`;
const FOUR_LANES = `s=${PLANT}:pv.power,5:battery.soc,${WEATHER}:weather.ghi,1:extra.fan`;

test("a 7th series cannot be added, and the picker says why", async () => {
  await desk();

  const { screen, went } = await show(SIX);
  const picker = screen.getByRole("complementary", { name: "Reihen wählen" });
  const seventh = picker.getByRole("button", { name: /^Globalstrahlung/u });

  await expect
    .element(
      picker.getByText("Ein Diagramm fasst 6 Reihen. Entferne eine, um eine andere zu wählen."),
    )
    .toBeVisible();
  await expect.element(seventh).toBeDisabled();

  await seventh.click({ force: true });

  expect(went).toEqual([]);
  // A chosen series can still be taken out.
  await expect
    .element(picker.getByRole("button", { name: /^Eingang 2 · Leistung/u }))
    .toBeEnabled();
});

test("a 5th lane cannot be added, a series of a unit already drawn can", async () => {
  await desk();

  const { screen } = await show(FOUR_LANES);
  const picker = screen.getByRole("complementary", { name: "Reihen wählen" });

  await expect
    .element(
      picker.getByText(
        "Ein Diagramm fasst 4 Bahnen, eine je Einheit. Wählbar bleiben Reihen der gezeichneten Einheiten.",
      ),
    )
    .toBeVisible();
  await expect.element(picker.getByRole("button", { name: /grid\.voltage/u })).toBeDisabled();
  await expect
    .element(picker.getByRole("button", { name: /^Eingang 2 · Leistung/u }))
    .toBeEnabled();
});

test("series of one unit share a lane, another unit has its own", async () => {
  await desk();

  const { screen } = await show(`s=${PLANT}:pv.power,5:battery.soc,${PLANT}:load.power`);
  const chart = screen.getByRole("region", { name: "Reihen" });

  await expect
    .element(chart.getByRole("img", { name: "Bahn W: PV · Leistung, Haus · Leistung" }))
    .toBeVisible();
  await expect
    .element(chart.getByRole("img", { name: "Bahn %: Batterie · Ladezustand" }))
    .toBeVisible();
  expect(chart.getByRole("img").elements()).toHaveLength(2);
  // One read per series, of today's history.
  expect(plant.asked.map((a) => [a.read, a.series])).toEqual([
    ["history", "pv.power"],
    ["history", "load.power"],
    ["history", "battery.soc"],
  ]);
});

test("the legend reads the latest values, and those under the pointer", async () => {
  await desk();

  const { screen } = await show(`s=${PLANT}:pv.power`);
  const chart = screen.getByRole("region", { name: "Reihen" });
  const legend = chart.getByRole("list", { name: "Reihen über die Zeit" });
  const plot = chart.getByRole("group");

  await expect.element(legend.getByText("300 W")).toBeVisible();

  const box = plot.element().getBoundingClientRect();

  await userEvent.hover(plot, { position: { x: box.width * 0.25, y: box.height / 2 } });

  await expect.element(legend.getByText("100 W")).toBeVisible();
  expect(page.getByRole("tooltip").query()).toBeNull();
});

test("a mouse drag narrows the range to the hours it crossed", async () => {
  await desk();

  const { screen, went } = await show(`s=${PLANT}:pv.power&range=day&at=2026-11-10`);
  const plot = screen.getByRole("region", { name: "Reihen" }).getByRole("group");

  await expect.element(screen.getByRole("img", { name: /^Bahn W/u })).toBeVisible();

  const box = plot.element().getBoundingClientRect();
  const y = box.top + box.height / 2;
  // 06:30 to 11:30 of the plant's day.
  const [a, b] = [box.left + (box.width * 6.5) / 24, box.left + (box.width * 11.5) / 24];
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

  await expect
    .poll(() => went.at(-1))
    .toMatchObject({
      push: true,
      patch: { range: "custom", from: "2026-11-10T06", to: "2026-11-10T12" },
    });
});

test("a finger reads the chart and never brushes", async () => {
  await desk();

  const { screen, went } = await show(`s=${PLANT}:pv.power`);
  const chart = screen.getByRole("region", { name: "Reihen" });

  await expect.element(chart.getByRole("img", { name: /^Bahn W/u })).toBeVisible();

  const plot = chart.getByRole("group").element();
  const box = plot.getBoundingClientRect();

  const at = (share: number) => ({
    clientX: box.left + box.width * share,
    clientY: box.top + 20,
    pointerType: "touch",
    pointerId: 7,
    bubbles: true,
    isPrimary: true,
    buttons: 1,
    pressure: 0.5,
  });

  plot.dispatchEvent(new PointerEvent("pointerdown", at(0.75)));
  plot.dispatchEvent(new PointerEvent("pointermove", at(0.25)));
  plot.dispatchEvent(new PointerEvent("pointerup", { ...at(0.25), buttons: 0, pressure: 0 }));

  await expect
    .element(chart.getByRole("list", { name: "Reihen über die Zeit" }).getByText("100 W"))
    .toBeVisible();
  expect(went).toEqual([]);
});

test("past a day a measurement reads statistics and a counter its deltas, a status its history", async () => {
  await desk();

  const { screen } = await show("s=1:pv.power,1:pv.energy.total,1:inverter.status&range=week");
  const chart = screen.getByRole("region", { name: "Reihen" });

  await expect.element(chart.getByRole("img", { name: /^Bahn Status/u })).toBeVisible();
  expect(chart.getByRole("img").elements()).toHaveLength(3);
  expect(plant.asked.map((a) => [a.read, a.series, a.period])).toEqual([
    ["statistics", "pv.power", "hour"],
    ["statistics", "pv.energy.total", "hour"],
    ["history", "inverter.status", null],
  ]);
  // The mean under the pointer comes with its extremes.
  await expect.element(chart.getByText("150 – 250")).toBeVisible();
});

test("a day past retention reads hourly figures and says so once; a status has nothing that old", async () => {
  await desk();
  plant.history = () => ({ tier: "raw", points: [] });

  const { screen } = await show(
    "s=1:pv.power,1:grid.voltage,1:inverter.status&range=day&at=2026-03-03",
  );

  const chart = screen.getByRole("region", { name: "Reihen" });

  await expect
    .element(chart.getByText("Von diesem Tag sind nur Stundenwerte aufbewahrt."))
    .toBeVisible();
  expect(
    chart.getByText("Von diesem Tag sind nur Stundenwerte aufbewahrt.").elements(),
  ).toHaveLength(1);
  await expect
    .element(chart.getByText("Zustände und gehaltene Werte reichen nicht so weit zurück."))
    .toBeVisible();
});

test("a route past the caps says which series are not drawn, and why", async () => {
  await desk();

  const { screen } = await show(`${SIX},${WEATHER}:weather.ghi`);
  const chart = screen.getByRole("region", { name: "Reihen" });

  await expect
    .element(
      chart.getByText(
        "Nicht gezeichnet: Wetter · Globalstrahlung. Ein Diagramm fasst 6 Reihen in 4 Bahnen, eine je Einheit.",
      ),
    )
    .toBeVisible();
});

test("a series that cannot be read is named; the others are drawn", async () => {
  await desk();
  plant.history = (asked) => {
    if (asked.series === "battery.soc") throw new Error("refused");

    return {
      tier: "raw",
      points: [
        {
          start: new Date(asked.from).toISOString(),
          end: new Date(asked.to).toISOString(),
          mean: 7,
        },
      ],
    };
  };

  const { screen } = await show(`s=${PLANT}:pv.power,5:battery.soc`);
  const chart = screen.getByRole("region", { name: "Reihen" });

  await expect.element(chart.getByText("Nicht geladen: Batterie · Ladezustand.")).toBeVisible();
  await expect.element(chart.getByText("7 W")).toBeVisible();
});
