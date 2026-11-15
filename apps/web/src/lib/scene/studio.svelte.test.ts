import { afterEach, expect, test } from "vitest";
import {
  Color,
  CubeCamera,
  DirectionalLight,
  FloatType,
  Fog,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  type WebGLProgramParametersWithUniforms,
} from "three";
import { aim, sky } from "./backdrop.ts";
import { daylight, theme } from "./light.ts";
import { skylight } from "./skylight.ts";
import type { MotionTier } from "../motion/tier.ts";
import { Studio } from "./studio.ts";
import { weathered } from "./weather.ts";

let studio: Studio | undefined;

function open(tier: MotionTier = "full"): Studio {
  const canvas = document.createElement("canvas");

  document.body.append(canvas);
  studio?.dispose();
  studio = new Studio(canvas, new PerspectiveCamera(40, 1, 0.1, 5000), tier);
  studio.setSize(64, 64);

  return studio;
}

afterEach(() => {
  studio?.dispose();
  studio = undefined;
});

test("the ambient-occlusion pass runs on the full motion tier only", () => {
  const opened = open();

  opened.follow("full");
  expect(opened.occlusion).toBe(true);
  opened.follow("lite");
  expect(opened.occlusion).toBe(false);
  opened.follow("still");
  expect(opened.occlusion).toBe(false);
});

type Sources = Pick<WebGLProgramParametersWithUniforms, "fragmentShader">;

/** Of all three.js hands a material before it compiles its program, the weathering needs these. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the patch fills it.
const isShader = (source: Sources): source is WebGLProgramParametersWithUniforms =>
  "fragmentShader" in source;

/** Whether a finish made now compiles weathered in `opened`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function weathers(opened: Studio): boolean {
  const shader = { uniforms: {}, vertexShader: "", fragmentShader: "#include <common>" };

  if (!isShader(shader)) throw new TypeError("no shader");

  weathered(new MeshStandardMaterial(), { colour: 0.2, rough: 0.1 }).onBeforeCompile(
    shader,
    opened.renderer,
  );

  return shader.fragmentShader.includes("weatherNoise");
}

test("a studio is made on its motion tier, so its first frame already draws the finishes for it", () => {
  expect(weathers(open("lite"))).toBe(false);
  expect(weathers(open("still"))).toBe(false);
  expect(weathers(open("full"))).toBe(true);
});

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

test("an overcast sky blurs the sun's shadow and dims the sun, with the one light", () => {
  const opened = open();
  const page = new Color(0.95, 0.95, 0.96);
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  const suns = () => opened.scene.children.filter((child) => child instanceof DirectionalLight);

  opened.light(daylight([0, -0.5, 0.866]), theme(false), page);

  const [clear] = suns();
  const before = { radius: clear?.shadow.radius ?? 0, intensity: clear?.intensity ?? 0 };

  opened.light(daylight([0, -0.5, 0.866], 1), theme(false), page);

  expect(suns()).toHaveLength(1);
  expect(suns()[0]?.shadow.radius).toBeGreaterThan(before.radius);
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
