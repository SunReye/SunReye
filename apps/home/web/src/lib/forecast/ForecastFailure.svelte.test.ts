import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import { problemText } from "../i18n/problems.ts";
import ForecastScreen from "./ForecastScreen.svelte";
import { card, PAST_WEEK, testCore, WEEK } from "./forecast.harness.ts";

/** The test core, refusing with `code` each read whose path's last segment `refuses` names. */
function refusing(code: string, refuses: (last: string) => boolean): Transport {
  const core = testCore(WEEK);

  return {
    ...core,
    fetch: (request) => {
      const last = new URL(request.url).pathname.split("/").at(-1) ?? "";
      const status = code === "layout.none" ? 404 : 422;

      return refuses(last)
        ? Promise.resolve(Response.json({ status, code }, { status }))
        : core.fetch(request);
    },
  };
}

/** The test core, unreachable for each path's last segment that `down` names. */
function flaky(down: (last: string) => boolean): Transport {
  const core = testCore(WEEK);

  return {
    ...core,
    fetch: (request) => {
      const last = new URL(request.url).pathname.split("/").at(-1) ?? "";

      return down(last) ? Promise.reject(new TypeError("offline")) : core.fetch(request);
    },
  };
}

test("an unreachable core says the forecast could not be loaded, and loads again on request", async () => {
  let down = "layout";

  const screen = await render(ForecastScreen, {
    core: connect(flaky((last) => last === down)),
    ...PAST_WEEK,
  });

  const failed = screen.getByRole("alert");

  await expect.element(failed.getByText("Die Prognose konnte nicht geladen werden.")).toBeVisible();

  down = "";
  await failed.getByRole("button", { name: "Erneut laden" }).click();

  await expect
    .element(card(1).getByText("In KW 45 wurden 30,0 kWh erzeugt, 17 % weniger als vorhergesagt."))
    .toBeVisible();
});

test("a chart whose range cannot be read says so in its card, and reads again on request", async () => {
  let down = "statistics";

  await render(ForecastScreen, { core: connect(flaky((last) => last === down)), ...PAST_WEEK });

  const failed = card(1).getByRole("alert");

  await expect
    .element(failed.getByText("Dieser Zeitraum konnte nicht gelesen werden."))
    .toBeVisible();

  down = "";
  await failed.getByRole("button", { name: "Erneut laden" }).click();

  await expect
    .element(card(1).getByText("In KW 45 wurden 30,0 kWh erzeugt, 17 % weniger als vorhergesagt."))
    .toBeVisible();
});

test("a refused layout is failed too: the screen says the core's reason, not that no strings exist", async () => {
  let refused = true;

  const screen = await render(ForecastScreen, {
    core: connect(refusing("internal", (last) => refused && last === "layout")),
    ...PAST_WEEK,
  });

  const failed = screen.getByRole("alert");

  await expect.element(failed.getByText("Die Prognose konnte nicht geladen werden.")).toBeVisible();
  await expect.element(failed.getByText(problemText("internal"))).toBeVisible();
  expect(screen.getByText("Noch keine Strings angelegt.").query()).toBeNull();

  refused = false;
  await failed.getByRole("button", { name: "Erneut laden" }).click();
  await expect
    .element(card(1).getByText("In KW 45 wurden 30,0 kWh erzeugt, 17 % weniger als vorhergesagt."))
    .toBeVisible();
});

test("without a layout yet there are no strings, which the screen says", async () => {
  const screen = await render(ForecastScreen, {
    core: connect(refusing("layout.none", (last) => last === "layout")),
    ...PAST_WEEK,
  });

  await expect.element(screen.getByText("Noch keine Strings angelegt.")).toBeVisible();
  expect(screen.getByRole("alert").query()).toBeNull();
});

test("refused statistics fail the card with the core's reason, never an empty range", async () => {
  await render(ForecastScreen, {
    core: connect(refusing("history.range", (last) => last === "statistics")),
    ...PAST_WEEK,
  });

  const failed = card(1).getByRole("alert");

  await expect
    .element(failed.getByText("Dieser Zeitraum konnte nicht gelesen werden."))
    .toBeVisible();
  await expect.element(failed.getByText("Dieser Zeitraum ist leer oder zu lang.")).toBeVisible();
});

test("a refused forecast fails the card with the core's reason", async () => {
  await render(ForecastScreen, {
    core: connect(refusing("forecast.range", (last) => last === "forecasts")),
    ...PAST_WEEK,
  });

  await expect
    .element(card(1).getByRole("alert").getByText(problemText("forecast.range")))
    .toBeVisible();
});
