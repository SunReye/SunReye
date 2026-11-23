import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { addGrid, wire, type Draft } from "@sunreye/builder/builder/modules.ts";
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
  filledFace,
} from "./builder.harness.ts";

beforeEach(desk);

afterEach(undesk);

/** The face level's count of placed modules. */
const count = (placed: number) =>
  inspector().getByText(`${placed} Module gesetzt`, { exact: true });

const undo = () => inspector().getByRole("button", { name: "Rückgängig" }).click();

test("fill face lays a module in every free place the face holds, and clear takes them, each one undo step", async () => {
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

/** The template house with both roof faces filled and wired into one string. */
function overVoltage(): Draft {
  const { scene } = house();
  let gridded = addGrid(addGrid(scene, 0, 0, MODULE.id), 0, 1, MODULE.id);
  gridded = filledFace(filledFace(gridded, 0), 1);

  for (const [index, { modules }] of (gridded.grids ?? []).entries()) {
    for (const module of modules.keys()) gridded = wire(gridded, index, module, 0);
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

test("a string outside its MPPT input's window is warned of on its level, with figure and limit", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: overVoltage(),
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 800 },
    inputs: { 1: [{ maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 }] },
  });

  await drill("Strings", "Süd");

  // 32 × 34 V × (1 + 0.27 %/K × 35 K), worked by hand.
  const warning = "Süd: 1191 V im Arbeitspunkt bei −10 °C liegen über dem MPPT-Bereich bis 650 V.";

  await expect.element(inspector().getByRole("status").filter({ hasText: warning })).toBeVisible();
});
