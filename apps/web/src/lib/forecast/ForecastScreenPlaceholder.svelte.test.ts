// A placeholder stands at the size of what replaces it, loading and empty alike (ADR 21).
import { beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import ForecastScreen from "./ForecastScreen.svelte";
import { card, PAST_WEEK, testCore, WEEK } from "./forecast.harness.ts";

/** The test core, its layout answered by `layout`. */
function laidOut(layout: (request: Request) => Promise<Response>): Transport {
  const core = testCore(WEEK);

  return {
    ...core,
    fetch: (request) =>
      new URL(request.url).pathname.endsWith("/layout") ? layout(request) : core.fetch(request),
  };
}

beforeEach(async () => {
  await page.viewport(390, 800);
});

const cardHeight = () =>
  page.getByRole("main").element().querySelector("[data-slot=card]")?.getBoundingClientRect()
    .height;

test("without strings the forecast stands in a card at the loading card's size", async () => {
  const loading = await render(ForecastScreen, {
    core: connect(laidOut(() => new Promise(() => {}))),
    ...PAST_WEEK,
  });

  await expect.element(page.getByRole("status")).toBeVisible();
  const loadingHeight = cardHeight();

  await loading.unmount();
  await render(ForecastScreen, {
    core: connect(
      laidOut(() =>
        Promise.resolve(
          Response.json({ appliesFrom: "2026-11-01T00:00:00Z", warnings: [], strings: [] }),
        ),
      ),
    ),
    ...PAST_WEEK,
  });

  await expect.element(page.getByText("Noch keine Strings angelegt.")).toBeVisible();
  expect(cardHeight()).toBe(loadingHeight);
});

test("the loading card stands at an inverter's card's size", async () => {
  const loading = await render(ForecastScreen, {
    core: connect(laidOut(() => new Promise(() => {}))),
    ...PAST_WEEK,
  });

  await expect.element(page.getByRole("status")).toBeVisible();
  const loadingHeight = cardHeight() ?? 0;

  await loading.unmount();
  await render(ForecastScreen, { core: connect(testCore(WEEK)), ...PAST_WEEK });

  await expect
    .element(card(1).getByText("In KW 45 wurden 30,0 kWh erzeugt, 17 % weniger als vorhergesagt."))
    .toBeVisible();
  // Within a line of the card it stands for.
  expect(Math.abs(card(1).element().getBoundingClientRect().height - loadingHeight)).toBeLessThan(
    24,
  );
});
