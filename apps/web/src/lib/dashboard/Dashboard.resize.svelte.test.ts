import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { connect } from "../api/core.ts";
import Dashboard from "./Dashboard.svelte";

/** A core that never answers: the page's layout does not wait for it. */
const held = () =>
  connect({ base: "http://core.test/", fetch: () => Promise.withResolvers<Response>().promise });

test("a phone's address bar showing or hiding moves nothing below the hero", async () => {
  await page.viewport(390, 844);

  const screen = await render(Dashboard, { core: held(), layout: null, admin: false });
  const below = screen.getByRole("group", { name: "Jetzt" });

  await expect.element(below).toBeVisible();

  const before = below.element().getBoundingClientRect().top;

  // The bar takes about 60 px of the viewport's height.
  await page.viewport(390, 784);
  await expect.poll(() => innerHeight).toBe(784);

  expect(below.element().getBoundingClientRect().top).toBe(before);
});
