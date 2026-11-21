// Every test file's page runs in one tab of one origin: what a test leaves behind there steers the
// files after it.
import { afterEach, beforeAll } from "vitest";
import { commands } from "vitest/browser";
import { watchAnimations } from "./lib/motion/animations.harness.ts";
import { watchFrames } from "./lib/motion/clock.harness.ts";

// What the browser does only on a frame it draws, a test does when it waits on it.
watchFrames();

watchAnimations();

// Playwright knows the file's frame before the file's first command looks it up.
beforeAll(async () => {
  await commands.frameKnown();
});

afterEach(() => {
  // A browser remembered without WebGL2, the 2D view chosen.
  localStorage.clear();
  sessionStorage.clear();

  // The runner sizes the tab once and remembers it: a tab resized behind its back (an emulated
  // screen cleared) leaves later files' controls off screen, where no click lands.
  if (parent.innerWidth !== innerWidth || parent.innerHeight !== innerHeight)
    throw new Error(
      `The tab is ${parent.innerWidth}×${parent.innerHeight}, the page ${innerWidth}×${innerHeight}: put the tab's size back.`,
    );
});
