// A motion token as a script reads it (ADR 21), however the stylesheet writes its time.
import { afterEach, expect, test } from "vitest";
import { tokenMs } from "@sunreye/ui/motion/token";

const el = document.createElement("div");

afterEach(() => {
  el.remove();
});

function written(time: string): number {
  el.style.setProperty("--motion-move", time);
  document.body.append(el);

  return tokenMs(el, "--motion-move");
}

test("a token in milliseconds reads as written", () => {
  expect(written("300ms")).toBe(300);
});

// The built stylesheet is minified: `300ms` ships as `.3s`.
test("a token in seconds, as the built stylesheet writes it, reads in milliseconds", () => {
  expect(written(".3s")).toBe(300);
});

test("a token of no time reads 0, in either unit", () => {
  expect(written("0ms")).toBe(0);
  expect(written("0s")).toBe(0);
});

test("a token left unset reads 0", () => {
  document.body.append(el);
  el.style.removeProperty("--motion-move");
  el.style.setProperty("--motion-move", "initial");

  expect(tokenMs(el, "--motion-move")).toBe(0);
});
