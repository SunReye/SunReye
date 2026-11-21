import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  choose,
  desk,
  DEVICES,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
  pv,
  settle,
  starts,
  stepUntil,
  testCore,
  undesk,
} from "./builder.harness.ts";
import { handles } from "./handles/grips.ts";
import type { Scene } from "./pv.ts";
import { fresh } from "./wall-openings.ts";

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
});

/** A mouse drag of opening `index`'s width arrow, 20 cm along its wall. */
async function widen(scene: Scene, index: number): Promise<void> {
  const onPage = onCanvas(scene);

  const arrow = handles(scene, { kind: "opening", index }, pv.modules(scene, {})).find(
    ({ grip }) => grip === "width",
  );

  if (arrow?.axis === undefined) throw new Error("no width arrow");

  const [ax, ay, az] = arrow.at;
  const [x, y] = onPage(arrow.at);
  const [ex, ey] = onPage([ax + arrow.axis[0] * 0.2, ay, az + arrow.axis[2] * 0.2]);
  const mouse = { button: "left" } as const;

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed", x, y });
  await cdp().send("Input.dispatchMouseEvent", {
    ...mouse,
    type: "mouseMoved",
    buttons: 1,
    x: ex,
    y: ey,
  });
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", x: ex, y: ey });
}

test("a window is added on a wall and its width arrow drags it wider, in one undo step", async () => {
  const draws = vi.spyOn(EffectComposer.prototype, "render");
  const start = house();
  const before = start.scene.openings ?? [];

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude");
  await settle(() => draws.mock.calls.length > 0);

  await inspector().getByRole("button", { name: "Fenster hinzufügen" }).click();

  const width = inspector().getByRole("button", { name: starts("Breite (m)") });
  const undo = inspector().getByRole("button", { name: "Rückgängig" });

  // The new window's own level, in its usual size.
  await expect.element(width.getByText(/^1,2$/u)).toBeVisible();

  // The scene as the builder now holds it: the template's openings and the new one after them.
  const made = fresh(pv, start.scene, "window");

  if (made === null) throw new Error("no room for a window");

  // Up to the front door, 30 cm on, there is room for it.
  const wider = width.getByText(/^1,[345]$/u);

  // A press before the handles' first draw grabs nothing: it is made again until one lands.
  await stepUntil(
    () => wider.query() !== null,
    () => widen({ ...start.scene, openings: [...before, made] }, before.length),
  );

  await undo.click();

  await expect.element(width.getByText(/^1,2$/u)).toBeVisible();
});

test("a window is set dark at night and duplicated: the copy stands picked, as dark as its original", async () => {
  const start = house();
  const count = start.scene.openings?.length ?? 0;

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Fenster hinzufügen");
  await choose("Nachtlicht", "Dunkel");
  await inspector().getByRole("button", { name: "Duplizieren" }).click();

  // The copy is the scene's last opening, on its own level.
  await expect
    .element(inspector().getByRole("heading", { name: `Fenster ${String(count + 2)}` }))
    .toBeVisible();
  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Nachtlicht") })
        .getByText("Dunkel"),
    )
    .toBeVisible();

  // One undo takes the copy and returns to the group.
  await inspector().getByRole("button", { name: "Rückgängig" }).click();
  await expect
    .element(inspector().getByRole("button", { name: "Duplizieren" }))
    .not.toBeInTheDocument();
});

const heading = (number: number) =>
  inspector().getByRole("heading", { name: `Fenster ${String(number)}` });

test("Ctrl+C copies the picked window and Ctrl+V adds a copy beside it, picked; in a text field the keys are the field's", async () => {
  const start = house();
  const count = start.scene.openings?.length ?? 0;

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude", "Fenster hinzufügen");
  await expect.element(heading(count + 1)).toBeVisible();

  await userEvent.keyboard("{Control>}c{/Control}{Control>}v{/Control}");
  await expect.element(heading(count + 2)).toBeVisible();

  // Typing a width: a paste there is the field's, and adds no window.
  await inspector()
    .getByRole("button", { name: starts("Breite") })
    .click();
  await page.getByRole("button", { name: /tippen zum Eingeben/u }).click();
  await page.getByRole("textbox", { name: "Breite (m) eingeben" }).click();
  await userEvent.keyboard("{Control>}v{/Control}");
  await userEvent.keyboard("{Enter}{Escape}");

  await expect.element(heading(count + 2)).toBeVisible();
  await expect.element(heading(count + 3)).not.toBeInTheDocument();

  // Out of the field, the copy is pasted again.
  await userEvent.keyboard("{Control>}v{/Control}");
  await expect.element(heading(count + 3)).toBeVisible();
});
