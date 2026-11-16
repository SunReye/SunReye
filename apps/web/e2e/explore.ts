// Explore's journey (ADR 22): a series added through the picker, the view kept over a reload.

import { back, inTurn, tap } from "./gestures.ts";
import type { Journey } from "./journeys.ts";

export const EXPLORE: Journey = {
  name: "explore: add a series, reload into the same view, switch modes",
  route: "explore",
  act: async (page) => {
    await tap(page, "Eingang 2 · Leistung");
    // The address follows a change once its movement is over.
    await page.waitForFunction(() =>
      decodeURIComponent(location.hash).includes("pv.mppt.power[2]"),
    );
    await page.reload();
    await page
      .getByRole("list", { name: "Gewählte Reihen" })
      .getByText("PV · Eingang 2 · Leistung")
      .waitFor();
    // The reload brought a new probe.
    await page.evaluate(() => {
      window.smoothness.start();
    });
    await inTurn(["Überlagern", "Falten", "Reihen"], (mode) => tap(page, mode, "radio"));
    // Back steps through the views.
    await back(page);
    await page.getByRole("radio", { name: "Falten", checked: true }).waitFor();
    await tap(page, "PV · Eingang 2 · Leistung entfernen");
  },
};

/** Fold (ADR 22): last month's PV power folded by day, sorted, then by week. */
export const FOLD: Journey = {
  name: "explore: fold a month by day, sort the table, fold by week",
  route: "explore?mode=fold",
  act: async (page) => {
    const table = page.getByRole("table", { name: "Statistik je Zeitraum" });
    const rows = table.locator("tbody tr");

    await tap(page, "Monat", "radio");
    await tap(page, "Früher");
    // A whole month folds by day: a row per day.
    await page.getByRole("radio", { name: "Tagen", exact: true, checked: true }).waitFor();
    await rows.nth(27).waitFor();

    if ((await rows.count()) > 31) throw new Error("a month folded into more rows than days");

    await inTurn(["Energie", "Energie", "Max"], (column) => tap(page, `Nach ${column} sortieren`));
    await table
      .getByRole("columnheader", { name: /Max/u })
      .and(page.locator('[aria-sort="descending"]'))
      .waitFor();
    await tap(page, "Wochen", "radio");
    await rows.nth(3).waitFor();

    if ((await rows.count()) > 6) throw new Error("a month folded into more rows than weeks");

    // Back returns to the fold by day.
    await back(page);
    await page.getByRole("radio", { name: "Tagen", exact: true, checked: true }).waitFor();
  },
};
