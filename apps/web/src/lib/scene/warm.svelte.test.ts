import { DataTexture } from "three";
import { expect, test } from "vitest";
import { GROUPS } from "../../../../../packages/builder/src/scene/pixels.ts";
import { rememberedWebgl2, warm, warmed } from "../../../../../packages/builder/src/scene/warm.ts";

test("the worker answers whether WebGL2 exists and hands over both groups' maps", async () => {
  const { webgl2, textures } = warm();

  await expect(webgl2).resolves.toBe(true);
  await textures;

  expect(Object.keys(warmed).toSorted()).toEqual(Object.keys(GROUPS).toSorted());
  expect(Object.keys(warmed.module ?? {})).toEqual(Object.keys(GROUPS.module()));
  expect(rememberedWebgl2()).toBe(true);
});

test("materials made after the worker answered take its pixels", async () => {
  await warm().textures;

  const { module } = await import("../../../../../packages/builder/src/scene/materials.ts");

  const { map } = module();

  expect(map instanceof DataTexture && map.image.data).toBe(warmed.module?.["module.map"]?.data);
});
