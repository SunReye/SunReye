/* oxlint-disable typescript/prefer-readonly-parameter-types -- the DOM, used in place. */
// A link inside text is one link, with one focus ring (ADR 21 "One behaviour, one component").
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import Links from "./text-link.harness.svelte";

// Still: the ring stands at once, where it would fade in.
beforeEach(() => {
  document.documentElement.dataset["motion"] = "still";
});

afterEach(() => {
  delete document.documentElement.dataset["motion"];
});

/** The ring the keyboard's focus draws on `element`. */
async function ring(element: HTMLElement | SVGElement): Promise<string> {
  let shadow = "none";

  await vi.waitFor(async () => {
    element.blur();
    await Promise.resolve();
    // Keyboard focus, as `:focus-visible` wants it.
    element.focus({ focusVisible: true });
    shadow = getComputedStyle(element).boxShadow;
    expect(shadow).not.toBe("none");
  });

  return shadow;
}

test("a link to a screen and a link that acts read as one link and take one focus ring", async () => {
  const onclick = vi.fn<() => void>();

  await render(Links, { onclick });

  const to = page.getByRole("link", { name: "Protokoll" });
  const acts = page.getByRole("button", { name: "Erneut laden" });

  await expect.element(to).toHaveAttribute("href", "#/settings?group=logs");
  expect(getComputedStyle(acts.element()).color).toBe(getComputedStyle(to.element()).color);
  expect(await ring(acts.element())).toBe(await ring(to.element()));

  await acts.click();

  expect(onclick).toHaveBeenCalledOnce();
});
