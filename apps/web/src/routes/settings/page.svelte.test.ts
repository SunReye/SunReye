import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { emptyCore, keepOffline } from "../route.harness.ts";
import Page from "./+page.svelte";

keepOffline();

test("the settings route shows the settings", async () => {
  const screen = await render(Page, { context: emptyCore() });

  await expect.element(screen.getByRole("heading", { name: "Einstellungen" })).toBeInTheDocument();
});
