import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { connect } from "../api/core.ts";
import { setLocale } from "../paraglide/runtime.js";
import Setup from "./Setup.svelte";

afterEach(async () => {
  await setLocale("de", { reload: false });
});

test("the first run offers the language switch", async () => {
  const core = connect({
    base: "http://core.test/",
    fetch: () => Promise.resolve(new Response(null, { status: 204 })),
  });

  const screen = await render(Setup, { core, signedIn: false, onfinish: () => {} });

  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sprache" }), "en");

  await expect.element(screen.getByRole("heading", { name: "Setup" })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Set the password" })).toBeVisible();
});
