import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the history route shows the statistics screen", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("heading", { name: "Verlauf" })).toBeVisible();
});
