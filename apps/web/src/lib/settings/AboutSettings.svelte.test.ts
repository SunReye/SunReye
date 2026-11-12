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
    ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  ] as const;

  await Promise.all(
    links.map(([name, href]) =>
      expect.element(screen.getByRole("link", { name })).toHaveAttribute("href", href),
    ),
  );
  await expect.element(screen.getByText(/ohne Innenraum, Embleme und Texturen/u)).toBeVisible();
});
