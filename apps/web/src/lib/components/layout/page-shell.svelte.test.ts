import { createRawSnippet } from "svelte";
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import PageShell from "./page-shell.svelte";

// The toolbar row: a back link at its left end, the page's controls hard right,
// and no row at all on a page that passes neither.

const html = (markup: string) => createRawSnippet(() => ({ render: () => markup }));
const BODY = html('<p data-testid="body">Body</p>');

afterEach(async () => {
  await page.viewport(414, 896);
});

const shell = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-slot="page-shell"]')!;

test("a page with neither a lead nor a toolbar starts with its body", async () => {
  const { container } = await render(PageShell, {
    width: "wide",
    children: BODY,
  });
  expect(shell(container).firstElementChild?.getAttribute("data-testid")).toBe("body");
});

test("the back link sits on the same line as the controls, ahead of them", async () => {
  await page.viewport(1280, 800);
  await render(PageShell, {
    width: "wide",
    lead: html('<a href="#/automations">Back</a>'),
    toolbar: html("<button>Range</button>"),
    children: BODY,
  });

  const lead = page.getByRole("link", { name: "Back" }).element().getBoundingClientRect();
  const control = page.getByRole("button", { name: "Range" }).element().getBoundingClientRect();
  const body = page.getByTestId("body").element().getBoundingClientRect();
  expect(Math.round(lead.top)).toBe(Math.round(control.top));
  expect(lead.right).toBeLessThan(control.left);
  // Not a row of its own under the toolbar: the body comes after both.
  expect(body.top).toBeGreaterThanOrEqual(lead.bottom);
});

test("the controls hold the right edge with or without a lead", async () => {
  await page.viewport(1280, 800);
  for (const lead of [undefined, html('<a href="#/">Back</a>')]) {
    const { container, unmount } = await render(PageShell, {
      width: "full",
      lead,
      toolbar: html("<button>Range</button>"),
      children: BODY,
    });
    const edge = shell(container).firstElementChild!.getBoundingClientRect().right;
    const control = page.getByRole("button", { name: "Range" }).element().getBoundingClientRect();
    expect(Math.abs(control.right - edge)).toBeLessThan(1);
    await unmount();
  }
});
