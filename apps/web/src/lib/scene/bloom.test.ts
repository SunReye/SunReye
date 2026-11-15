import { expect, test } from "bun:test";
import { glintFrom } from "./bloom.ts";
import { untone } from "./light.ts";

test("a glint blooms only past the tone curve's white", () => {
  // A dark page: the white point decides. A sunlit white wall, at 0.9 of white, stays crisp.
  const from = glintFrom(0.02, 0.5);

  expect(from).toBeGreaterThan(untone(0.9, 0.5) * 2);
});

test("a white page never blooms onto the house", () => {
  expect(glintFrom(1, 0.62)).toBeGreaterThan(untone(1, 0.62));
});
