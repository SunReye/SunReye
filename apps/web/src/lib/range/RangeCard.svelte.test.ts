import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { haptics } from "../haptics.ts";
import Harness from "./card.harness.svelte";
import { dragBy } from "./drag.harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The track of the card's pane, which holds its chart, not of the stepper's label. */
const track = () => document.querySelector("[data-scrub]")?.closest<HTMLElement>(".track");

/** The pane track's offset in px; 0 at rest. */
function offset(): number {
  const transform = track()?.style.transform ?? "";

  return transform === "" ? 0 : Number(/translateX\(([-\d.]+)px\)/u.exec(transform)?.[1]);
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the DOM, used in place.
const drag = (el: Element, dx: number, release = true) =>
  dragBy(el, dx, { hold: !release, share: 0.75 });

test("a finger drags the card's pane 1:1, the neighbour beside it drawn loading", async () => {
  const screen = await render(Harness, { steps: [] });

  await expect.element(screen.getByText("Tag -2")).toBeVisible();
  await drag(screen.getByRole("heading", { name: "Heute" }).element(), -120, false);

  // 1:1 from where the drag was taken up, past the first move's slop.
  expect(offset()).toBeCloseTo(-105, 0);
  await expect.element(screen.getByText("Nachbar -1")).toBeInTheDocument();
});

test("let go past the threshold, the pane slides to the next range with one selection tick", async () => {
  const selection = vi.spyOn(haptics, "selection");
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(screen.getByRole("heading", { name: "Heute" }).element(), -220);

  await expect.poll(() => steps).toEqual([1]);
  expect(selection).toHaveBeenCalledOnce();
  await expect.poll(offset).toBe(0);
  await expect.element(screen.getByText("Tag -1")).toBeVisible();
  expect(screen.getByText("Tag -2").query()).toBeNull();
});

test("a drag across the chart reads the chart", async () => {
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await expect.element(screen.getByText("Summe")).toBeVisible();
  await drag(document.querySelector("[data-scrub]")!, -220);

  expect(offset()).toBe(0);
  expect(steps).toEqual([]);
});

test("a swipe on the card's stepper is the card's: one step, one tick", async () => {
  const selection = vi.spyOn(haptics, "selection");
  const steps: (-1 | 1)[] = [];
  const screen = await render(Harness, { steps });

  await drag(screen.getByText("Zeitraum -2").element(), -220);

  await expect.poll(() => steps).toEqual([1]);
  await expect.element(screen.getByText("Tag -1")).toBeVisible();
  expect(selection).toHaveBeenCalledOnce();
});

test("an arrow's step keeps the pane in place", async () => {
  const screen = await render(Harness, { steps: [] });

  await screen.getByRole("button", { name: "Später" }).click();

  await expect.element(screen.getByText("Tag -1")).toBeVisible();
  expect(track()?.querySelectorAll(".pane")).toHaveLength(1);
  expect(offset()).toBe(0);
});
