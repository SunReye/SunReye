import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../app.css";
import ErrorPage from "./+error.svelte";

test("a route's error shows the app's error screen", async () => {
  const screen = await render(ErrorPage);

  await expect.element(screen.getByRole("link", { name: "Zum Dashboard" })).toBeVisible();
});
