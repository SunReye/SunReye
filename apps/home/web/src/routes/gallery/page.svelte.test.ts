import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the gallery route shows the kit in development", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("heading", { name: "Gallery" })).toBeVisible();
});
