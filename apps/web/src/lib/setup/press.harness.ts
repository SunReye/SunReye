// Test harness: a press that no load can run out of time.
import { expect } from "vitest";
import type { Locator } from "vitest/browser";

/**
 * Presses what `target` finds as a DOM click, once it is enabled. A pointer's click waits until
 * the target holds still over two frames, which a loaded machine spaces out past the test's budget;
 * for a test of what a press does, not of where the pointer lands.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- vitest's locator, only read.
export async function pressEnabled(target: Locator): Promise<void> {
  await expect.element(target).toBeEnabled();

  const element = target.element();

  if (element instanceof HTMLElement) element.click();
}
