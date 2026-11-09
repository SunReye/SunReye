import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the history route shows history and statistics and links back to the overview", async () => {
  const screen = await render(Page);

  await expect
    .element(screen.getByRole("link", { name: "Übersicht" }))
    .toHaveAttribute("href", "#/");
  await expect
    .element(screen.getByRole("heading", { name: "Verlauf und Statistik" }))
    .toBeVisible();
});
