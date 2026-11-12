import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import Page from "./+page.svelte";

test("the controls route shows the controls", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("main")).toBeInTheDocument();
});
