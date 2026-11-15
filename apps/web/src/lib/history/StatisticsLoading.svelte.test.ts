import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import StatisticsScreen from "./StatisticsScreen.svelte";

test("the chart and the breakdown stand in skeletons while the core answers", async () => {
  await page.viewport(1280, 900);

  const core = connect({
    base: "http://core.test/",
    fetch: () => Promise.withResolvers<Response>().promise,
  });

  const screen = await render(StatisticsScreen, {
    core,
    params: new URLSearchParams(),
    go: () => null,
  });

  const loading = screen.getByRole("status", { name: "Wird geladen …" });

  // The chart's place, then the breakdown's rows.
  await expect.poll(() => loading.all().length).toBe(2);
  await expect.element(loading.first()).toBeVisible();
  await expect
    .element(screen.getByRole("region", { name: "Aufschlüsselung" }).getByRole("status"))
    .toBeVisible();
});
