import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import BandLegend from "./BandLegend.svelte";

interface Key {
  readonly label: string;
  readonly colour: string;
  readonly value: number | null;
}

/** Production above the baseline against the house load below, with yesterday's mark. */
const legendOf = (reference: boolean, ghost: Key | null) => ({
  title: "10:00–11:00 Uhr",
  status: "",
  open: false,
  rows: [
    {
      side: "up" as const,
      name: "Produktion",
      series: [
        { label: "selbst genutzt", colour: "var(--e-solar)" },
        { label: "eingespeist", colour: "var(--e-export)" },
      ],
      values: [1.5, 0],
      mark: true,
    },
    {
      side: "down" as const,
      name: "Verbrauch",
      series: [
        { label: "selbst gedeckt", colour: "var(--e-house)" },
        { label: "Netzbezug", colour: "var(--e-import)" },
      ],
      values: [0.9, 0],
      mark: false,
    },
  ],
  mark: { label: "Vortag", on: reference, value: reference ? 1.6 : null },
  ghost,
  gap: null,
  blank: false,
  bare: false,
  approx: false,
  unmeasured: false,
  glide: false,
});

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function box(e: Element): Box {
  const { left, right, top, bottom } = e.getBoundingClientRect();

  return { left, right, top, bottom };
}

const KEYS = ["selbst genutzt", "eingespeist", "Vortag", "selbst gedeckt", "Netzbezug"];

const show = (reference: boolean, ghost: Key | null) =>
  render(BandLegend, {
    legend: legendOf(reference, ghost),
    fmt: (v: number) => `${v.toFixed(1)} kWh`,
    drillLabel: "Öffnen",
    onopen: () => {},
  });

test("on a phone the legend is one list: a key per line, its value at the right edge", async () => {
  const screen = await show(true, null);

  await expect.element(screen.getByText("Vortag")).toBeVisible();

  const values = [...screen.container.querySelectorAll("dd")].map((e: Element) => box(e));
  const labels = KEYS.map((t) => box(screen.getByText(t, { exact: true }).element()));

  expect(values).toHaveLength(5);
  expect(new Set(values.map((v: Box) => Math.round(v.right))).size).toBe(1);
  expect(new Set(labels.map((l: Box) => Math.round(l.top))).size).toBe(5);
  // The values' column is clear of every label.
  expect(Math.max(...labels.map((l: Box) => l.right))).toBeLessThan(
    Math.min(...values.map((v: Box) => v.left)),
  );
});

test("the title of what is read stands above the keys in size", async () => {
  const screen = await show(true, null);

  const size = (text: string) =>
    Number(
      getComputedStyle(screen.getByText(text, { exact: true }).element()).fontSize.replace(
        "px",
        "",
      ),
    );

  await expect.element(screen.getByText("10:00–11:00 Uhr")).toBeVisible();
  expect(size("10:00–11:00 Uhr")).toBeGreaterThanOrEqual(size("Netzbezug") + 3);
});

test("a reference that fades out leaves no empty line between the keys", async () => {
  const screen = await show(false, { label: "erwartet", colour: "var(--e-solar)", value: 5 });

  const term = (text: string) => box(screen.getByRole("term").filter({ hasText: text }).element());

  await expect.element(screen.getByText("erwartet")).toBeVisible();
  expect(term("erwartet").top - term("eingespeist").bottom).toBeLessThan(
    term("eingespeist").bottom - term("eingespeist").top,
  );
});
