import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import { setLocale } from "../paraglide/runtime.js";
import "../../app.css";
import Setup from "./Setup.svelte";

/** A fresh core: every write succeeds. */
const core = () =>
  connect({
    base: "http://core.test/",
    fetch: () => Promise.resolve(new Response(null, { status: 204 })),
  });

/** A phone, where the drill-in slides; levels land at once, as the tests read what they show. */
beforeEach(async () => {
  await page.viewport(390, 800);
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
});

afterEach(async () => {
  await cdp().send("Emulation.setEmulatedMedia", { features: [] });
  await setLocale("de", { reload: false });
});

test("the first run offers the language switch", async () => {
  const screen = await render(Setup, { core: core(), signedIn: false, onfinish: () => {} });

  await screen.getByRole("radio", { name: "English" }).click();

  await expect.element(screen.getByRole("heading", { name: "Setup" })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Set the password" })).toBeVisible();
});

test("setup opens on its first step, and back lists the steps with the next one open", async () => {
  const screen = await render(Setup, { core: core(), signedIn: false, onfinish: () => {} });

  await expect.element(screen.getByText("Schritt 1 von 5")).toBeVisible();
  await screen.getByRole("button", { name: "Einrichtung" }).click();

  await expect
    .element(screen.getByRole("button", { name: /^Passwort festlegen.*Als Nächstes/u }))
    .toBeEnabled();
  await expect.element(screen.getByRole("button", { name: /^Anlage.*Danach/u })).toBeDisabled();
  await screen.getByRole("button", { name: /^Passwort festlegen/u }).click();
  await expect.element(screen.getByLabelText("Passwort wiederholen")).toBeVisible();
});

test("a finished step opens the next one and cannot be run again", async () => {
  const screen = await render(Setup, { core: core(), signedIn: false, onfinish: () => {} });

  await userEvent.fill(screen.getByLabelText("Passwort", { exact: true }), "solar sun");
  await userEvent.fill(screen.getByLabelText("Passwort wiederholen"), "solar sun");
  await screen.getByRole("button", { name: "Passwort festlegen" }).click();

  await expect.element(screen.getByText("Schritt 2 von 5")).toBeVisible();
  await expect.element(screen.getByLabelText("Breitengrad")).toBeVisible();
  await screen.getByRole("button", { name: "Einrichtung" }).click();
  await expect
    .element(screen.getByRole("button", { name: /^Passwort festlegen.*Erledigt/u }))
    .toBeDisabled();
});

test("under Home Assistant's ingress setup counts no password step", async () => {
  const screen = await render(Setup, { core: core(), signedIn: true, onfinish: () => {} });

  await expect.element(screen.getByText("Schritt 1 von 4")).toBeVisible();
  await expect.element(screen.getByLabelText("Breitengrad")).toBeVisible();
});
