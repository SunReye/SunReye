import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { getLocale, setLocale } from "../lib/paraglide/runtime.js";
import Page from "./+page.svelte";

afterEach(async () => {
  await setLocale("de", { reload: false });
});

test("the home screen renders its main landmark", async () => {
  const screen = await render(Page);
  await expect.element(screen.getByRole("main")).toBeInTheDocument();
});

test("the screen is German until the owner picks English, which outlives a reload", async () => {
  const screen = await render(Page);

  await expect.element(screen.getByRole("combobox", { name: "Sprache" })).toBeVisible();
  expect(document.documentElement.lang).toBe("de");

  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Sprache" }).element(),
    "English",
  );

  await expect.element(screen.getByRole("combobox", { name: "Language" })).toBeVisible();
  expect(document.documentElement.lang).toBe("en");
  // The strategy reads local storage first, as a reload does.
  expect(getLocale()).toBe("en");
});
