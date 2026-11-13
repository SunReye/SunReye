import { expect, test, vi } from "vitest";
import { fade } from "./motion.ts";

test("a fade runs from nothing to full without reading the element's style", () => {
  // Reading it would force the arriving screen's whole style in the frame that mounts it.
  const read = vi.spyOn(window, "getComputedStyle");
  const faded = fade(document.createElement("div"));

  expect(read).not.toHaveBeenCalled();
  expect(faded.css?.(0.25, 0.75)).toBe("opacity: 0.25");
  expect(faded.css?.(1, 0)).toBe("opacity: 1");
  read.mockRestore();
});
