import { createRawSnippet } from "svelte";
import { expect, test } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { Button } from "@sunreye/ui/button";

const children = createRawSnippet(() => ({ render: () => `<span>Speichern</span>` }));

/** The computed font size and line height of a Button of `size`, rendered alone. */
async function text(size: "default" | "sm" | "lg" | "icon" | "xs"): Promise<string[]> {
  const screen = await render(Button, { children, size });
  const { fontSize, lineHeight } = getComputedStyle(screen.getByRole("button").element());

  await screen.unmount();

  return [fontSize, lineHeight];
}

test("a button's text is 14 px on 20 px, 12 px when extra small, as before --button-text", async () => {
  expect(await text("default")).toEqual(["14px", "20px"]);
  expect(await text("sm")).toEqual(["14px", "20px"]);
  expect(await text("lg")).toEqual(["14px", "20px"]);
  expect(await text("icon")).toEqual(["14px", "20px"]);
  expect((await text("xs"))[0]).toBe("12px");
});

test("a consumer sets a button's text size with --button-text; extra small keeps its own", async () => {
  document.documentElement.style.setProperty("--button-text", "0.8125rem");

  try {
    expect((await text("default"))[0]).toBe("13px");
    expect((await text("sm"))[0]).toBe("13px");
    expect((await text("xs"))[0]).toBe("12px");
  } finally {
    document.documentElement.style.removeProperty("--button-text");
  }
});
