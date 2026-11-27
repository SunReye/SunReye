import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Builder from "../../../../../../packages/builder/src/builder/Builder.svelte";
import {
  desk,
  DEVICES,
  drill,
  hosted,
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
  undrawn,
} from "./builder.harness.ts";
import { addGrid } from "../../../../../../packages/builder/src/builder/modules.ts";

/** The context toolbar on the canvas. */
const bar = () => page.getByRole("toolbar", { name: "Aktionen" });
const act = (name: string) => bar().getByRole("button", { name });

/** The toolbar however it shows: it mounts hidden, until measured, where a role query misses it. */
const mounted = () => document.querySelector('[role="toolbar"][aria-label="Aktionen"]');

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
  const draws = undrawn();

  await render(Builder, {
    pv,
    ...hosted(testCore()),
    start,
    moduleTypes: [MODULE],
    devices: DEVICES,
    limits: { 1: 400 },
    inputs: { 1: [{ maxCurrent: 36, minVoltage: 160, maxVoltage: 650, startVoltage: 160 }] },
  });
  await settle(() => draws.mock.calls.length > 0);
}

test("nothing selected, no toolbar; a face without a grid is filled from it in one step; a picked opening carries duplicate, night light and remove; it hides while a pointer is down", async () => {
  const count = house().scene.openings?.length ?? 0;
  const undo = inspector().getByRole("button", { name: "Rückgängig" });

  await built();
  expect(mounted()).toBeNull();

  // The face carries one: what finds none above finds this.
  await drill("Module", SOUTH);
  await expect.poll(mounted).not.toBeNull();
  await act("Füllen").click();
  await expect.element(inspector().getByText("16 Module gesetzt")).toBeVisible();
  // One step: the grid and its modules go together.
  await undo.click();
  await expect.element(undo).toBeDisabled();

  await drill("Module", "Szene", "Gebäude", "Fenster hinzufügen");
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
  expect(mounted()).toBeNull();

  await drill("Baukörper 1");
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

test("a roof face is filled and auto-strung from the toolbar, its proposal kept there; one the inverter has no free input for says so in the toolbar, inside the canvas and off the status line", async () => {
  const start = house();
  const scene = addGrid(addGrid(start.scene, 0, 1, MODULE.id), 0, 0, MODULE.id);

  await built({ ...start, scene });
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

  // The one input is taken: the next face finds none free.
  await drill("Szene", "Module", "Baukörper 1, Fläche 1");
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
