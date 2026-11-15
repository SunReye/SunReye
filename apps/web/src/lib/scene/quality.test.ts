import { expect, test } from "bun:test";
import { capable, drawn, parseQuality, parseSteps, relief, type Device } from "./quality.ts";

const strong: Device = { capable: true, steps: 0, tier: "full" };
const weak: Device = { capable: false, steps: 0, tier: "full" };

test("Niedrig draws at a pixel ratio of 1 from a 1024 shadow map, bare", () => {
  expect(drawn("low", strong)).toEqual({
    level: "low",
    pixelRatio: 1,
    shadowMap: 1024,
    occlusion: false,
    weathering: false,
    rich: false,
    finest: false,
  });
});

test("Mittel draws what the full tier drew: a 2048 map, occlusion, weathering, up to 1.5", () => {
  expect(drawn("medium", strong)).toEqual({
    level: "medium",
    pixelRatio: 1.5,
    shadowMap: 2048,
    occlusion: true,
    weathering: true,
    rich: false,
    finest: false,
  });
});

test("Hoch adds its extras from a 4096 map, up to a pixel ratio of 2", () => {
  expect(drawn("high", weak)).toMatchObject({
    pixelRatio: 2,
    shadowMap: 4096,
    occlusion: true,
    weathering: true,
    rich: true,
    finest: false,
  });
});

test("Ultra adds its own at the device's pixel ratio", () => {
  expect(drawn("ultra", weak)).toMatchObject({
    pixelRatio: Infinity,
    shadowMap: 4096,
    rich: true,
    finest: true,
  });
});

test("Auto starts at Hoch on a capable GPU and at Mittel elsewhere", () => {
  expect(drawn("auto", strong).level).toBe("high");
  expect(drawn("auto", weak).level).toBe("medium");
});

test("Auto steps down a level per measured strain, never under Niedrig", () => {
  expect(drawn("auto", { ...strong, steps: 1 }).level).toBe("medium");
  expect(drawn("auto", { ...strong, steps: 2 }).level).toBe("low");
  expect(drawn("auto", { ...strong, steps: 9 }).level).toBe("low");
  expect(drawn("auto", { ...weak, steps: 1 }).level).toBe("low");
});

test("the lite and still tiers cap Auto at Mittel and drop its occlusion and weathering", () => {
  for (const tier of ["lite", "still"] as const) {
    expect(drawn("auto", { ...strong, tier })).toMatchObject({
      level: "medium",
      shadowMap: 2048,
      occlusion: false,
      weathering: false,
      rich: false,
    });
  }
});

test("a chosen level stays where it is, whatever the device", () => {
  const strained: Device = { capable: false, steps: 2, tier: "lite" };

  expect(drawn("ultra", strained)).toEqual(drawn("ultra", strong));
  expect(drawn("medium", strained)).toEqual(drawn("medium", strong));
});

test("a strain relieves Auto's drawing above Mittel before it touches the motion tier", () => {
  expect(relief("auto", strong)).toBe(true);
  expect(relief("auto", { ...strong, steps: 1 })).toBe(false);
  expect(relief("auto", weak)).toBe(false);
});

test("on lite, a further strain takes Auto from Mittel to Niedrig, and no further", () => {
  expect(relief("auto", { ...weak, tier: "lite" })).toBe(true);
  expect(relief("auto", { ...strong, steps: 1, tier: "lite" })).toBe(true);
  expect(relief("auto", { ...weak, steps: 1, tier: "lite" })).toBe(false);
});

test("a strain never moves a chosen level", () => {
  expect(relief("ultra", strong)).toBe(false);
  expect(relief("high", { ...strong, tier: "lite" })).toBe(false);
});

test("a discrete or recent integrated GPU is capable; software and old mobile GPUs are not", () => {
  for (const gpu of [
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    "Apple GPU",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Adreno (TM) 740",
    "Mali-G715",
  ]) {
    expect([gpu, capable(gpu)]).toEqual([gpu, true]);
  }

  for (const gpu of [
    "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
    "llvmpipe (LLVM 15.0.7, 256 bits)",
    "ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "Adreno (TM) 506",
    "Mali-G52",
    "Mali-T830",
    "PowerVR Rogue GE8320",
    "",
    null,
  ]) {
    expect([gpu, capable(gpu)]).toEqual([gpu, false]);
  }
});

test("an unreadable choice is Auto, and unreadable steps are none", () => {
  expect(parseQuality("ultra")).toBe("ultra");
  expect(parseQuality("epic")).toBe("auto");
  expect(parseQuality(null)).toBe("auto");
  expect(parseSteps("1")).toBe(1);
  expect(parseSteps("7")).toBe(2);
  expect(parseSteps("x")).toBe(0);
  expect(parseSteps(null)).toBe(0);
});
