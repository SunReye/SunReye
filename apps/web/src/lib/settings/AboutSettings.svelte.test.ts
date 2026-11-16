import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import AboutSettings from "./AboutSettings.svelte";

test("About credits the default car under CC BY: title, author, source, licence and changes", async () => {
  const screen = await render(AboutSettings);

  const links = [
    [
      "2024 Tesla Model 3 + Interior",
      "https://sketchfab.com/3d-models/61ddcbdbd3854c239e0c95bf60b00022",
    ],
    ["tonielpro520", "https://sketchfab.com/tonielpro520"],
  ] as const;

  await Promise.all(
    links.map(([name, href]) =>
      expect.element(screen.getByRole("link", { name })).toHaveAttribute("href", href),
    ),
  );
  await expect.element(screen.getByText(/ohne Innenraum, Embleme und Texturen/u)).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "CC BY 4.0" }).first())
    .toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/");
});

test("About also credits the spot prices, as shown beside them", async () => {
  const screen = await render(AboutSettings);

  await expect.element(screen.getByText("Börsenstrompreis")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "energy-charts.info" }))
    .toHaveAttribute("href", "https://energy-charts.info");
  await expect
    .element(screen.getByRole("link", { name: "Bundesnetzagentur | SMARD.de" }))
    .toHaveAttribute("href", "https://www.smard.de");
  expect(screen.getByRole("link", { name: "CC BY 4.0" }).elements()).toHaveLength(2);
});

test("About credits the imported surroundings: OpenStreetMap and the terrain's sources", async () => {
  const screen = await render(AboutSettings);

  await expect.element(screen.getByText("Umgebung in 3D")).toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "© OpenStreetMap contributors" }))
    .toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect
    .element(
      screen.getByText(
        "Europe terrain data produced using Copernicus data and information funded by the European Union - EU-DEM layers",
      ),
    )
    .toBeVisible();
  expect(
    screen
      .getByRole("list", { name: "Geländehöhen aus den Terrain Tiles" })
      .getByRole("listitem")
      .elements(),
  ).toHaveLength(11);
});
