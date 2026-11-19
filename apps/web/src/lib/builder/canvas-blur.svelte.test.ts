import "../../app.css";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cdp, page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import { least, still } from "../contrast.harness.ts";
import Builder from "./Builder.svelte";
import * as builder from "./builder.harness.ts";
import { emptyDraft, type Draft } from "./modules.ts";
import { blurred } from "./over-canvas.harness.ts";

// Canvas chips (ADR 21 "Glass") in the builder: nothing that lies over the 3D canvas blurs what
// is behind it, and all of it stays readable without the blur.

const SLOW = { timeout: 15_000 };

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
  const draws = vi.spyOn(EffectComposer.prototype, "render");

  await render(Builder, {
    pv: builder.pv,
    core: connect(builder.testCore()),
    start,
    moduleTypes: [builder.MODULE],
    devices: builder.DEVICES,
  });
  await expect.poll(() => draws.mock.calls.length, SLOW).toBeGreaterThan(0);
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
});

test("what the canvas's surfaces say holds AA over the darkest and the brightest a scene shows, in both themes", async () => {
  await built();
  await builder.press("touch", [builder.onCanvas(builder.house().scene)([5, 3, 4])]);
  await expect.element(bar()).toBeVisible();

  const status = page.getByRole("group", { name: "Jetzt in der Szene" }).element();
  const moment = page.getByRole("group", { name: "Zeitpunkt" }).element();
  const toolbar = bar().element();
  // A refusal's words, as the toolbar and the inspector say them.
  const refusal = document.createElement("p");

  refusal.className = "text-destructive";
  toolbar.append(refusal);
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
    expect(least(adds.element(), adds.element())).toBeGreaterThanOrEqual(4.5);
  } finally {
    await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
});
