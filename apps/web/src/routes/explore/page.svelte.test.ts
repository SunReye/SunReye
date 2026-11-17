import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { emptyCore, keepOffline } from "../route.harness.ts";
import Page from "./+page.svelte";

keepOffline();

test("the explore route shows the Explore screen, named before any series is read", async () => {
  const screen = await render(Page, { context: emptyCore() });

  await expect.element(screen.getByRole("heading", { name: "Erkunden" })).toBeVisible();
  await expect.element(screen.getByText("PV · Leistung")).toBeVisible();
});
