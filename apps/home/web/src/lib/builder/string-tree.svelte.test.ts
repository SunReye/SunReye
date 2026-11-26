import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { type StringDraft } from "../api/core.ts";
import Builder from "../../../../../../packages/builder/src/builder/Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  filledFace,
  hosted,
  house,
  inspector,
  MODULE,
  pv,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { addGrid, type Draft } from "../../../../../../packages/builder/src/builder/modules.ts";

beforeEach(desk);

afterEach(undesk);

const string = (name: string, input: number): StringDraft => ({
  name,
  moduleType: MODULE.id,
  device: 1,
  input,
  modules: 0,
  optimized: 0,
  tilt: 0,
  azimuth: 0,
  loss: 2,
});

/** The template house with both roof faces filled, its 32 modules in no string. */
function unwiredHouse(): Draft {
  const { scene } = house();
  const gridded = addGrid(addGrid(scene, 0, 0, MODULE.id), 0, 1, MODULE.id);

  return {
    scene: filledFace(filledFace(gridded, 0), 1),
    strings: [string("Süd", 2), string("Ost", 1), string("West", 2)],
  };
}

const INPUT = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };

test("the Strings group lists each inverter's MPPT inputs with their strings, and wires the unwired modules", async () => {
  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start: unwiredHouse(),
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 800 },
    inputs: { 1: [INPUT, INPUT, INPUT] },
  });
  await drill("Strings");

  const inverter = inspector().getByRole("group", { name: "Deye" });
  const input = (number: number) => inverter.getByRole("group", { name: `MPPT-Eingang ${number}` });

  await expect.element(input(1).getByRole("button", { name: /^Ost/u })).toBeVisible();
  await expect.element(input(2).getByRole("button", { name: /^Süd/u })).toBeVisible();
  await expect.element(input(2).getByRole("button", { name: /^West/u })).toBeVisible();
  await expect.element(input(3).getByText("Kein String")).toBeVisible();

  // The modules in no string are one tap from a selection.
  await inspector().getByRole("button", { name: "32 Module ohne String auswählen" }).click();

  const bar = page.getByRole("toolbar", { name: "Auswahl" });

  await expect.element(bar.getByText("32 gewählt")).toBeVisible();
  await bar.getByRole("button", { name: "Verdrahten" }).click();
  await page.getByRole("menuitem", { name: "Ost" }).click();

  await expect.element(input(1).getByRole("button", { name: /^Ost.*32 Module/u })).toBeVisible();
  // 32 × 34 V × (1 + 0.27 %/K × 35 K), worked by hand: beside the string it judges.
  await expect
    .element(input(1).getByRole("status").filter({ hasText: "Ost: 1191 V im Arbeitspunkt" }))
    .toBeVisible();
});
