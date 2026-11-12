import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the status route shows the log", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("heading", { name: "Protokoll" })).toBeVisible();
});
