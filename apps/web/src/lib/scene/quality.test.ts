import { expect, test } from "bun:test";
import { capable, drawn, parseQuality, parseSteps, relief, type Device } from "./quality.ts";

const strong: Device = { capable: true, touch: false, steps: 0, tier: "full" };
const weak: Device = { capable: false, touch: false, steps: 0, tier: "full" };

test("Niedrig draws as the lite tier did, at a pixel ratio of 1 from a 1024 shadow map", () => {
  expect(drawn("low", strong)).toEqual({
    level: "low",
    pixelRatio: 1,
    shadowMap: 1024,
    occlusion: false,
    occluded: 0.75,
    samples: 8,
    glass: false,
    contact: false,
    finest: false,
  });
});

test("Mittel draws from a 2048 map at up to 1.5, its occlusion at half that from 8 samples", () => {
  expect(drawn("medium", strong)).toEqual({
    level: "medium",
    pixelRatio: 1.5,
    shadowMap: 2048,
    occlusion: true,
    occluded: 0.75,
    samples: 8,
    glass: true,
    contact: false,
    finest: false,
  });
});

test("Hoch only sharpens Mittel: contact shadows from a 4096 map, up to 2, finer occlusion", () => {
  expect(drawn("high", weak)).toEqual({
    ...drawn("medium", weak),
    level: "high",
    pixelRatio: 2,
    shadowMap: 4096,
    occluded: 1.5,
    samples: 12,
    contact: true,
  });
});

test("Ultra only sharpens Hoch: its burst and full occlusion at the device's pixel ratio", () => {
  expect(drawn("ultra", weak)).toEqual({
    ...drawn("high", weak),
    level: "ultra",
    pixelRatio: Infinity,
    occluded: Infinity,
    finest: true,
  });
});

test("Auto starts at Hoch on a capable GPU and at Mittel elsewhere", () => {
  expect(drawn("auto", strong).level).toBe("high");
  expect(drawn("auto", weak).level).toBe("medium");
});

test("Auto starts a touch device at Mittel, whatever its GPU is called; Hoch stays a choice", () => {
  const phone: Device = { ...strong, touch: true };

  expect(drawn("auto", phone).level).toBe("medium");
  expect(drawn("auto", { ...weak, touch: true }).level).toBe("medium");
  expect(drawn("high", phone).level).toBe("high");
  // Its first strain is the motion tier's, as at Mittel anywhere; the next takes Niedrig.
  expect(relief("auto", phone)).toBe(false);
  expect(relief("auto", { ...phone, tier: "lite" })).toBe(true);
  expect(drawn("auto", { ...phone, steps: 1, tier: "lite" }).level).toBe("low");
});

test("Auto steps down a level per measured strain, never under Niedrig", () => {
  expect(drawn("auto", { ...strong, steps: 1 }).level).toBe("medium");
  expect(drawn("auto", { ...strong, steps: 2 }).level).toBe("low");
  expect(drawn("auto", { ...strong, steps: 9 }).level).toBe("low");
  expect(drawn("auto", { ...weak, steps: 1 }).level).toBe("low");
});

test("the lite and still tiers cap Auto at Mittel", () => {
  for (const tier of ["lite", "still"] as const) {
    expect(drawn("auto", { ...strong, tier })).toMatchObject({ level: "medium", shadowMap: 2048 });
  }
});

test("the lite and still tiers drop occlusion and the lens glass at every level", () => {
  for (const tier of ["lite", "still"] as const) {
    for (const choice of ["auto", "medium", "high", "ultra"] as const) {
      const { occlusion, glass } = drawn(choice, { ...strong, tier });

      expect([choice, occlusion, glass]).toEqual([choice, false, false]);
    }
  }
});

test("a chosen level keeps its sharpness, whatever the device", () => {
  const strained: Device = { capable: false, touch: false, steps: 2, tier: "lite" };

  expect(drawn("ultra", strained)).toMatchObject({
    level: "ultra",
    pixelRatio: Infinity,
    shadowMap: 4096,
    contact: true,
    finest: true,
  });
  expect(drawn("medium", { ...strained, tier: "full" })).toEqual(drawn("medium", strong));
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
