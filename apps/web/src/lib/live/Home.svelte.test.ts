import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import Home from "./Home.svelte";

test("the overview links to the solar forecast", async () => {
  const core = connect({
    base: "http://core.test/",
    fetch: () => Promise.resolve(new Response(null, { status: 404 })),
  });

  const screen = await render(Home, { core, layout: null });

  await expect
    .element(screen.getByRole("link", { name: "Prognose" }))
    .toHaveAttribute("href", "#/forecast");
});

test("the overview links to the status and logs", async () => {
  const core = connect({
    base: "http://core.test/",
    fetch: () => Promise.resolve(new Response(null, { status: 404 })),
  });

  const screen = await render(Home, { core, layout: null });

  await expect
    .element(screen.getByRole("link", { name: "Status" }))
    .toHaveAttribute("href", "#/status");
});
