import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../app.css";
import { connect } from "./api/core.ts";
import Controls from "./controls/Controls.svelte";
import Dashboard from "./dashboard/Dashboard.svelte";
import ForecastScreen from "./forecast/ForecastScreen.svelte";
import StatusScreen from "./status/StatusScreen.svelte";
import TariffScreen from "./tariff/TariffScreen.svelte";

/** A core that has not answered yet: every request, the live stream too, stays open. */
const held = () =>
  connect({ base: "http://core.test/", fetch: () => Promise.withResolvers<Response>().promise });

const ROUTE = { params: new URLSearchParams(), go: () => {} };

const loading = { name: "Wird geladen …" } as const;

test("Status stands its problems and its log in skeleton rows while the core answers", async () => {
  const screen = await render(StatusScreen, { core: held() });

  await expect
    .element(screen.getByRole("region", { name: "Probleme" }).getByRole("status", loading))
    .toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Protokoll" }).getByRole("status", loading))
    .toBeVisible();
});

test("Controls stand in skeleton rows while the core answers", async () => {
  const screen = await render(Controls, { core: held(), open: null, onnavigate: () => {} });

  await expect.element(screen.getByRole("status", loading)).toBeVisible();
});

test("Forecast stands a chart card in a skeleton while the core answers", async () => {
  const screen = await render(ForecastScreen, { core: held(), ...ROUTE });

  await expect.element(screen.getByRole("status", loading).first()).toBeVisible();
});

test("the Tariff page's current prices stand in a skeleton until the first live frame", async () => {
  const screen = await render(TariffScreen, { core: held(), ...ROUTE });

  await expect
    .element(screen.getByRole("region", { name: "Preise jetzt" }).getByRole("status", loading))
    .toBeVisible();
});

test("the spot price sheet's chart stands in a skeleton while the core answers", async () => {
  await page.viewport(1280, 900);

  const screen = await render(Dashboard, {
    core: held(),
    layout: null,
    admin: true,
    detail: "price",
  });

  await expect
    .element(screen.getByRole("dialog").getByRole("status", loading).first())
    .toBeVisible();
});
