import { afterEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import { realTimers } from "../motion/clock.harness.ts";
import { dragBy } from "../range/drag.harness.ts";
import { reset, show, YESTERDAY, zone } from "./statistics.harness.ts";
import StatisticsScreen from "./StatisticsScreen.svelte";

afterEach(() => {
  realTimers();
  reset();
});

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

test("the neighbour a finger uncovers, still loading, keeps the comparison's place in its legend: the card does not shrink and grow again", async () => {
  const { screen } = await show(`range=day&at=${YESTERDAY}`);

  await expect.poll(() => zone.read).toBe(true);

  const verdict = screen.getByText(/^Gestern hat die Anlage/u);

  await expect.element(verdict).toBeVisible();
  // The finger's pace, on the test's clock.
  vi.useFakeTimers({ toFake: ["performance"] });
  await dragBy(verdict.element(), -240, { hold: true });

  // Each pane's legend: the day shown, then the neighbours beside it, whose figures dash.
  const legends = [...document.querySelectorAll(".min-h-\\[348px\\] .pane")].map(
    (pane) => pane.querySelector("dl")?.textContent,
  );

  expect(legends.length).toBeGreaterThan(1);

  for (const legend of legends) expect(legend).toContain("Vortag");
});
