import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { chip, frame, show } from "./live-scene.harness.ts";
import { feed } from "./stream.harness.ts";
import { PLANT } from "../api/core.ts";

beforeEach(async () => {
  localStorage.removeItem("sunreye.dashboard.view");
  await page.viewport(1280, 900);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Edges {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const apart = (a: Edges, b: Edges): boolean =>
  a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

test("each string, the inverter, the grid and the house get a chip from the live values", async () => {
  const tick = feed();
  await show();

  tick(frame(600, -1200));

  await expect.element((await chip("Süd", "600")).getByText("W", { exact: true })).toBeVisible();
  await expect
    .element((await chip("Wechselrichter", "600")).getByText("W AC", { exact: true }))
    .toBeVisible();
  const grid = await chip("Netz", "1,2");
  await expect.element(grid.getByText("↑")).toBeVisible();
  await expect.element(grid.getByText("kW", { exact: true })).toBeVisible();
  await chip("Haus", "450");
});

/** `colour` as the browser resolves it, through a probe like the chip's dot. */
function resolved(colour: string): string {
  const probe = document.createElement("span");

  probe.style.backgroundColor = colour;
  document.body.append(probe);
  const value = getComputedStyle(probe).backgroundColor;
  probe.remove();

  return value;
}

test("an exporting grid chip's dot takes the export colour", async () => {
  const tick = feed();
  await show();

  tick(frame(600, -1200));

  const dot = (await chip("Netz", "1,2")).element().querySelector("span");

  expect(dot && getComputedStyle(dot).backgroundColor).toBe(resolved("var(--e-export)"));
});

test("chips never overlap and stay inside the canvas at phone width", async () => {
  await page.viewport(390, 700);

  const tick = feed();
  const screen = await show();

  tick(frame(600, -1200));
  await chip("Haus", "450");

  const canvas: Edges = screen
    .getByLabelText("3D-Szene des Hauses")
    .element()
    .getBoundingClientRect();

  const inside = (box: Edges): boolean =>
    box.left >= canvas.left &&
    box.right <= canvas.right &&
    box.top >= canvas.top &&
    box.bottom <= canvas.bottom;

  // Sizes are measured after the first placement, which then settles.
  await expect
    .poll(() => {
      const boxes: Edges[] = [];

      for (const element of screen.getByRole("button", { name: /: Details$/u }).elements())
        boxes.push(element.getBoundingClientRect());

      return (
        boxes.length === 4 &&
        boxes.every((box) => inside(box)) &&
        boxes.every((one, i) => boxes.slice(i + 1).every((other) => apart(one, other)))
      );
    })
    .toBe(true);
});

test("a stale flow's chip is marked stale", async () => {
  const tick = feed();
  await show();

  tick({ ...frame(600, -1200), stale: { [PLANT]: { "grid.power": Date.now() - 40_000 } } });

  await expect.element(await chip("Netz", "1,2")).toHaveAttribute("title", "veraltet");
  await expect.element(await chip("Haus", "450")).not.toHaveAttribute("title");
});

test("an estimated string carries ≈", async () => {
  const tick = feed();
  await show(["pv.string.power[11]"]);

  tick(frame(600, 0));

  await expect.element((await chip("Süd", "600")).getByText("≈")).toBeVisible();
});

test("tapping a chip opens its detail sheet", async () => {
  const tick = feed();
  const onselect = vi.fn<(id: string) => void>();
  await show([], onselect);

  tick(frame(600, -1200));

  await (await chip("Süd", "600")).click();
  await (await chip("Netz", "1,2")).click();

  expect(onselect.mock.calls).toEqual([["string-11"], ["grid"]]);
});
