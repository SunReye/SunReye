import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { parseView } from "../../lib/builder/camera.ts";
import Page from "./+page.svelte";

const KEPT = "sunreye.builder.view";

beforeEach(async () => {
  localStorage.removeItem(KEPT);
  await page.viewport(1280, 900);
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("without WebGL2 the route points to the form", async () => {
  // No context at all: the route asks only for WebGL2.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

  const screen = await render(Page);

  await expect
    .element(screen.getByRole("link", { name: "Die PV-Anlage im Formular beschreiben" }))
    .toHaveAttribute("href", "#/");
  expect(screen.getByLabelText("3D-Szene des Hauses").query()).toBeNull();
});

test("on a phone the scene opens view-only", async () => {
  await page.viewport(390, 800);

  const screen = await render(Page);

  await expect.element(screen.getByLabelText("3D-Szene des Hauses")).toBeVisible();
  await expect.element(screen.getByText(/nur ansehen/u)).toBeVisible();
  expect(screen.getByRole("button", { name: "Baukörper hinzufügen" }).query()).toBeNull();
  await expect.element(screen.getByRole("button", { name: "Norden" })).toBeVisible();
});

test("a preset view is kept in this browser", async () => {
  const screen = await render(Page);

  await screen.getByRole("button", { name: "Norden" }).click();

  const kept = parseView(localStorage.getItem(KEPT));

  // three.js: north is −z.
  expect(kept?.position[2]).toBeLessThan(kept?.target[2] ?? 0);
});

test("the admin adds a block, a tree and a box, and turns a roof flat", async () => {
  const screen = await render(Page);

  await screen.getByRole("button", { name: "Baukörper hinzufügen" }).click();
  await screen.getByRole("button", { name: "Baum hinzufügen" }).click();
  await screen.getByRole("button", { name: "Quader hinzufügen" }).click();

  await expect.element(screen.getByRole("group", { name: "Baukörper 2" })).toBeVisible();
  await expect.element(screen.getByRole("group", { name: "Baum" })).toBeVisible();
  await expect.element(screen.getByRole("group", { name: "Quader" })).toBeVisible();

  const first = screen.getByRole("group", { name: "Baukörper 1" });

  await expect.element(first.getByRole("spinbutton", { name: "Dachneigung (°)" })).toBeVisible();
  await userEvent.selectOptions(
    first.getByRole("combobox", { name: "Dach" }).element(),
    "Flachdach",
  );
  expect(first.getByRole("spinbutton", { name: "Dachneigung (°)" }).query()).toBeNull();
});

test("the compass dial turns the scene to north", async () => {
  const screen = await render(Page);
  const dial = screen.getByRole("slider", { name: "Nordrichtung (°)" });

  await userEvent.fill(dial, "90");

  await expect.element(dial).toHaveValue("90");
});
