import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { parseView } from "@sunreye/builder/builder/camera.ts";
import { emptyCore, keepOffline } from "../route.harness.ts";
import Page from "./+page.svelte";

const KEPT = "sunreye.builder.view";

keepOffline();

beforeEach(async () => {
  localStorage.removeItem(KEPT);
  await page.viewport(1280, 900);
  // The inspector's levels land at once: these tests read what it shows, not how it slides.
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
});

test("without WebGL2 the route points to the form", async () => {
  // No context at all: the route asks only for WebGL2.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  const screen = await render(Page, { context: emptyCore() });

  await expect
    .element(screen.getByRole("link", { name: "Die PV-Anlage im Formular beschreiben" }))
    .toHaveAttribute("href", "#/");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
});

test('on a phone the scene edits too: templates, the inspector\'s sheet and "+"', async () => {
  await page.viewport(390, 800);

  const screen = await render(Page, { context: emptyCore() });

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Szene bearbeiten" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Hinzufügen" })).toBeInTheDocument();
});

/** The route starts without a layout: the admin first picks the gable house's template. */
async function gableHouse(): Promise<void> {
  await page.getByRole("button", { name: "Einfamilienhaus mit Satteldach" }).click();
}

test("a preset view is kept in this browser", async () => {
  const screen = await render(Page, { context: emptyCore() });

  await gableHouse();

  await screen.getByRole("button", { name: "Ansichten" }).click();
  await page.getByRole("menuitem", { name: "Norden" }).click();

  const kept = parseView(localStorage.getItem(KEPT));

  // three.js: north is −z.
  expect(kept?.position[2]).toBeLessThan(kept?.target[2] ?? 0);
});

/** The inspector beside the canvas. */
const inspector = () => page.getByRole("complementary", { name: "Szene bearbeiten" });

/** Presses an inspector button whose name starts with `label`. */
async function press(label: string): Promise<void> {
  await inspector()
    .getByRole("button", { name: new RegExp(`^${label}`, "u") })
    .first()
    .click();
}

test("the admin adds a block, a tree and a box, and turns a roof flat", async () => {
  await render(Page, { context: emptyCore() });
  await gableHouse();

  await press("Gebäude");
  await press("Baukörper hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Baukörper 2" })).toBeVisible();

  await press("Gebäude");
  await press("Szene");
  await press("Umgebung");
  await press("Baum hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Baum 1" })).toBeVisible();
  await press("Umgebung");
  await press("Quader hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Quader 2" })).toBeVisible();

  await press("Umgebung");
  await press("Szene");
  await press("Gebäude");
  await press("Baukörper 1 ");
  await expect.element(inspector().getByRole("button", { name: /^Dachneigung/u })).toBeVisible();
  await press("Dach ");
  await page.getByRole("radio", { name: "Flachdach" }).click();
  await page.getByRole("button", { name: /^Übernehmen/u }).click();

  await expect.element(inspector().getByRole("button", { name: "Dach Flachdach" })).toBeVisible();
  expect(
    inspector()
      .getByRole("button", { name: /^Dachneigung/u })
      .query(),
  ).toBeNull();
});

test("the compass dial turns the scene to north", async () => {
  await render(Page, { context: emptyCore() });
  await gableHouse();

  await press("Umgebung");
  await press("Nordrichtung");
  page.getByRole("spinbutton", { name: "Nordrichtung (°)" }).element().focus();
  await userEvent.keyboard("{PageUp}");
  await page.getByRole("button", { name: /^Übernehmen/u }).click();

  await expect
    .element(inspector().getByRole("button", { name: "Nordrichtung (°) 10" }))
    .toBeVisible();
});
