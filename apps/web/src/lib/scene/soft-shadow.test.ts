import { expect, test } from "bun:test";
import { ShaderChunk } from "three";
import { faced, penumbra, softened } from "./soft-shadow.ts";

const OPENS = "float getShadow( sampler2D shadowMap,";

test("only the basic shadow map's sampling is replaced: three.js's own soft shadow stays", () => {
  const chunk = ShaderChunk.shadowmap_pars_fragment;
  const soft = softened(chunk);
  const from = chunk.lastIndexOf(OPENS);
  const basic = chunk.slice(from);
  const replaced = soft.slice(from);

  expect(soft.slice(0, from)).toBe(chunk.slice(0, from));
  expect(basic).toContain("shadow = step( shadowCoord.z, depth );");
  expect(replaced).toContain("softDisk");
  expect(replaced).not.toContain("shadow = step( shadowCoord.z, depth );");
  // What follows the function is three.js's, untouched.
  const after = "#if NUM_SUN_LIGHT_SHADOWS > 0";

  expect(replaced.slice(replaced.indexOf(after))).toBe(basic.slice(basic.indexOf(after)));
});

test("a chunk without the basic sampling is refused, not left hard", () => {
  expect(() => softened("float getShadow() {}")).toThrow();
});

test("a penumbra is 2.8 cm wide per metre between caster and receiver, in texels", () => {
  // A 50 m wide, 100 m deep shadow camera on a 4096 map: a texel is 1.22 cm across and a metre
  // is a hundredth of the depth, so a caster 6 m off softens its edge over 6 × 2.8 / 1.22 texels.
  const perDepth = penumbra(100, 50, 4096);

  expect(perDepth * 0.06).toBeCloseTo((6 * 2.8) / (5000 / 4096), 5);
});

test("the offset a shadow is looked up at is turned toward the camera, and only that", () => {
  const chunk = ShaderChunk.shadowmap_vertex;
  const turned = faced(chunk);
  const flip = turned.split("\n").filter((line) => !chunk.includes(line.trim()));

  expect(flip).toHaveLength(1);
  expect(flip[0]).toContain("cameraPosition - worldPosition.xyz");
  expect(flip[0]).toContain("shadowWorldNormal = - shadowWorldNormal");
  // After the normal is found, before any light offsets along it.
  expect(turned.indexOf(flip[0] ?? "")).toBeGreaterThan(turned.indexOf("vec3 shadowWorldNormal ="));
  expect(turned.indexOf(flip[0] ?? "")).toBeLessThan(turned.indexOf("shadowNormalBias"));
});

test("a chunk without the normal offset is refused", () => {
  expect(() => faced("void main() {}")).toThrow();
});
