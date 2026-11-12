import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { chip, frame, show, ticking } from "./live-scene.harness.ts";
import { PLANT } from "./labels.ts";

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
  const { core, tick } = ticking();
  await show(core);

  await tick(frame(600, -1200));

  await chip("Süd", "0,6");
  await chip("Wechselrichter", "0,6");
  await expect.element((await chip("Netz", "1,2")).getByText("↑")).toBeVisible();
  await chip("Haus", "0,5");
});

test("chips never overlap and stay inside the canvas at phone width", async () => {
  await page.viewport(390, 700);

  const { core, tick } = ticking();
  const screen = await show(core);

  await tick(frame(600, -1200));
  await chip("Haus", "0,5");

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
  const { core, tick } = ticking();
  await show(core);

  await tick({ ...frame(600, -1200), stale: { [PLANT]: { "grid.power": 40 } } });

  await expect.element(await chip("Netz", "1,2")).toHaveAttribute("title", "veraltet");
  await expect.element(await chip("Haus", "0,5")).not.toHaveAttribute("title");
});

test("an estimated string carries ≈", async () => {
  const { core, tick } = ticking();
  await show(core, ["pv.string.power[11]"]);

  await tick(frame(600, 0));

  await expect.element((await chip("Süd", "0,6")).getByText("≈")).toBeVisible();
});

test("tapping a chip opens its detail sheet", async () => {
  const { core, tick } = ticking();
  const onselect = vi.fn<(id: string) => void>();
  await show(core, [], onselect);

  await tick(frame(600, -1200));

  await (await chip("Süd", "0,6")).click();
  await (await chip("Netz", "1,2")).click();

  expect(onselect.mock.calls).toEqual([["string-11"], ["grid"]]);
});
