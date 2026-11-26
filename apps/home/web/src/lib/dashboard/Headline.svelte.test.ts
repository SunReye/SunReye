import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import Headline from "./Headline.svelte";

const PLANT = { "pv.power": 3000, "load.power": 900 };

test("a broken stream stops the headline claiming now", async () => {
  const screen = await render(Headline, {
    live: { devices: { plant: PLANT }, lost: Date.now() },
    plant: PLANT,
    plantStale: undefined,
    figures: false,
    onselect: () => {},
  });

  await expect.element(screen.getByText("Erzeugung · Verbindung getrennt")).toBeVisible();
  await expect.element(screen.getByText("Erzeugung jetzt")).not.toBeInTheDocument();
});
