import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { emptyCore, keepOffline } from "../route.harness.ts";
import Page from "./+page.svelte";

keepOffline();

test("the status route shows the log", async () => {
  const screen = await render(Page, { context: emptyCore() });

  await expect.element(screen.getByRole("heading", { name: "Protokoll" })).toBeVisible();
});
