import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  gridOnTheSouthFace,
  house,
  inspector,
  MODULE,
  press,
  pv,
  SOUTH,
  testCore,
  undesk,
  type Pointer,
} from "./builder.harness.ts";

beforeEach(desk);

afterEach(undesk);

const cell = (row: number, column: number) =>
  inspector().getByRole("button", { name: `Reihe ${row}, Spalte ${column}` });

/** A cell's centre in page pixels. */
function centre(row: number, column: number): [number, number] {
  const box = cell(row, column).element().getBoundingClientRect();

  return [box.left + box.width / 2, box.top + box.height / 2];
}

const placed = () => inspector().getByRole("button", { pressed: true }).all();

const undo = () => inspector().getByRole("button", { name: "Rückgängig" }).click();

test("fill face places a module in every cell the face holds, as one undo step", async () => {
  await gridOnTheSouthFace(testCore());

  await inspector().getByRole("button", { name: "Fläche füllen" }).click();

  // The crate's grid on the 10 m × 4.88 m south face: 8 × 2 portrait modules.
  await expect.poll(placed).toHaveLength(16);

  await undo();

  await expect.poll(placed).toHaveLength(0);
});

test.each<Pointer>(["mouse", "touch"])(
  "a %s drag places modules along its path, and one starting on a module erases",
  async (pointer) => {
    await gridOnTheSouthFace(testCore());

    await press(pointer, [centre(1, 1), centre(1, 2), centre(1, 3), centre(2, 3)]);

    await expect.poll(placed).toHaveLength(4);

    await press(pointer, [centre(1, 3), centre(1, 2)]);

    await expect.poll(placed).toHaveLength(2);
    await expect.element(cell(1, 1)).toHaveAttribute("aria-pressed", "true");
    await expect.element(cell(2, 3)).toHaveAttribute("aria-pressed", "true");

    // Each drag is one undo step.
    await undo();
    await expect.poll(placed).toHaveLength(4);
    await undo();
    await expect.poll(placed).toHaveLength(0);
  },
);

test("a string of another module type is refused in place, and nothing is painted", async () => {
  const other = { ...MODULE, id: 8, name: "Other 300" };

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: {
      ...house(),
      strings: [
        {
          name: "Ost",
          moduleType: 8,
          device: 1,
          input: 1,
          modules: 0,
          optimized: 0,
          tilt: 0,
          azimuth: 0,
          loss: 2,
        },
      ],
    },
    moduleTypes: [MODULE, other],
    devices: DEVICES,
  });

  await drill("Module", SOUTH, "Modulraster auf diese Fläche legen");
  await inspector().getByRole("radio", { name: "Ost malen" }).click();
  await cell(1, 1).click();

  await expect
    .element(inspector().getByRole("alert"))
    .toHaveTextContent("Ost hat einen anderen Modultyp als dieses Raster.");
  await expect.poll(placed).toHaveLength(0);

  // Laying the grid is the only step to undo.
  await undo();
  await expect
    .element(inspector().getByRole("button", { name: "Modulraster auf diese Fläche legen" }))
    .toBeVisible();
});
