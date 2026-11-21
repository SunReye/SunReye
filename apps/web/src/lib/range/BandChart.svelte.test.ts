import { tick } from "svelte";
import { beforeEach, expect, test } from "vitest";
import { userEvent, type Locator } from "vitest/browser";
import { render } from "vitest-browser-svelte";
// The chart is laid out and moved by the SPA's utilities and motion tokens.
import "../../app.css";
import type { Band, Via } from "./bands.ts";
import { built } from "../chart-entrance/built.harness.ts";
import BandChart from "./BandChart.svelte";
import { finish, holdEntrances } from "../motion/animations.harness.ts";

// Entrances held at their start: a test reads one before it has played out.
beforeEach(holdEntrances);

const band = (key: string, up: number): Band => ({
  key,
  label: key,
  tick: true,
  title: `Band ${key}`,
  state: "data",
  partial: false,
  up: [up],
  down: [],
  drillable: true,
});

const via = (id: number): Via => ({ id, kind: "morph", a: 0, b: 1, inward: true, dir: -1 });

function props(bands: readonly Band[], id = 1) {
  return {
    bands: [...bands],
    up: [{ label: "PV", colour: "var(--e-solar)" }],
    via: via(id),
    summary: { title: "Summe", up: [bands.reduce((a, b) => a + b.up[0]!, 0)], down: [] },
    fmt: (v: number) => `${v.toFixed(1)} kWh`,
    unit: "kWh",
    label: "Produktion",
  };
}

const bars = (root: Element) => [...root.querySelectorAll<HTMLElement>(".bar")];

test("a new range moves the bars it has to their new values instead of redrawing them", async () => {
  const screen = await render(BandChart, props([band("b0", 2), band("b1", 4), band("b2", 6)]));

  await expect.poll(() => bars(screen.container)).toHaveLength(3);

  const before = bars(screen.container);
  const heights = before.map((b: Element) => b.querySelector<HTMLElement>(".seg")!.style.transform);

  await screen.rerender(props([band("b0", 6), band("b1", 4), band("b2", 2)], 2));

  await expect
    .poll(() => before[0]!.querySelector<HTMLElement>(".seg")!.style.transform)
    .not.toBe(heights[0]);
  expect(bars(screen.container)).toEqual(before);
});

/** Each bar's entrance, if it builds. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM's own type.
const builds = (root: Element) => bars(root).map((bar) => built().find((b) => b.target === bar));

test("the chart builds up as it first shows: bars grow from the baseline, one after another", async () => {
  const screen = await render(BandChart, props([band("b0", 2), band("b1", 4), band("b2", 6)]));

  await expect.poll(() => builds(screen.container).filter(Boolean)).toHaveLength(3);

  const grows = builds(screen.container);

  for (const g of grows) expect(g!.from).toMatchObject({ scale: "1 0", opacity: "0" });
  expect(grows[1]!.delay).toBeGreaterThan(grows[0]!.delay);
  expect(grows[2]!.delay).toBeGreaterThan(grows[1]!.delay);
});

test("a chart already shown does not build again: a new range's bars tween", async () => {
  const screen = await render(BandChart, props([band("b0", 2), band("b1", 4)]));

  await expect.poll(() => builds(screen.container).filter(Boolean)).toHaveLength(2);

  await finish();

  await expect.poll(() => builds(screen.container).filter(Boolean)).toHaveLength(0);

  await screen.rerender(props([band("b0", 6), band("b1", 4), band("b2", 2)], 2));
  await tick();

  expect(bars(screen.container)).toHaveLength(3);
  expect(builds(screen.container).filter(Boolean)).toEqual([]);
});

test("a change of range eases in and out", async () => {
  const screen = await render(BandChart, props([band("b0", 2)]));

  await expect.poll(() => bars(screen.container)).toHaveLength(1);

  const style = getComputedStyle(bars(screen.container)[0]!);

  expect(style.transitionProperty).toContain("transform");
  expect(style.transitionTimingFunction).toContain("cubic-bezier(0.65, 0, 0.35, 1)");
});

test("the legend shows the band under the pointer, with no floating tooltip", async () => {
  const screen = await render(BandChart, props([band("b0", 2), band("b1", 4)]));
  const plot = screen.getByRole("group");

  await expect.element(screen.getByText("Summe")).toBeVisible();

  const box = plot.element().getBoundingClientRect();

  await userEvent.hover(plot, { position: { x: box.width * 0.75, y: box.height / 2 } });

  await expect.element(screen.getByText("Band b1")).toBeVisible();
  await expect.element(screen.getByText("4.0 kWh")).toBeVisible();
  expect(document.querySelector("[role=tooltip]")).toBeNull();
});

test("keys select a span of bands, which narrows the range", async () => {
  const brushed: [number, number][] = [];

  const screen = await render(
    BandChart,
    Object.assign(props([band("b0", 2), band("b1", 4), band("b2", 6)]), {
      onbrush: (a: number, b: number) => brushed.push([a, b]),
    }),
  );

  screen.getByRole("group").element().focus();
  await userEvent.keyboard(
    "{ArrowLeft}{ArrowLeft}{ArrowLeft}{Shift>}{ArrowRight}{ArrowRight}{/Shift}{Enter}",
  );

  expect(brushed).toEqual([[0, 2]]);
});

test("on touch, a tap opens its band", async () => {
  const drilled: number[] = [];

  const screen = await render(
    BandChart,
    Object.assign(props([band("b0", 2), band("b1", 4)]), {
      ondrill: (i: number) => drilled.push(i),
    }),
  );

  const plot = screen.getByRole("group").element();
  const box = plot.getBoundingClientRect();
  const at = { clientX: box.left + box.width * 0.75, clientY: box.top + box.height / 2 };
  const touch = { ...at, pointerType: "touch", pointerId: 7, bubbles: true, isPrimary: true };

  plot.dispatchEvent(new PointerEvent("pointerdown", { ...touch, buttons: 1 }));
  plot.dispatchEvent(new PointerEvent("pointerup", touch));

  expect(drilled).toEqual([1]);
});

/** Two days measured against their forecast, then one still to come. */
function forecastProps() {
  const bands: Band[] = [
    Object.assign(band("b0", 2), { mark: 3 }),
    Object.assign(band("b1", 4), { mark: 3 }),
    Object.assign(band("b2", 0), { state: "future" as const, up: [], ghost: 5 }),
  ];

  return Object.assign(props(bands), {
    markLabel: "Prognose",
    ghostLabel: "erwartet",
    summary: { title: "Summe", up: [6], down: [], mark: 6, ghost: 5 },
  });
}

/** Points at band `i` of `n`. */
async function hoverBand(plot: Readonly<Locator>, i: number, n: number) {
  const box = plot.element().getBoundingClientRect();

  await userEvent.hover(plot, { position: { x: (box.width * (i + 0.5)) / n, y: box.height / 2 } });
}

test("a band still to come reads its forecast and no measurement", async () => {
  const screen = await render(BandChart, forecastProps());

  await hoverBand(screen.getByRole("group"), 2, 3);

  await expect.element(screen.getByText(/Band b2/u)).toBeVisible();

  const measured = screen.getByRole("term").filter({ hasText: "PV" }).element().nextElementSibling;

  // What shows: the figure under the dash keeps its width, hidden.
  await expect
    .poll(() => (measured instanceof HTMLElement ? measured.innerText.trim() : null))
    .toBe("–");
  await expect.element(screen.getByText("5.0 kWh")).toBeVisible();
});

test("the range's sum names what is still expected beside what was measured", async () => {
  const screen = await render(BandChart, forecastProps());

  const value = (term: string) =>
    screen.getByRole("term").filter({ hasText: term }).element().nextElementSibling?.textContent;

  await expect.poll(() => value("erwartet")).toBe("5.0 kWh");
  await expect.poll(() => value("Prognose")).toBe("6.0 kWh");
});

test("hatched bands are named in the legend, only while there are some", async () => {
  const gap = Object.assign(band("b9", 0), { state: "gap" as const, up: [] });
  const screen = await render(BandChart, props([gap, band("b1", 4)]));

  await expect.element(screen.getByRole("term").filter({ hasText: "keine Daten" })).toBeVisible();

  await screen.rerender(props([band("b0", 2), band("b1", 4)], 2));

  await expect
    .element(screen.getByRole("term").filter({ hasText: "keine Daten" }))
    .not.toBeInTheDocument();
});

test("the axis names its unit above the top gridline's figure, not under it", async () => {
  const screen = await render(BandChart, props([band("b0", 2), band("b1", 4)]));

  const unit = screen.getByText("kWh", { exact: true });
  const top = screen.getByText("5", { exact: true });

  await expect.element(top).toBeVisible();
  expect(unit.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
    top.element().getBoundingClientRect().top,
  );
});

test("a series that runs both ways keeps a legend row for each side", async () => {
  const signed = { label: "battery.power", colour: "var(--e-battery)" };

  const screen = await render(BandChart, {
    ...props([{ ...band("b0", 2), down: [3] }]),
    up: [signed],
    down: [signed],
    summary: { title: "Summe", up: [2], down: [3] },
  });

  await expect.element(screen.getByText("2.0 kWh")).toBeVisible();
  await expect.element(screen.getByText("3.0 kWh")).toBeVisible();
});

test("the running band's dot stands clear above the axis labels beside it", async () => {
  const hours = Array.from({ length: 24 }, (_, h) =>
    Object.assign(band(`b${h}`, 1), { label: String(h), tick: h % 4 === 0 }),
  );

  hours[15] = Object.assign(hours[15]!, { state: "live" as const });

  const screen = await render(BandChart, props(hours));
  const next = screen.getByText("16", { exact: true });

  await expect.element(next).toBeVisible();

  const dot = screen.container.querySelector("[data-now]")!.getBoundingClientRect();

  expect(dot.height).toBeGreaterThan(0);
  expect(dot.bottom).toBeLessThanOrEqual(next.element().getBoundingClientRect().top);
});
