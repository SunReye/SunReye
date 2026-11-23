import { tick } from "svelte";
import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { motion } from "../../../../packages/builder/src/motion/tier.svelte.ts";
import "../app.css";
import Page from "./+page.svelte";
import { homeCore, restoreCore, serveCore, served } from "./home.harness.ts";
import { keepOffline } from "./route.harness.ts";

keepOffline();

beforeEach(serveCore);

afterEach(restoreCore);

test("a fresh core walks the owner through setup and ends on the live dashboard", async () => {
  served.session = "auth.setup";
  served.devices = [];
  served.live = { "1": { "grid.power": -300, "pv.power": 900 } };

  const screen = await render(Page, { context: homeCore() });

  await expect.element(screen.getByRole("heading", { name: "Einrichtung" })).toBeVisible();
  await userEvent.fill(
    screen.getByRole("region", { name: "Passwort" }).getByLabelText("Passwort", { exact: true }),
    "solar sun",
  );
  await userEvent.fill(screen.getByLabelText("Passwort wiederholen"), "solar sun");
  await screen.getByRole("button", { name: "Passwort festlegen" }).click();

  await expect.element(screen.getByRole("combobox", { name: "Zeitzone der Anlage" })).toBeVisible();
  await screen.getByRole("combobox", { name: "Zeitzone der Anlage" }).click();
  await userEvent.fill(page.getByPlaceholder("Zeitzone suchen"), "berlin");
  await page.getByRole("option", { name: "Europe/Berlin", exact: true }).click();
  await userEvent.fill(screen.getByLabelText("Breitengrad"), "52.52");
  await userEvent.fill(screen.getByLabelText("Längengrad"), "13.38");
  await screen.getByRole("button", { name: "Weiter" }).click();

  await screen.getByRole("button", { name: "Netzwerk durchsuchen" }).click();
  await expect
    .element(screen.getByRole("checkbox", { name: "SG05LP3 an 192.168.1.20:502, Adresse 1" }))
    .toBeChecked();
  await screen.getByRole("button", { name: "Ausgewählte Geräte hinzufügen" }).click();

  await expect.element(screen.getByRole("listitem", { name: "PV" })).toBeVisible();
  await screen.getByRole("button", { name: "Passt so" }).click();

  await expect
    .element(screen.getByRole("complementary", { name: "Szene bearbeiten" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Fertig, zur Übersicht" }).click();

  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();
});

test("under Home Assistant's ingress setup sets no password", async () => {
  // Ingress signs the request in before any password exists (ADR 9).
  served.devices = [];

  const screen = await render(Page, { context: homeCore() });

  await expect.element(screen.getByRole("combobox", { name: "Zeitzone der Anlage" })).toBeVisible();
  expect(screen.getByLabelText("Passwort wiederholen").query()).toBeNull();
});

test("a signed-out owner signs in to the dashboard", async () => {
  served.session = "auth.required";

  const screen = await render(Page, { context: homeCore() });

  await userEvent.fill(screen.getByLabelText("Passwort"), "solar sun");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();
});

test("a viewer signs in by name to the dashboard", async () => {
  served.session = "auth.required";

  const screen = await render(Page, { context: homeCore() });

  await screen.getByRole("radio", { name: "Betrachter" }).click();
  await userEvent.fill(screen.getByLabelText("Name"), "Oma");
  await userEvent.fill(screen.getByLabelText("Passwort"), "solar sun");
  await screen.getByRole("button", { name: "Anmelden" }).click();

  await expect.element(screen.getByRole("group", { name: "Heute" })).toBeVisible();
});

/** Setup on a phone, its password step open; back to the list, its updates drawn. */
async function backOnAPhone(): Promise<Element | null> {
  served.session = "auth.setup";
  served.devices = [];
  await page.viewport(390, 800);

  const screen = await render(Page, { context: homeCore() });

  await expect.element(screen.getByLabelText("Passwort wiederholen")).toBeVisible();
  await screen.getByRole("button", { name: "Einrichtung" }).click();
  await tick();

  return document.querySelector('[data-drill="page"]');
}

test("on the low-power switch a setup level leaves at once", async () => {
  motion.lowPower = true;

  expect(await backOnAPhone()).toBeNull();
});

test("under reduced motion a setup level leaves at once", async () => {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });

  try {
    expect(await backOnAPhone()).toBeNull();
  } finally {
    await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  }
});
