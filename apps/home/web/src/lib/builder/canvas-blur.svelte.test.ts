import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { least, still } from "../contrast.harness.ts";
import Builder from "../../../../../../packages/builder/src/builder/Builder.svelte";
import * as builder from "./builder.harness.ts";
import { emptyDraft, type Draft } from "../../../../../../packages/builder/src/builder/modules.ts";
import { blurred } from "./over-canvas.harness.ts";

// Canvas chips (ADR 21 "Glass") in the builder: nothing that lies over the 3D canvas blurs what
// is behind it, and all of it stays readable without the blur.

const sheet = () => page.getByRole("region", { name: "Szene bearbeiten" });
const handle = () => page.getByRole("button", { name: "Szene bearbeiten" });
const tools = () => page.getByRole("toolbar", { name: "Werkzeuge" });
const bar = () => page.getByRole("toolbar", { name: "Aktionen" });

beforeEach(async () => {
  localStorage.removeItem("sunreye.builder.view");
  await builder.phone();
});

afterEach(async () => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove("dark");
  still.remove();
  await builder.undesk();
  await page.viewport(1280, 900);
});

/** The builder on a phone, its scene drawn. */
async function built(start: Draft = builder.house()): Promise<void> {
  const draws = builder.undrawn();

  await render(Builder, {
    pv: builder.pv,
    ...builder.hosted(builder.testCore()),
    start,
    moduleTypes: [builder.MODULE],
    devices: builder.DEVICES,
  });
  await builder.settle(() => draws.mock.calls.length > 0);
}

test("on a phone nothing over the 3D canvas has a backdrop blur: its buttons, slider, status line, tools, toolbar and sheet", async () => {
  await built();

  // The views' and the weather's buttons, the time slider, the status line, the tools and the
  // peeking inspector.
  await expect.element(page.getByRole("group", { name: "Jetzt in der Szene" })).toBeVisible();
  await expect.element(tools()).toBeVisible();
  expect(blurred()).toEqual([]);

  // A picked block carries the context toolbar.
  await builder.press("touch", [builder.onCanvas(builder.house().scene)([5, 3, 4])]);
  await expect.element(bar()).toBeVisible();
  expect(blurred()).toEqual([]);

  // Pulled up, the inspector and all its rows lie over the canvas.
  await builder.tap(handle());
  await expect.element(handle()).toHaveAttribute("aria-expanded", "true");
  await expect.element(sheet().getByRole("heading", { name: "Baukörper 1" })).toBeVisible();
  expect(blurred()).toEqual([]);
});

test("the templates over an empty scene have no backdrop blur over the canvas", async () => {
  await built(emptyDraft());

  await expect.element(page.getByRole("region", { name: "Vorlage wählen" })).toBeVisible();
  expect(blurred()).toEqual([]);

  // What it looks for, it finds: a chip over the canvas that blurs what is behind it.
  const chip = document.createElement("div");

  chip.className = "chip";
  chip.style.cssText = "position: fixed; inset: 30%; backdrop-filter: blur(4px)";
  document.body.append(chip);
  expect(blurred()).toEqual(["div.chip"]);
  chip.remove();
});

test("what the canvas's surfaces say holds AA over the darkest and the brightest a scene shows, in both themes", async () => {
  await built();

  // A garage door where the front wall's window and door leave no room: the toolbar refuses it.
  await builder.press("touch", [builder.onCanvas(builder.house().scene)([3, 1.6, 8])]);
  await bar().getByRole("button", { name: "Hinzufügen" }).click();
  await page.getByRole("menuitem", { name: "Garagentor" }).click();

  const refused = bar().getByRole("alert");

  await expect.element(refused).toHaveTextContent("Dort liegt schon eine andere Öffnung.");

  const status = page.getByRole("group", { name: "Jetzt in der Szene" }).element();
  const moment = page.getByRole("group", { name: "Zeitpunkt" }).element();
  const toolbar = bar().element();
  const refusal = refused.element();

  document.head.append(still);

  for (const theme of ["light", "dark"]) {
    document.documentElement.classList.toggle("dark", theme === "dark");

    const held = {
      status: least(status, status) >= 4.5,
      clock: least(moment, moment) >= 4.5,
      action: least(toolbar, toolbar) >= 4.5,
      refusal: least(refusal, toolbar) >= 4.5,
      sheet: least(sheet().element(), sheet().element()) >= 4.5,
    };

    expect([theme, held]).toEqual([
      theme,
      { status: true, clock: true, action: true, refusal: true, sheet: true },
    ]);
  }
});

// Last: touch emulation cannot be undone (pointer stays `none`).
test("the sheet of what a phone can add has no backdrop blur over the canvas, nor have its groups", async () => {
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });

  try {
    await built();
    await builder.tap(tools().getByRole("button", { name: "Hinzufügen" }));

    const adds = page.getByRole("dialog", { name: "Hinzufügen" });

    await expect.element(adds).toHaveAttribute("data-slot", "drawer-content");
    await expect.element(adds.getByRole("button", { name: "String hinzufügen" })).toBeVisible();
    expect(blurred()).toEqual([]);

    // Its quietest text, a group's heading, on the sheet's own colour.
    const heading = adds.getByRole("heading", { name: "Strings" }).element();

    document.head.append(still);

    for (const theme of ["light", "dark"]) {
      document.documentElement.classList.toggle("dark", theme === "dark");
      expect([theme, least(heading, adds.element()) >= 4.5]).toEqual([theme, true]);
    }
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
