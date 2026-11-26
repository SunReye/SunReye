/// <reference types="@vitest/browser-playwright" />
// The component tests' own browser commands, run beside Playwright in the test runner.
import type { BrowserCommand } from "vitest/node";

/** Vitest names each test file's frame so, and looks it up by name for every Playwright command. */
const NAME = "vitest-iframe";

/**
 * Resolves once Playwright knows the frame the test file runs in. Vitest gives Playwright a second
 * to find it at each command; while the runner's own work holds Playwright's events back, the
 * file's first command found none.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's page, only read.
export const frameKnown: BrowserCommand = async ({ page, testPath }) => {
  if (testPath === undefined) return;

  const id = `iframeId=${encodeURIComponent(testPath)}`;

  const known = (): boolean =>
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- Playwright's frame, only read.
    page.frames().some((frame) => frame.name() === NAME && frame.url().includes(id));

  if (known()) return;

  await new Promise<void>((found) => {
    const look = (): void => {
      if (!known()) return;

      page.off("framenavigated", look);
      found();
    };

    page.on("framenavigated", look);
  });
};

declare module "vitest/browser" {
  interface BrowserCommands {
    frameKnown: () => Promise<void>;
  }
}
