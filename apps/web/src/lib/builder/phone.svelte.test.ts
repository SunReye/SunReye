import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  cellsOnPage,
  DEVICES,
  filledFace,
  house,
  MODULE,
  onCanvas,
  ontoFace,
  phone,
  press,
  pv,
  settle,
  SOUTH,
  starts,
  tap,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { addGrid, emptyDraft } from "./modules.ts";
import { handles } from "./handles/grips.ts";

// The builder on a phone (ADR 20): the canvas fills the screen, the inspector is a bottom sheet,
// "+" adds, and every step is a finger.

/** The inspector's bottom sheet and the handle that pulls it up. */
const sheet = () => page.getByRole("region", { name: "Szene bearbeiten" });
const handle = () => page.getByRole("button", { name: "Szene bearbeiten" });

/** The canvas's own buttons on a phone. */
const tools = () => page.getByRole("toolbar", { name: "Werkzeuge" });

/** Taps a row or button of the pulled-up inspector whose name starts with `label`. */
async function row(label: string): Promise<void> {
  const button = sheet()
    .getByRole("button", { name: starts(label) })
    .first();

  await expect.element(button).toBeVisible();
  await tap(button);
}

/** One finger selects three modules of the filled south face a phone has flown onto, and the
 * peeking sheet's bar wires them into "String 1": the roof stays in view. */
async function wireThree(): Promise<void> {
  const filled = filledFace(addGrid(house().scene, 0, 1, MODULE.id), 0);
  const cells = cellsOnPage(filled, 0, ontoFace(filled, 0));

  await press("touch", [cells("0.0"), cells("0.1"), cells("0.2")]);

  const bar = page.getByRole("toolbar", { name: "Auswahl" });

  await expect.element(bar.getByText("3 gewählt")).toBeVisible();
  await tap(bar.getByRole("button", { name: "In String 1 verdrahten" }));
  await expect.element(bar).not.toBeInTheDocument();
}

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await phone();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
  await page.viewport(1280, 900);
});

test("on a phone the inspector is a bottom sheet a finger pulls up; nothing says view-only", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await expect.element(handle()).toHaveAttribute("aria-expanded", "false");
  expect(page.getByRole("complementary").query()).toBeNull();
  expect(page.getByText(/nur ansehen/u).query()).toBeNull();

  await tap(handle());

  await expect.element(handle()).toHaveAttribute("aria-expanded", "true");
  await expect.element(sheet().getByRole("heading", { name: "Szene" })).toBeVisible();
});

test("a tap on the house drills the inspector to it, still peeking: the handles stay in view", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await settle(() => draws.mock.calls.length > 0);

  await press("touch", [onCanvas(house().scene)([5, 3, 4])]);

  await expect.element(sheet().getByRole("heading", { name: "Baukörper 1" })).toBeInTheDocument();
  await expect.element(handle()).toHaveAttribute("aria-expanded", "false");
});

test("by touch alone an admin builds a house from a template, lays modules on a face and wires a string", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: emptyDraft(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await tap(page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }));
  await tap(handle());
  await row("Module");
  await row(SOUTH);
  await row(MODULE.name);
  await row("Fläche füllen");

  // Down to reach "+", which adds a string and opens it.
  await tap(handle());
  await tap(tools().getByRole("button", { name: "Hinzufügen" }));
  await tap(page.getByRole("button", { name: "String hinzufügen" }));
  await expect.element(sheet().getByRole("heading", { name: "String 1" })).toBeVisible();

  // Down to look: the camera has flown onto the face, and one finger selects three of its modules.
  await tap(handle());
  await expect.element(handle()).toHaveAttribute("aria-expanded", "false");

  await settle(() => draws.mock.calls.length > 0);
  await wireThree();

  await tap(handle());
  await row("Strings");
  await expect.element(sheet().getByText(/^3 Module, davon 0 mit Optimierer$/u)).toBeVisible();

  // The canvas's own undo takes the wiring back.
  await tap(handle());
  await tap(tools().getByRole("button", { name: "Rückgängig" }));
  await tap(handle());
  await expect.element(sheet().getByText(/^0 Module, davon 0 mit Optimierer$/u)).toBeVisible();
}, 60_000);

test("opening a face for its modules flies the camera onto it: a tap lands in the cell under it", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();
  const scene = addGrid(start.scene, 0, 1, MODULE.id);

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: { ...start, scene },
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await settle(() => draws.mock.calls.length > 0);

  await tap(handle());
  await row("Module");
  await row(SOUTH);
  await tap(handle());
  await expect.element(handle()).toHaveAttribute("aria-expanded", "false");

  const cells = cellsOnPage(scene, 0, ontoFace(scene, 0));
  const [left] = cells("0.0");
  const [right] = cells("0.1");

  // From the first view a module is about 10 px across; here it is a finger's.
  expect(right - left).toBeGreaterThan(30);

  await press("touch", [cells("1.2")]);
  await expect.element(sheet().getByText("1 Module gesetzt")).toBeInTheDocument();
  await press("touch", [cells("1.2")]);
  await expect.element(sheet().getByRole("heading", { name: "Modul 1" })).toBeInTheDocument();
});

test("a finger picks a chimney and slides it along its roof, still peeking", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();
  const chimney = { block: 0, face: 1, across: 3, up: 1.5, width: 0.6, depth: 0.6, height: 1.2 };
  const scene = { ...start.scene, chimneys: [chimney] };
  const [top] = handles(scene, { kind: "chimney", index: 0 }, pv.modules(scene, {}));

  if (top === undefined) throw new Error("no chimney handle");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: { ...start, scene },
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await settle(() => draws.mock.calls.length > 0);

  const onPage = onCanvas(scene);
  const [x, y, z] = top.at;

  await press("touch", [onPage(top.at)]);
  await expect.element(sheet().getByRole("heading", { name: "Schornstein 1" })).toBeInTheDocument();

  await press("touch", [onPage(top.at), onPage([x + 1, y, z]), onPage([x + 2, y, z])]);

  const across = sheet().getByRole("button", { name: starts("Mitte von links (m)") });

  await expect.element(across.getByText(/^5$/u)).toBeInTheDocument();
  await expect.element(handle()).toHaveAttribute("aria-expanded", "false");
});

test("a finger drags a car place on the lawn", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();
  const place = { device: 3, x: -5, z: 1, width: 2.5, length: 5, rotation: 0 };
  const scene = { ...start.scene, carPlaces: [place] };
  // High over the house and the lawn around it: the presets frame the house alone.
  const above = { position: [2, 60, 4.05], target: [2, 0, 4] } as const;

  localStorage.setItem("sunreye.builder.view", JSON.stringify(above));
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: { ...start, scene },
    moduleTypes: [MODULE],
    devices: DEVICES,
  });
  await settle(() => draws.mock.calls.length > 0);

  const onPage = onCanvas(scene, above);

  await press("touch", [onPage([-3.75, 0, 3.5])]);
  await expect.element(sheet().getByRole("heading", { name: "Stellplatz 1" })).toBeInTheDocument();

  await press("touch", [onPage([-3.75, 0, 3.5]), onPage([-3.75, 0, 4.5]), onPage([-3.75, 0, 5.5])]);

  const z = sheet().getByRole("button", { name: starts("Position z (m)") });

  await expect.element(z.getByText(/^[23](,\d)?$/u)).toBeInTheDocument();
});
