import { createRawSnippet } from "svelte";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import "../../app.css";
import { Pressable } from "./ui/pressable/index.js";

const children = createRawSnippet(() => ({ render: () => `<span>Batterie</span>` }));

test("a pressable is a button that never submits a form and runs its press", async () => {
  const onclick = vi.fn<() => void>();
  const screen = await render(Pressable, { children, onclick });
  const button = screen.getByRole("button", { name: "Batterie" });

  await expect.element(button).toHaveAttribute("type", "button");

  await button.click();

  expect(onclick).toHaveBeenCalledTimes(1);
});

test("a pressable shows the app's focus ring to the keyboard and keeps the caller's layout", async () => {
  const screen = await render(Pressable, { children, class: "flex w-40" });
  const button = screen.getByRole("button").element();

  expect(getComputedStyle(button).display).toBe("flex");
  expect(getComputedStyle(button).outlineStyle).toBe("none");

  await vi.waitFor(async () => {
    button.blur();
    await Promise.resolve();
    // Keyboard focus, as `:focus-visible` wants it.
    button.focus({ focusVisible: true });
    expect(getComputedStyle(button).boxShadow).not.toBe("none");
  });
});

test("a disabled pressable takes no press", async () => {
  const onclick = vi.fn<() => void>();
  const screen = await render(Pressable, { children, onclick, disabled: true });

  await expect.element(screen.getByRole("button")).toBeDisabled();
  expect(getComputedStyle(screen.getByRole("button").element()).pointerEvents).toBe("none");
});
