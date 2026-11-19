import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  filledFace,
  house,
  inspector,
  MODULE,
  pv,
  SOUTH,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { addGrid } from "./modules.ts";

beforeEach(desk);

afterEach(undesk);

const INPUT = { maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 };

const input = (number: number) =>
  inspector().getByRole("group", { name: `MPPT-Eingang ${number}` });

const act = (name: string) => inspector().getByRole("button", { name });

test("auto-stringing proposes a face's strings on the free inputs; kept, they are one undo step", async () => {
  const { scene } = house();

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: { scene: filledFace(addGrid(scene, 0, 1, MODULE.id), 0), strings: [] },
    moduleTypes: [MODULE],
    devices: DEVICES,
    // 8 × 41 V × (1 + 0.27 %/K × 35 K) = 359 V stays under 400 V; nine would not.
    limits: { 1: 400 },
    inputs: { 1: [INPUT, INPUT] },
  });
  await drill("Strings");
  await act(`${SOUTH}: 16 Module automatisch verdrahten`).click();

  // Sixteen modules, at most eight in series: two strings, one on each free input.
  await expect
    .element(inspector().getByRole("status").filter({ hasText: "Vorschlag: 2 neue Strings" }))
    .toBeVisible();
  await expect
    .element(input(1).getByRole("button", { name: /^String 1.*8 Module/u }))
    .toBeVisible();
  await expect
    .element(input(2).getByRole("button", { name: /^String 2.*8 Module/u }))
    .toBeVisible();

  await act("Verwerfen").click();
  await expect.element(input(1).getByText("Kein String")).toBeVisible();
  await expect.element(act("Rückgängig")).toBeDisabled();

  await act(`${SOUTH}: 16 Module automatisch verdrahten`).click();
  await act("Übernehmen").click();
  await expect
    .element(input(2).getByRole("button", { name: /^String 2.*8 Module/u }))
    .toBeVisible();

  await act("Rückgängig").click();
  await expect.element(input(2).getByText("Kein String")).toBeVisible();
});
