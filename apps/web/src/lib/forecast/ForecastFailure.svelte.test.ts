import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect, type Transport } from "../api/core.ts";
import ForecastScreen from "./ForecastScreen.svelte";
import { card, PAST_WEEK, testCore, WEEK } from "./forecast.harness.ts";

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
