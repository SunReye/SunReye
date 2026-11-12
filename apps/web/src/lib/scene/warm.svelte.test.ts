import { expect, test } from "vitest";
import { GROUPS } from "./pixels.ts";
import { rememberedWebgl2, warm, warmed } from "./warm.ts";

test("the worker answers whether WebGL2 exists and hands over every material's maps", async () => {
  const { webgl2, textures } = warm();

  await expect(webgl2).resolves.toBe(true);
  await textures;

  expect(Object.keys(warmed).toSorted()).toEqual(Object.keys(GROUPS).toSorted());
  expect(Object.keys(warmed.plaster ?? {})).toEqual(Object.keys(GROUPS.plaster()));
  expect(rememberedWebgl2()).toBe(true);
});

test("materials made after the worker answered take its pixels", async () => {
  await warm().textures;

  const { plaster } = await import("./materials.ts");

  expect(plaster().map?.image.data).toBe(warmed.plaster?.["plaster.map"]?.data);
});
