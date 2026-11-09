/// <reference types="bun" />
import { expect, test } from "bun:test";
import type { Problem } from "../api/core.ts";
import { modelLoader } from "./models.ts";

/** A GLB holding one triangle, its buffer embedded in the binary chunk. */
function triangle(): ArrayBuffer {
  const document = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 36 }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }),
  );

  const json = new Uint8Array(Math.ceil(document.length / 4) * 4).fill(0x20);

  json.set(document);

  const bin = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const total = 12 + 8 + json.length + 8 + bin.byteLength;
  const out = new DataView(new ArrayBuffer(total));

  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, total, true);
  out.setUint32(12, json.length, true);
  out.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out.buffer, 20).set(json);
  out.setUint32(20 + json.length, bin.byteLength, true);
  out.setUint32(24 + json.length, 0x004e4942, true);
  new Uint8Array(out.buffer, 28 + json.length).set(new Uint8Array(bin.buffer));

  return out.buffer;
}

test("an uploaded body is read once and parsed into its meshes", async () => {
  const asked: string[] = [];

  const load = modelLoader({
    carBody: (id) => {
      asked.push(id);

      return Promise.resolve(triangle());
    },
  });

  const [first, second] = await Promise.all([load("a"), load("a")]);

  expect(asked).toEqual(["a"]);
  expect(second).toBe(first);
  expect(first?.getObjectsByProperty("isMesh", true)).toHaveLength(1);
});

test("a body the core refuses or that does not parse is none", async () => {
  const load = modelLoader({
    carBody: (id) =>
      Promise.resolve<ArrayBuffer | Problem>(
        id === "gone" ? { problem: "car.none" } : new Uint8Array([1, 2, 3]).buffer,
      ),
  });

  expect(await load("gone")).toBeNull();
  expect(await load("broken")).toBeNull();
});
