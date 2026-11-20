import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { Bounds, Kind, Ranged } from "./range.ts";
import { haptics } from "../haptics.ts";
import { dragBy } from "./drag.harness.ts";
import RangeControl from "./RangeControl.svelte";

afterEach(() => {
  vi.restoreAllMocks();
});

const BOUNDS: Bounds = {
  from: "2026-11-03",
  to: "2026-11-05",
  fromHour: 0,
  toHour: 24,
  min: "2000-01-01",
  max: "2026-11-12",
  onchange: () => {},
};

/** A model at November 2026, and every kind and step the control asks of it. */
function control(kind: Kind = "month", custom: Bounds = BOUNDS) {
  const kinds: string[] = [];
  const steps: number[] = [];

  const model: Ranged = {
    range: { kind, from: 20_758, to: 20_788 },
    label: "November 2026",
    via: { id: 1, kind: "none", a: 0, b: 1, inward: true, dir: 0 },
    canPrev: true,
    canNext: false,
    custom,
    setKind: (k) => {
      kinds.push(k);
    },
    step: (d) => {
      steps.push(d);
    },
  };

  return { kinds, steps, model };
}

test("a kind is chosen from day to custom, and the arrows step", async () => {
  const c = control();
  const screen = await render(RangeControl, { model: c.model });

  await screen.getByRole("radio", { name: "Woche" }).click();
  await screen.getByRole("button", { name: "Früher" }).click();

  expect(c.kinds).toEqual(["week"]);
  expect(c.steps).toEqual([-1]);
  await expect.element(screen.getByRole("button", { name: "Später" })).toBeDisabled();
  await expect.element(screen.getByText("November 2026")).toBeVisible();
});

test("a custom range shows its bounds by date and hour", async () => {
  const changes: (string | number)[][] = [];

  const c = control("custom", {
    ...BOUNDS,
    onchange: (from, to, fromHour, toHour) => {
      changes.push([from, to, fromHour, toHour]);
    },
  });

  const screen = await render(RangeControl, { model: c.model });

  await screen.getByRole("combobox", { name: "Von Uhrzeit" }).click();
  await page.getByRole("option", { name: "8 Uhr", exact: true }).click();

  expect(changes).toEqual([["2026-11-03", "2026-11-05", 8, 24]]);
});

test("a custom bound's date is picked from a calendar, between its limits", async () => {
  const changes: [string, string, number, number][] = [];

  const c = control("custom", {
    ...BOUNDS,
    onchange: (from, to, fromHour, toHour) => {
      changes.push([from, to, fromHour, toHour]);
    },
  });

  const screen = await render(RangeControl, { model: c.model });

  await screen.getByRole("button", { name: "Bis Datum" }).click();

  // The end may not come before the start.
  await expect.element(page.getByRole("button", { name: /, 2\. November 2026/u })).toBeDisabled();

  await page.getByRole("button", { name: /, 10\. November 2026/u }).click();

  expect(changes).toEqual([["2026-11-03", "2026-11-10", 0, 24]]);
  await expect.element(page.getByRole("grid")).not.toBeInTheDocument();
});

test("a flick on the range's label steps it once, with one tick", async () => {
  const selection = vi.spyOn(haptics, "selection");
  const { steps, model } = control();

  await render(RangeControl, { model });
  await dragBy(page.getByText("November 2026").element(), 120);

  expect(steps).toEqual([-1]);
  expect(selection).toHaveBeenCalledOnce();
});
