import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the settings route shows the settings", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("main")).toBeInTheDocument();
});
