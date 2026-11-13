import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { addGrid, paint, type Draft } from "./modules.ts";
import {
  desk,
  DEVICES,
  drill,
  enter,
  gridOnTheSouthFace,
  house,
  inspector,
  MODULE,
  press,
  pv,
  SOUTH,
  starts,
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

  await drill("Module", SOUTH, MODULE.name);
  await inspector().getByRole("radio", { name: "Ost malen" }).click();
  await cell(1, 1).click();

  await expect
    .element(inspector().getByRole("alert"))
    .toHaveTextContent("Ost hat einen anderen Modultyp als dieses Raster.");
  await expect.poll(placed).toHaveLength(0);

  // Laying the grid is the only step to undo.
  await undo();
  await expect
    .element(inspector().getByRole("button", { name: starts(MODULE.name) }))
    .toBeVisible();
});

test("a module the setback no longer holds shows where it lies, refused as on save", async () => {
  await gridOnTheSouthFace(testCore());
  await inspector().getByRole("button", { name: "Fläche füllen" }).click();

  await enter("Randabstand (m)", "0,5");

  // 0.5 + 8 × 1.154 m reaches past 10 − 0.5 m: the eighth column falls out.
  await expect
    .element(
      inspector()
        .getByRole("group", { name: "Zellen der Fläche" })
        .getByRole("img", { name: /Spalte 8 ragt über den Randabstand/u }),
    )
    .toBeVisible();
});

/** The template house with both roof faces filled and painted into one string. */
function overVoltage(): Draft {
  const { scene } = house();
  const size = { [MODULE.id]: { width: MODULE.width, height: MODULE.height } };
  let gridded = addGrid(addGrid(scene, 0, 0, MODULE.id), 0, 1, MODULE.id);
  const laid = pv.modules(gridded, size).grids;

  const into = { kind: "paint", string: 0, erase: false } as const;

  for (const [index, cells] of laid.entries()) {
    for (const at of cells ?? []) gridded = paint(gridded, index, at, into);
  }

  return {
    scene: gridded,
    strings: [
      {
        name: "Süd",
        moduleType: MODULE.id,
        device: 1,
        input: 1,
        modules: 0,
        optimized: 0,
        tilt: 0,
        azimuth: 0,
        loss: 2,
      },
    ],
  };
}

test("a string over its inverter's voltage in the cold is warned of at its modules, before saving", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: overVoltage(),
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 800 },
  });

  // 32 × 41 V × (1 + 0.27 %/K × 35 K), worked by hand.
  const warning =
    "Süd: 1436 V Leerlaufspannung bei −10 °C übersteigen die 800 V des Wechselrichters.";

  await drill("Module", SOUTH);
  await expect.element(inspector().getByRole("status").filter({ hasText: warning })).toBeVisible();

  await drill("Module", "Szene", "Strings", "Süd");
  await expect.element(inspector().getByRole("status").filter({ hasText: warning })).toBeVisible();
});
