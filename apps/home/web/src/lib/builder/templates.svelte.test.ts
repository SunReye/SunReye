import "../../app.css";
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../../packages/builder/src/builder/Builder.svelte";
import { unfaded } from "../scroll-fade.harness.ts";
import {
  desk,
  DEVICES,
  drill,
  hosted,
  house,
  inspector,
  MODULE,
  pv,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { emptyDraft, type Draft } from "../../../../../../packages/builder/src/builder/modules.ts";

// Templates for an empty scene (ADR 20).

beforeEach(desk);

afterEach(undesk);

const open = (start: Draft) =>
  render(Builder, {
    pv,
    ...hosted(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

const templates = () => page.getByRole("region", { name: "Vorlage wählen" });

const NAMES = [
  "Einfamilienhaus mit Satteldach",
  "Bungalow mit Flachdach",
  "Haus mit Walmdach",
  "L-Haus aus zwei Baukörpern",
  "Reihenendhaus",
  "Leer beginnen",
];

test("an empty scene offers the six templates; picking one fills it in one undo step", async () => {
  await open(emptyDraft());

  await Promise.all(
    NAMES.map((name, i) =>
      expect.element(templates().getByRole("button").nth(i)).toHaveAccessibleName(name),
    ),
  );
  expect(templates().getByRole("button").elements()).toHaveLength(NAMES.length);
  expect(unfaded()).toEqual([]);

  await templates().getByRole("button", { name: "L-Haus aus zwei Baukörpern" }).click();

  expect(templates().query()).toBeNull();
  await drill("Gebäude");
  await expect.element(inspector().getByRole("button", { name: /^Baukörper 2/u })).toBeVisible();

  await inspector().getByRole("button", { name: "Rückgängig" }).click();

  await expect.element(templates()).toBeVisible();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});

test("starting empty leaves the scene empty, with nothing to undo", async () => {
  await open(emptyDraft());

  await templates().getByRole("button", { name: "Leer beginnen" }).click();

  expect(templates().query()).toBeNull();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
  await drill("Gebäude", "Baukörper hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Baukörper 1" })).toBeVisible();
});

test("a scene with blocks never offers templates", async () => {
  await open(house());

  await expect.element(page.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  expect(templates().query()).toBeNull();
});
