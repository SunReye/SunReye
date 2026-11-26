import { expect, test } from "bun:test";
import { drain, watchDraws } from "./scene-draws.ts";

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

test("a draw on any WebGL context is seen on that context, and still drawn; a clear is no draw", () => {
  const one = context();
  const two = context();
  const drew = watchDraws([one.Fake, two.Fake]);
  const [a, b, c] = [new one.Fake(), new two.Fake(), new two.Fake()];

  a.clear();
  expect([...drew()]).toEqual([]);

  b.drawElements();
  c.drawArrays();
  b.drawArrays();
  const seen: unknown[] = [...drew()];

  expect(seen).toEqual([b, c]);
  expect(two.calls).toEqual(["drawElements", "drawArrays", "drawArrays"]);
  // Asked, they are forgotten: the next test starts clean.
  expect([...drew()]).toEqual([]);
});

/** A stand-in for a WebGL context that records how it is read. */
function readable(lost = false) {
  const calls: string[] = [];
  const bound = { name: "target" };

  const gl = {
    canvas: null,
    FRAMEBUFFER: 1,
    FRAMEBUFFER_BINDING: 2,
    RGBA: 3,
    UNSIGNED_BYTE: 4,
    isContextLost: () => lost,
    getParameter: (name: number) => (name === 2 ? bound : null),
    bindFramebuffer: (_target: number, framebuffer: WebGLFramebuffer | null) => {
      calls.push(
        framebuffer === null ? "bind null" : framebuffer === bound ? "bind target" : "bind ?",
      );
    },
    readPixels: (x: number, y: number, width: number, height: number) => {
      calls.push(`read ${x},${y} ${width}×${height}`);
    },
  };

  return { gl, calls };
}

test("a context drawn on is waited for by reading one pixel, its framebuffer put back", () => {
  const { gl, calls } = readable();

  drain(gl);

  expect(calls).toEqual(["bind null", "read 0,0 1×1", "bind target"]);
});

test("a lost context is not read", () => {
  const { gl, calls } = readable(true);

  drain(gl);

  expect(calls).toEqual([]);
});
