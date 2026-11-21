import { expect, test } from "bun:test";
import { watchDraws } from "./scene-draws.ts";

/** A stand-in for a WebGL context's prototype: what a draw call records. */
function context() {
  const calls: string[] = [];

  class Fake {
    readonly canvas = null;

    drawArrays() {
      calls.push("drawArrays");
    }

    drawElements() {
      calls.push("drawElements");
    }

    clear() {
      calls.push("clear");
    }
  }

  return { Fake, calls };
}

test("a draw on any WebGL context is seen, and still drawn; a clear or a probe is no draw", () => {
  const one = context();
  const two = context();
  const drew = watchDraws([one.Fake, two.Fake]);

  new one.Fake().clear();
  expect(drew()).toBe(false);

  new two.Fake().drawElements();
  expect(drew()).toBe(true);
  expect(two.calls).toEqual(["drawElements"]);
  // Asked, it is forgotten: the next test starts clean.
  expect(drew()).toBe(false);
});
