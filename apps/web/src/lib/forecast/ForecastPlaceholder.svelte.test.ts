// A placeholder stands at the size of what replaces it, loading and empty alike (ADR 21).
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import type { AheadReader } from "./ahead-read.ts";
import { show } from "./forecast-detail.harness.ts";
import ForecastDetail from "./ForecastDetail.svelte";

const days = () => page.getByRole("region", { name: "PV-Prognose nach Tagen" });

/** A read that never lands. */
const never = () => Promise.withResolvers<never>().promise;

const height = () => days().element().getBoundingClientRect().height;

test("loading and without a forecast the days stand at the size of a day's forecast", async () => {
  const { screen } = await show();

  await expect.element(screen.getByRole("tab", { name: "Heute" })).toBeVisible();
  const loaded = height();

  await screen.unmount();
  const empty = await show({});

  await expect.element(empty.screen.getByText("Keine Prognose")).toBeVisible();
  const none = height();

  await empty.screen.unmount();
  // Not read yet: the dashboard has not handed today over.
  const core: AheadReader = { layout: never, forecasts: never, statistics: never, history: never };

  await render(ForecastDetail, { core, day: undefined });

  await expect.element(page.getByRole("status")).toBeVisible();

  expect(height()).toBe(none);
  // Within a line of the day it stands for.
  expect(Math.abs(none - loaded)).toBeLessThan(24);
});
