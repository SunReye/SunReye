// Explore's journeys (ADR 22): a series added through the picker and the view kept over a reload;
// two units charted in two lanes, read under the pointer and narrowed by a drag; today laid over
// yesterday.

import { back, drag, inTurn, tap } from "./gestures.ts";
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

export const EXPLORE_LANES: Journey = {
  name: "explore: two units in two lanes, read and narrowed",
  route: "explore",
  // The default view's reads have drawn its one lane of power.
  ready: async (page) => {
    await page.getByRole("img", { name: /^Bahn W: PV · Leistung, Haus · Leistung/u }).waitFor();
  },
  act: async (page) => {
    await tap(page, "Ladezustand");
    // A second unit stands in a lane of its own, under the first.
    await page.getByRole("img", { name: /^Bahn %: Batterie · Ladezustand/u }).waitFor();
    await page.getByRole("img", { name: /^Bahn W: PV · Leistung, Haus · Leistung/u }).waitFor();

    const plot = page.getByRole("group", { name: /^Reihen über die Zeit/u });
    const box = await plot.boundingBox();

    if (!box) throw new Error("the lanes have no plot");

    const at = (share: number) => [box.x + box.width * share, box.y + box.height / 2] as const;

    // Reading across the lanes moves one pointer and the legend, never the canvas.
    await page.mouse.move(...at(0.1));
    await page.mouse.move(...at(0.9), { steps: 40 });
    await drag(page, at(0.3), at(0.6));
    await page.waitForFunction(() => location.hash.includes("range=custom"));
    await page.getByRole("img", { name: /^Bahn %/u }).waitFor();
    await back(page);
  },
};

/** Overlay (ADR 22): today's PV power over yesterday's, each read under the pointer. */
export const OVERLAY: Journey = {
  name: "explore: overlay today with yesterday, read both, take it out",
  route: "explore?mode=overlay",
  ready: async (page) => {
    await page.getByRole("img", { name: "Bahn W: Heute" }).waitFor();
  },
  act: async (page) => {
    await tap(page, "Tag davor");
    await page.getByRole("img", { name: "Bahn W: Heute, Gestern" }).waitFor();
    await page.waitForFunction(() => location.hash.includes("vs=-1d"));

    const plot = page.getByRole("group", { name: /^PV · Leistung über die Zeiträume/u });
    const legend = page.getByRole("list", { name: "PV · Leistung über die Zeiträume" });
    const box = await plot.boundingBox();

    if (!box) throw new Error("the overlay has no plot");

    const at = (share: number) => [box.x + box.width * share, box.y + box.height / 2] as const;

    // One pointer reads both days at the same time of day.
    await page.mouse.move(...at(0.1));
    await page.mouse.move(...at(0.9), { steps: 40 });
    await page.mouse.move(...at(0.45), { steps: 20 });
    await inTurn(["Heute", "Gestern"], async (name) => {
      await legend
        .getByRole("listitem")
        .filter({ hasText: name })
        .getByText(/\d\sW$/u)
        .waitFor();
    });
    // Back takes the period out again.
    await back(page);
    await page.getByRole("img", { name: "Bahn W: Heute", exact: true }).waitFor();
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
