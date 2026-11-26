import { afterEach, expect, test } from "vitest";
import {
  BasicShadowMap,
  BoxGeometry,
  Color,
  CubeCamera,
  DirectionalLight,
  FloatType,
  Fog,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
} from "three";
import { aim, sky } from "../../../../../../packages/builder/src/scene/backdrop.ts";
import { daylight, theme } from "../../../../../../packages/builder/src/scene/light.ts";
import { skylight } from "../../../../../../packages/builder/src/scene/skylight.ts";
import { look } from "./probe.harness.ts";
import type { Level } from "../../../../../../packages/builder/src/scene/quality.ts";
import { SAMPLES } from "../../../../../../packages/builder/src/scene/refine.ts";
import { Studio } from "../../../../../../packages/builder/src/scene/studio.ts";

let studio: Studio | undefined;

function open(level: Level = "medium"): Studio {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  studio?.dispose();
  studio = new Studio(canvas, new PerspectiveCamera(40, 1, 0.1, 5000), () => look(level));
  studio.setSize(64, 64);

  return studio;
}

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

test("a studio is handed the GPU its canvas draws on, where the browser tells", () => {
  const canvas = document.createElement("canvas");
  let told: string | null | undefined;

  studio = new Studio(canvas, new PerspectiveCamera(40, 1, 0.1, 5000), (gpu) => {
    told = gpu;

    return look("medium");
  });

  // This host draws in software, and says so.
  expect(told).toMatch(/swiftshader|llvmpipe|angle/iu);
});

test("each level draws from its shadow map, with its occlusion and at its pixel ratio", () => {
  const opened = open("low");
  const device = window.devicePixelRatio;
  const facts = () => [opened.shadowMap, opened.occlusion, opened.pixelRatio];

  expect(facts()).toEqual([1024, false, Math.min(device, 1)]);
  opened.follow(look("medium"));
  expect(facts()).toEqual([2048, true, Math.min(device, 1.5)]);
  opened.follow(look("high"));
  expect(facts()).toEqual([4096, true, Math.min(device, 2)]);
  opened.follow(look("ultra"));
  expect(facts()).toEqual([4096, true, device]);
});

test("Mittel's shadow blurs by one radius; Hoch's widens with the caster's distance", () => {
  const opened = open("medium");
  const page = new Color(0.95, 0.95, 0.96);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const sun = () => opened.scene.children.find((child) => child instanceof DirectionalLight);

  opened.frame(new Vector3(), 10);
  opened.light(daylight([0, -0.5, 0.866]), theme(false), page);
  // The radius the full tier drew with, in texels.
  expect(sun()?.shadow.radius).toBe(3.5);
  expect(opened.renderer.shadowMap.type).toBe(PCFShadowMap);

  opened.follow(look("high"));
  // Raw depths, for the sampling that looks for the caster; the radius is per unit of depth.
  expect(opened.renderer.shadowMap.type).toBe(BasicShadowMap);
  expect(sun()?.shadow.radius).toBeGreaterThan(100);
});

test("a frame draws at every level, its programs sound", () => {
  for (const level of ["low", "medium", "high", "ultra"] as const) {
    const opened = open(level);
    const failed: string[] = [];

    const box = new Mesh(new BoxGeometry(4, 3, 4), new MeshStandardMaterial());

    box.castShadow = box.receiveShadow = true;

    opened.renderer.debug.onShaderError = () => {
      failed.push(level);
    };

    opened.frame(new Vector3(), 10);
    opened.light(daylight([0, -0.5, 0.866]), theme(false), new Color(0.95, 0.95, 0.96));
    opened.scene.add(box);
    opened.render();
    opened.refine();

    expect(failed).toEqual([]);
    expect([level, opened.renderer.getContext().getError()]).toEqual([level, 0]);
  }
});

test("Ultra refines a settled picture in a burst of frames, then stops; a draw starts it over", () => {
  const opened = open("ultra");

  const burst = () => {
    let frames = 0;

    while (opened.refine()) frames += 1;

    return frames + 1;
  };

  opened.light(daylight([0, -0.5, 0.866]), theme(false), new Color(0.95, 0.95, 0.96));
  opened.render();
  expect(burst()).toBe(SAMPLES);
  expect(opened.refine()).toBe(false);

  opened.render();
  expect(burst()).toBe(SAMPLES);
  expect(opened.renderer.getContext().getError()).toBe(0);
});

test("below Ultra a settled picture is left as drawn", () => {
  const opened = open("high");

  opened.render();

  expect(opened.refine()).toBe(false);
});

/** The drawn pixel at (`x`, `y`), its middle without. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function middle(opened: Studio, x = 32, y = 32): number[] {
  const gl = opened.renderer.getContext();
  const pixel = new Uint8Array(4);

  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

  return [...pixel.subarray(0, 3)];
}

test.each([
  ["light", false, [0.95, 0.95, 0.96]],
  ["dark", true, [0.012, 0.014, 0.02]],
  ["tinted", false, [0.9, 0.8, 0.6]],
] as const)(
  "an empty studio's backdrop lands on the %s page colour everywhere: no lighter middle, no darker rim",
  (_, dark, page) => {
    const opened = open();

    opened.light(daylight([0, -0.5, 0.866]), theme(dark), new Color(...page));
    opened.render();

    // The page colour, as sRGB bytes: what the hero's stand-in paints too.
    const wanted = page.map((v) => Math.round(new Color(v, v, v).convertLinearToSRGB().r * 255));

    for (const [x, y] of [
      [32, 32],
      [1, 1],
      [62, 62],
    ] as const) {
      for (const [i, byte] of middle(opened, x, y).entries()) {
        expect(Math.abs(byte - (wanted[i] ?? 0))).toBeLessThanOrEqual(1);
      }
    }
  },
);

test("light and dark themes change the background, the fog and the exposure", () => {
  const opened = open();
  const noon = daylight([0, -0.5, 0.866]);

  opened.light(noon, theme(false), new Color(0.95, 0.95, 0.96));

  const light = {
    exposure: opened.renderer.toneMappingExposure,
    background: opened.scene.background,
    fog: opened.scene.fog instanceof Fog ? opened.scene.fog.color.getHex() : null,
  };

  opened.light(noon, theme(true), new Color(0.01, 0.012, 0.016));

  expect(light.background).toBeInstanceOf(Texture);
  expect(opened.scene.background).toBeInstanceOf(Texture);
  expect(opened.scene.background).not.toBe(light.background);
  expect(opened.renderer.toneMappingExposure).toBeLessThan(light.exposure);
  expect(opened.scene.fog instanceof Fog ? opened.scene.fog.color.getHex() : null).not.toBe(
    light.fog,
  );
});

test("an overcast sky fades the sun's shadow out and dims the sun, with the one light", () => {
  const opened = open();
  const page = new Color(0.95, 0.95, 0.96);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const suns = () => opened.scene.children.filter((child) => child instanceof DirectionalLight);

  opened.light(daylight([0, -0.5, 0.866]), theme(false), page);

  const [clear] = suns();
  const before = { shadow: clear?.shadow.intensity, intensity: clear?.intensity ?? 0 };

  opened.light(daylight([0, -0.5, 0.866], 1), theme(false), page);

  expect([suns().length, before.shadow, suns()[0]?.shadow.intensity]).toEqual([1, 1, 0]);
  expect(suns()[0]?.intensity).toBeLessThan(before.intensity);
});

test("the sky model takes the light's clouds", () => {
  const model = sky(1000);
  const { clouds } = daylight([0, -0.5, 0.866], 1);

  aim(model, new Vector3(0, 0.866, 0.5), { dark: false, low: 0, clouds });

  expect(model.material.uniforms["cloudCoverage"]?.value).toBe(clouds.coverage);
  expect(model.material.uniforms["cloudDensity"]?.value).toBe(clouds.density);
});

const FACE = 32;

/** The sky model's light on a face turned up: pi times its mean radiance, weighted by cosine. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js reads with them.
function irradiance(renderer: WebGLRenderer, target: WebGLCubeRenderTarget): number {
  const pixels = new Float32Array(FACE * FACE * 4);
  let [light, weight] = [0, 0];

  // The cube's top face, from straight up out to 45°, and the upper halves of its sides.
  for (let face = 0; face < 6; face++) {
    renderer.readRenderTargetPixels(target, 0, 0, FACE, FACE, pixels, face);

    for (let y = 0; y < FACE; y++)
      for (let x = 0; x < FACE; x++) {
        const [u, v] = [((x + 0.5) / FACE) * 2 - 1, ((y + 0.5) / FACE) * 2 - 1];
        const up = [-v, -v, 1, -1, -v, -v][face] ?? 0;
        const length = Math.hypot(1, u, v);
        // The pixel's solid angle and its cosine to straight up.
        const share = Math.max(0, up / length) / length ** 3;
        const i = (y * FACE + x) * 4;

        light +=
          share *
          (0.2126 * (pixels[i] ?? 0) +
            0.7152 * (pixels[i + 1] ?? 0) +
            0.0722 * (pixels[i + 2] ?? 0));
        weight += share;
      }
  }

  return (light / weight) * Math.PI;
}

test("the light's table of the sky model's light holds for the model, clear and overcast", () => {
  const renderer = new WebGLRenderer({ canvas: document.createElement("canvas") });
  const target = new WebGLCubeRenderTarget(FACE, { type: FloatType });
  const camera = new CubeCamera(0.1, 2000, target);
  const scene = new Scene();
  const model = sky(1000);

  scene.add(model);

  try {
    for (const diffuse of [null, 1])
      for (const elevation of [1, 4, 7, 14, 21, 33, 45, 70]) {
        const radians = (elevation * Math.PI) / 180;
        const day = daylight([0, -Math.cos(radians), Math.sin(radians)], diffuse);

        aim(model, new Vector3(0, Math.sin(radians), Math.cos(radians)), {
          dark: false,
          low: day.haze,
          clouds: day.clouds,
        });
        camera.update(renderer, scene);

        const tabled = skylight(elevation, day.clouds.coverage);

        // Within a tenth, or 0.05 at a sun too low to light much.
        expect(Math.abs(irradiance(renderer, target) - tabled)).toBeLessThan(
          Math.max(0.05, tabled * 0.1),
        );
      }
  } finally {
    target.dispose();
    renderer.dispose();
  }
});
