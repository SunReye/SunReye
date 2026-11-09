import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import SpotPriceCard from "./SpotPriceCard.svelte";

test("the spot price shows in ct/kWh with the source's CC BY attribution", async () => {
  const card = await render(SpotPriceCard, { values: { "price.spot": 0.24601 } });

  await expect.element(card.getByRole("heading", { name: "Börsenstrompreis" })).toBeVisible();
  await expect.element(card.getByText("24,60 ct/kWh")).toBeVisible();
  // CC BY 4.0 asks for the source, the licence with its link, and the change made.
  await expect
    .element(card.getByRole("link", { name: "Bundesnetzagentur | SMARD.de" }))
    .toHaveAttribute("href", "https://www.smard.de");
  await expect
    .element(card.getByRole("link", { name: "CC BY 4.0" }))
    .toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
  await expect
    .element(card.getByRole("link", { name: "energy-charts.info" }))
    .toHaveAttribute("href", "https://energy-charts.info");
  await expect.element(card.getByText(/umgerechnet von EUR\/MWh/u)).toBeVisible();
});

test("a negative spot price keeps its sign", async () => {
  const card = await render(SpotPriceCard, { values: { "price.spot": -0.0005 } });

  await expect.element(card.getByText("-0,05 ct/kWh")).toBeVisible();
});
