import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import Dashboard from "./Dashboard.svelte";

/** A core that has not answered yet: every request, the live stream too, stays open. */
const held = () =>
  connect({ base: "http://core.test/", fetch: () => Promise.withResolvers<Response>().promise });

test("today's curve stands in a skeleton of its size while the core answers", async () => {
  await page.viewport(1280, 900);

  const screen = await render(Dashboard, { core: held(), layout: null, admin: true });

  await expect
    .element(
      screen
        .getByRole("button", { name: "Tagesverlauf: Details" })
        .getByRole("status", { name: "Wird geladen …" }),
    )
    .toBeVisible();
});

test("a detail sheet's live graph stands in a skeleton until the first reading", async () => {
  await page.viewport(1280, 900);

  const screen = await render(Dashboard, {
    core: held(),
    layout: null,
    admin: true,
    detail: "production",
  });

  await expect
    .element(
      screen
        .getByRole("region", { name: "Live-Leistung" })
        .getByRole("status", { name: "Wird geladen …" }),
    )
    .toBeVisible();
});

test("the forecast sheet's day chart stands in a skeleton while the core answers", async () => {
  await page.viewport(1280, 900);

  const screen = await render(Dashboard, {
    core: held(),
    layout: null,
    admin: true,
    detail: "forecast",
  });

  await expect
    .element(screen.getByRole("dialog").getByRole("status", { name: "Wird geladen …" }))
    .toBeVisible();
});
