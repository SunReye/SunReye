// A row of any kind takes the app's one tint under the pointer, and a chosen row its one tint
// (ADR 21 "One behaviour, one component").
import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import Rows from "./row-tints.harness.svelte";

// Still: the tint stands at once, where it would fade in.
beforeEach(() => {
  document.documentElement.dataset["motion"] = "still";
});

afterEach(() => {
  delete document.documentElement.dataset["motion"];
});

const background = (element: Element) => getComputedStyle(element).backgroundColor;

test("a button, a switch's row and a link take one tint under the pointer", async () => {
  await render(Rows);

  const rows = [
    page.getByRole("button", { name: "Knopf" }).element(),
    page.getByText("Schalter").element().closest("label"),
    page.getByRole("link").element(),
  ];
  const tints = [];

  for (const row of rows) {
    if (row === null) throw new Error("no row");
    const rest = background(row);

    await userEvent.hover(row);
    expect(background(row)).not.toBe(rest);
    tints.push(background(row));
  }

  expect(new Set(tints).size).toBe(1);
});

test("a chosen row takes one tint, whichever row it is", async () => {
  await render(Rows);

  const chosen = background(page.getByRole("button", { name: "Gewählt" }).element());

  expect(chosen).not.toBe("rgba(0, 0, 0, 0)");
  expect(background(page.getByRole("button", { name: "Offen" }).element())).toBe(chosen);
});
