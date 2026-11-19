import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../../lib/api/core.ts";
import { BASE } from "../../lib/api/core.harness.ts";
import { coreContext } from "../../lib/shell/core.ts";
import Page from "./+page.svelte";

const DOCUMENT = {
  openapi: "3.1.0",
  info: { title: "SunReye", version: "1" },
  paths: {
    "/api/v1/views": {
      get: { summary: "Every saved view", responses: { 200: { description: "The views" } } },
    },
  },
};

test("the API route shows the core's document under its title", async () => {
  const screen = await render(Page, {
    context: coreContext(
      connect({ base: BASE, fetch: () => Promise.resolve(Response.json(DOCUMENT)) }),
    ),
  });

  await expect
    .element(screen.getByRole("heading", { level: 1, name: "API-Referenz" }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Every saved view" }), { timeout: 15_000 })
    .toBeVisible();
});
