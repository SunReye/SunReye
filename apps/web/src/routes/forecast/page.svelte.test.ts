import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the forecast route shows the solar forecast and links back to the overview", async () => {
  const screen = await render(Page);

  await expect
    .element(screen.getByRole("link", { name: "Übersicht" }))
    .toHaveAttribute("href", "#/");
  await expect.element(screen.getByRole("heading", { name: "Solarprognose" })).toBeVisible();
});
