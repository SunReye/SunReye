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
  gridOnTheSouthFace,
  house,
  inspector,
  MODULE,
  pv,
  SOUTH,
  testCore,
  undesk,
} from "./builder.harness.ts";

beforeEach(desk);

afterEach(undesk);

/** The face level's count of placed modules. */
const count = (placed: number) => inspector().getByText(`${placed} von 16 Modulen gesetzt`);

const undo = () => inspector().getByRole("button", { name: "Rückgängig" }).click();

test("fill face places a module in every cell the face holds, and clear takes them, each one undo step", async () => {
  await gridOnTheSouthFace(testCore());

  await inspector().getByRole("button", { name: "Fläche füllen" }).click();

  // The crate's grid on the 10 m × 4.88 m south face: 8 × 2 portrait modules.
  await expect.element(count(16)).toBeVisible();

  await inspector().getByRole("button", { name: "Fläche leeren" }).click();
  await expect.element(count(0)).toBeVisible();

  await undo();
  await expect.element(count(16)).toBeVisible();
  await undo();
  await expect.element(count(0)).toBeVisible();
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
