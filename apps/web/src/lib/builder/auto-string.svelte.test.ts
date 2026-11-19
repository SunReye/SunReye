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
import { saveFrom } from "./moment.harness.ts";

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

/** The builder on the template house, its south face filled, with one string wired nowhere. */
async function proposing() {
  const transport = testCore();

  const { scene } = house();
  await render(Builder, {
    pv,
    core: connect(transport),
    start: { scene: filledFace(addGrid(scene, 0, 1, MODULE.id), 0), strings: [] },
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 400 },
    inputs: { 1: [INPUT, INPUT, INPUT] },
  });
  await drill("Strings", "String hinzufügen", "Strings");
  await act(`${SOUTH}: 16 Module automatisch verdrahten`).click();
  await expect.element(proposal()).toBeVisible();

  return { transport };
}

const proposal = () => inspector().getByRole("status").filter({ hasText: "Vorschlag:" });

test("an undo drops a proposal, and the redo does not bring it back", async () => {
  await proposing();

  await act("Rückgängig").click();
  await expect.element(proposal()).not.toBeInTheDocument();

  await act("Wiederholen").click();
  await expect.element(input(1).getByRole("button", { name: /^String 1/u })).toBeVisible();
  await expect.element(proposal()).not.toBeInTheDocument();
  await expect.element(input(2).getByText("Kein String")).toBeVisible();
});

test("saving keeps a proposal: what is saved is what is shown, and it is recorded", async () => {
  const { transport } = await proposing();

  await saveFrom("2026-11-01");

  await expect.poll(() => transport.puts).toHaveLength(1);
  expect(transport.puts[0]).toMatchObject({
    strings: [
      { name: "String 1", modules: 0 },
      { name: "String 2", modules: 8 },
      { name: "String 3", modules: 8 },
    ],
  });
});

test("on one free input the proposed strings are of one length: no warning of its own making", async () => {
  const { scene } = house();

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: { scene: filledFace(addGrid(scene, 0, 1, MODULE.id), 0), strings: [] },
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 400 },
    inputs: { 1: [INPUT] },
  });
  await drill("Strings");
  await act(`${SOUTH}: 16 Module automatisch verdrahten`).click();

  await expect
    .element(input(1).getByRole("button", { name: /^String 1.*8 Module/u }))
    .toBeVisible();
  await expect
    .element(input(1).getByRole("button", { name: /^String 2.*8 Module/u }))
    .toBeVisible();
  await expect.element(inspector().getByText(/ungleich lang/u)).not.toBeInTheDocument();

  // Kept, the one input is taken: the next face finds none free and says so.
  await act("Übernehmen").click();
  await drill("Szene", "Module", "Baukörper 1, Fläche 1", MODULE.name, "Fläche füllen");
  await drill("Module", "Szene", "Strings");
  await act("Baukörper 1, Fläche 1: 16 Module automatisch verdrahten").click();

  await expect
    .element(inspector().getByRole("alert").filter({ hasText: "Kein MPPT-Eingang ohne String" }))
    .toBeVisible();
});
