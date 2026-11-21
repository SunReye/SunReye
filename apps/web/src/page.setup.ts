// Every test file's page runs in one tab of one origin: what a test leaves behind there steers the
// files after it.
import { afterEach } from "vitest";

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
