/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A row of any kind takes the app's one tint under the pointer, and a chosen row its one tint
// (ADR 21 "One behaviour, one component").
import { afterEach, beforeEach, expect, test } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
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

    // oxlint-disable-next-line no-await-in-loop -- one row under the pointer at a time.
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

/** The tint `row` takes while the pointer holds it down. */
async function pressed(row: Element): Promise<string> {
  const box = row.getBoundingClientRect();

  const at = {
    x: box.left + 8,
    y: box.top + box.height / 2,
    button: "left",
    clickCount: 1,
  } as const;

  await cdp().send("Input.dispatchMouseEvent", { ...at, type: "mouseMoved" });
  await cdp().send("Input.dispatchMouseEvent", { ...at, type: "mousePressed" });

  const tint = background(row);

  await cdp().send("Input.dispatchMouseEvent", { ...at, type: "mouseReleased" });

  return tint;
}

test("a button and a link take one tint while pressed", async () => {
  await render(Rows);

  const button = page.getByRole("button", { name: "Knopf" }).element();
  const link = page.getByRole("link").element();

  // A link press would leave the test's page.
  link.addEventListener("click", (event) => {
    event.preventDefault();
  });

  expect(await pressed(link)).toBe(await pressed(button));
});
