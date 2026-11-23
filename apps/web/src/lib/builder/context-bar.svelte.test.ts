import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  house,
  inspector,
  MODULE,
  onCanvas,
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
import { addGrid } from "@sunreye/builder/builder/modules.ts";

/** The context toolbar on the canvas. */
const bar = () => page.getByRole("toolbar", { name: "Aktionen" });
const act = (name: string) => bar().getByRole("button", { name });

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await desk();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await undesk();
  await page.viewport(1280, 900);
});

async function built(start = house()) {
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv,
    core: connect(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 400 },
    inputs: { 1: [{ maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 }] },
  });
  await settle(() => draws.mock.calls.length > 0);
}

test("nothing selected, no toolbar; a picked opening carries duplicate, night light and remove", async () => {
  const count = house().scene.openings?.length ?? 0;

  await built();
  await expect.element(bar()).not.toBeInTheDocument();

  await drill("Gebäude", "Fenster hinzufügen");
  await act("Nachtlicht").click();
  await page.getByRole("menuitemradio", { name: "Dunkel" }).click();
  await expect
    .element(
      inspector()
        .getByRole("button", { name: starts("Nachtlicht") })
        .getByText("Dunkel"),
    )
    .toBeVisible();

  await act("Duplizieren").click();
  await expect
    .element(inspector().getByRole("heading", { name: `Fenster ${String(count + 2)}` }))
    .toBeVisible();

  await act("Entfernen").click();
  await expect.element(inspector().getByRole("heading", { name: "Gebäude" })).toBeVisible();
  await expect.element(bar()).not.toBeInTheDocument();
});

test("a roof face is filled and auto-strung from the toolbar, its proposal kept there", async () => {
  const start = house();

  await built({ ...start, scene: addGrid(start.scene, 0, 1, MODULE.id) });
  await drill("Module", SOUTH);

  await act("Füllen").click();
  await expect.element(inspector().getByText("16 Module gesetzt")).toBeVisible();
  // A full face takes no more.
  await expect.element(act("Füllen")).toBeDisabled();

  await act("Automatisch verdrahten").click();
  await expect.element(bar().getByRole("status")).toHaveTextContent("Vorschlag: 2 neue Strings");
  await act("Übernehmen").click();

  await drill("Module", "Szene", "Strings");
  await expect
    .element(inspector().getByRole("button", { name: /^String 2.*8 Module/u }))
    .toBeVisible();
});

test("a roof face without a grid carries the toolbar too: Füllen lays its first modules", async () => {
  await built();
  await drill("Module", SOUTH);

  await act("Füllen").click();
  await expect.element(inspector().getByText("16 Module gesetzt")).toBeVisible();
  // One step: the grid and its modules go together.
  await inspector().getByRole("button", { name: "Rückgängig" }).click();
  await expect.element(inspector().getByRole("button", { name: "Rückgängig" })).toBeDisabled();
});

test("an auto-stringing the inverter has no free input for says so in the toolbar, inside the canvas and off the status line", async () => {
  const start = house();
  const scene = addGrid(addGrid(start.scene, 0, 1, MODULE.id), 0, 0, MODULE.id);

  await built({ ...start, scene });
  await drill("Module", SOUTH);
  await act("Füllen").click();
  await act("Automatisch verdrahten").click();
  await act("Übernehmen").click();

  // The one input is taken: the next face finds none free.
  await drill("Module", "Baukörper 1, Fläche 1");
  await act("Füllen").click();
  await act("Automatisch verdrahten").click();
  await expect
    .element(bar().getByRole("alert").filter({ hasText: "Kein MPPT-Eingang ohne String" }))
    .toBeVisible();

  const toolbar = bar().element().getBoundingClientRect();
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();

  const status = page
    .getByRole("group", { name: "Jetzt in der Szene" })
    .element()
    .getBoundingClientRect();

  expect(toolbar.left).toBeGreaterThanOrEqual(canvas.left);
  expect(toolbar.right).toBeLessThanOrEqual(canvas.right);
  expect(toolbar.top).toBeGreaterThanOrEqual(canvas.top);
  expect(toolbar.bottom).toBeLessThanOrEqual(status.top);
});

const boxOf = (role: "region" | "toolbar" | "slider", name?: string) =>
  (name === undefined ? page.getByRole(role).first() : page.getByRole(role, { name }))
    .element()
    .getBoundingClientRect();

/** The page boxes of the toolbar and of what it must stay clear of on a phone. */
const boxes = () => ({
  toolbar: bar().element().getBoundingClientRect(),
  slider: boxOf("slider"),
  sheet: boxOf("region", "Szene bearbeiten"),
  tools: boxOf("toolbar", "Werkzeuge"),
});

test("on a phone the toolbar stands in the canvas by the picked block, clear of every zone, and its edit pulls the sheet up", async () => {
  await phone();
  await built();
  await press("touch", [onCanvas(house().scene)([5, 3, 4])]);
  await expect.element(bar()).toBeVisible();

  const { toolbar, slider, sheet, tools } = boxes();

  expect(toolbar.left).toBeGreaterThanOrEqual(0);
  expect(toolbar.right).toBeLessThanOrEqual(390);
  expect(toolbar.top).toBeGreaterThanOrEqual(slider.bottom);
  expect(toolbar.bottom).toBeLessThanOrEqual(Math.min(sheet.top, tools.top));

  for (const button of bar().getByRole("button").elements()) {
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }

  await tap(act("Bearbeiten"));
  await expect
    .element(page.getByRole("button", { name: "Szene bearbeiten" }))
    .toHaveAttribute("aria-expanded", "true");
  // A pulled-up sheet covers the canvas's lower zones: the toolbar goes with them.
  await expect.element(bar()).not.toBeInTheDocument();
});

test("the toolbar hides while a pointer is down on the canvas, and comes back with it up", async () => {
  await built();
  await drill("Gebäude", "Baukörper 1");
  await expect.element(bar()).toBeVisible();

  // Open ground at the canvas's left edge: the press orbits.
  const canvas = page.getByLabelText("3D-Szene des Hauses").element().getBoundingClientRect();
  const [x, y] = [canvas.left + 60, canvas.top + canvas.height * 0.6];
  const mouse = { button: "left", x, y } as const;

  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mousePressed", clickCount: 1 });
  await expect.element(bar()).not.toBeInTheDocument();
  await cdp().send("Input.dispatchMouseEvent", { ...mouse, type: "mouseReleased", clickCount: 1 });
  await expect.element(bar()).toBeVisible();
});
