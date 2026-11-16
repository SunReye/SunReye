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
