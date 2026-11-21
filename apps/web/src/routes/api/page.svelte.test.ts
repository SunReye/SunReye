import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../../lib/api/core.ts";
import { API_DOCUMENT, BASE } from "../../lib/api/core.harness.ts";
import { coreContext } from "../../lib/shell/core.ts";
import Page from "./+page.svelte";
import { settle } from "../../lib/motion/clock.harness.ts";

test("the API route shows the core's document under its title", async () => {
  const screen = await render(Page, {
    context: coreContext(
      connect({ base: BASE, fetch: () => Promise.resolve(Response.json(API_DOCUMENT)) }),
    ),
  });

  await expect
    .element(screen.getByRole("heading", { level: 1, name: "API-Referenz" }))
    .toBeVisible();
  // Scalar is loaded and draws the document, as long as that takes.
  const operation = screen.getByRole("heading", { name: "Every saved view" });

  await settle(() => operation.query() !== null);
  await expect.element(operation).toBeVisible();
});
