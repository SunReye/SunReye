// Every test file's page runs in one tab of one origin: what a test leaves behind there steers the
// files after it.
import { afterEach, beforeAll, beforeEach, inject } from "vitest";
import { cdp, commands } from "vitest/browser";
import { cleanup } from "vitest-browser-svelte/pure";
import { watchAnimations } from "./lib/motion/animations.harness.ts";
import { watchFrames } from "./lib/motion/clock.harness.ts";
import { emptyFrameLoop } from "./lib/motion/loop.harness.ts";
import { drain, watchDraws } from "./scene-draws.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** The file runs in the serial scene project, where WebGL may draw. */
    scene: boolean;
  }
}

// What the browser does only on a frame it draws, a test does when it waits on it.
watchFrames();

watchAnimations();

// Playwright knows the file's frame before the file's first command looks it up.
beforeAll(async () => {
  await commands.frameKnown();
});

// Each file starts with the mouse Playwright gives the tab. A tab whose touch emulation was ever
// set has none, for good: the file that set it belongs in a tab of its own (touch-tests.ts).
beforeAll(() => {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches)
    throw new Error(
      "This file starts without a mouse: a file before it in this tab emulated touch. touch-tests.ts gives such a file a tab of its own.",
    );
});

// Each test starts with the pointer off the page. Left at rest where an earlier test or file put
// it, it hovers what this test renders there, a frame later: an interactive card rises (#888).
// The last test's screen leaves first: still mounted while the pointer moves, it would answer
// what that test's own afterEach put back.
beforeEach(async () => {
  cleanup();
  // The last test's tweens leave Svelte's frame loop with its screen.
  emptyFrameLoop();
  await cdp().send("Input.dispatchMouseEvent", { type: "mouseMoved", x: -1, y: -1 });
});

const drawn = watchDraws([WebGLRenderingContext, WebGL2RenderingContext]);

afterEach(() => {
  const contexts = drawn();

  // Outside the scene project nothing draws with WebGL: every page shares one software renderer.
  if (!inject("scene") && contexts.size > 0)
    throw new Error(
      "This test drew with WebGL: list its file in scene-tests.ts, so it runs in the serial scene project.",
    );

  // A draw runs in the GPU process after its call returns. Waited for here, a test's draws are its
  // own: left queued, the next test's first call that waits on the GPU (a shader's compile) pays
  // for them, more the more the machine is loaded.
  for (const context of contexts) drain(context);
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
