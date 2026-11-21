import "../../app.css";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { frames, realTimers } from "../motion/clock.harness.ts";
import { connect } from "../api/core.ts";
import Builder from "./Builder.svelte";
import { uncovered } from "./pointer.harness.ts";
import {
  desk,
  DEVICES,
  drill,
  enter,
  gridOnTheSouthFace,
  house,
  inspector,
  MODULE,
  pv,
  starts,
  testCore,
  undesk,
} from "./builder.harness.ts";

// The inspector beside the canvas or in its sheet (ADR 20), and what a click in 3D opens.

beforeEach(desk);

afterEach(undesk);

test("a click on the house in 3D drills the inspector to its block", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  // The isometric view looks at the house's middle.
  await page.getByLabelText("3D-Szene des Hauses").click();

  await expect.element(inspector().getByRole("heading", { name: "Baukörper 1" })).toBeVisible();
  await expect
    .element(inspector().getByRole("button", { name: starts("Traufhöhe (m)") }))
    .toBeVisible();
});

test("on a portrait tablet the inspector is a sheet that a tap or a pick pulls up", async () => {
  await page.viewport(820, 1180);
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  const handle = page.getByRole("button", { name: "Szene bearbeiten" });

  await expect.element(handle).toHaveAttribute("aria-expanded", "false");
  expect(page.getByRole("complementary").query()).toBeNull();

  await handle.click();
  await expect.element(handle).toHaveAttribute("aria-expanded", "true");
  await handle.click();
  await expect.element(handle).toHaveAttribute("aria-expanded", "false");
  await uncovered();

  await page.getByLabelText("3D-Szene des Hauses").click();

  await expect.element(handle).toHaveAttribute("aria-expanded", "true");
  await expect
    .element(
      page
        .getByRole("region", { name: "Szene bearbeiten" })
        .getByRole("heading", { name: "Baukörper 1" }),
    )
    .toBeVisible();
});

test("surroundings add a hedge, a ground surface and a fence, each opening its own level", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Umgebung", "Hecke hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Hecke 1" })).toBeVisible();
  await expect
    .element(inspector().getByRole("button", { name: starts("Länge (m)") }))
    .toBeVisible();

  await drill("Umgebung", "Fläche hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Pflaster 1" })).toBeVisible();
  await expect.element(inspector().getByRole("button", { name: starts("Belag") })).toBeVisible();

  await drill("Umgebung", "Zaun hinzufügen");
  await expect.element(inspector().getByRole("heading", { name: "Zaun 1" })).toBeVisible();
  expect(
    inspector()
      .getByRole("button", { name: starts("Letzten Punkt entfernen") })
      .query(),
  ).toBeNull();

  await drill("Punkt hinzufügen");
  await expect
    .element(inspector().getByRole("button", { name: starts("Punkt 3 x (m)") }))
    .toBeVisible();

  await drill("Umgebung", "Baum hinzufügen");
  await expect.element(inspector().getByRole("button", { name: starts("Krone") })).toBeVisible();
});

test("a deeper level is the drill-in's push, under the drill-in's header", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Gebäude");

  const title = inspector().getByRole("heading", { name: "Gebäude" });

  await expect.element(title).toBeVisible();

  const header = title.element().closest("[data-drill=header]");

  expect(header).not.toBeNull();
  expect(header?.closest("[data-push]")).not.toBeNull();

  await drill("Szene");
  await expect.element(inspector().getByRole("heading", { name: "Szene" })).toBeVisible();
  await expect.element(title).not.toBeInTheDocument();
});

/** What the open level's length row reads. */
const length = () =>
  inspector()
    .getByRole("button", { name: starts("Länge (m)") })
    .first()
    .element().textContent;

test("a removed object's level slides away as it was, not as the object after it", async () => {
  await render(Builder, {
    pv,
    core: connect(testCore()),
    start: house(),
    moduleTypes: [MODULE],
    devices: DEVICES,
  });

  await drill("Umgebung", "Hecke hinzufügen");
  await enter("Länge (m)", "7");
  await drill("Umgebung", "Hecke hinzufügen", "Umgebung", "Hecke 1");

  await expect.poll(length).toContain("7");

  // The slide runs, frame by frame.
  await undesk();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });

  try {
    await inspector().getByRole("button", { name: "Entfernen" }).click();
    await frames(3);

    // Still on its way out, it shows the hedge it was.
    const leaving = [...document.querySelectorAll("[data-push] section")].map((each) =>
      each.getAttribute("aria-label"),
    );

    expect(leaving).toContain("Hecke 1");
    expect(length()).toContain("7");
  } finally {
    realTimers();
  }
});

/** Form controls the browser draws in its own style; the slider and hidden pickers are styled or unseen. */
const PLAIN =
  "select, textarea, fieldset, input:not([data-slot='input']):not([type='range']):not(.sr-only)";

test("no level draws a default-styled form control; the time slider stays a slider", async () => {
  const screen = await gridOnTheSouthFace(testCore());
  const plain = () => [...screen.container.querySelectorAll(PLAIN)].map((node) => node.outerHTML);

  expect(plain()).toEqual([]);
  await drill("Module", "Szene", "Strings", "String hinzufügen");
  expect(plain()).toEqual([]);
  await drill("Strings", "Szene", "Umgebung", "Baum hinzufügen");
  expect(plain()).toEqual([]);
  await drill("Umgebung", "Szene", "Geräte", "Wechselrichter platzieren");
  expect(plain()).toEqual([]);
  await drill("Geräte", "Stellplatz hinzufügen");
  expect(plain()).toEqual([]);
  await drill("Geräte", "Szene", "Gebäude", "Baukörper 1");
  expect(plain()).toEqual([]);

  // The time still scrubs on a slider (ADR 21), the registry's, not the browser's.
  await expect
    .element(screen.getByRole("slider", { name: "Uhrzeit" }))
    .toHaveAttribute("data-slot", "slider-thumb");
});
