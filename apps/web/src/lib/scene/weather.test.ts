/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { patched, weatherFinishes, weathered } from "./weather.ts";

type Shader = WebGLProgramParametersWithUniforms;

/** What a patch reads of a program's parameters, and of the renderer nothing. */
type Sources = Pick<Shader, "uniforms" | "vertexShader" | "fragmentShader">;

interface Stub {
  readonly render: unknown;
}

/** Of all three.js hands a material before it compiles its program, a patch reads only these. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- the patches fill it.
const isShader = (source: Sources): source is Shader => "fragmentShader" in source;
const isRenderer = (renderer: Stub): renderer is WebGLRenderer => "render" in renderer;

/** The material's patches run on the chunks they replace. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function compiled(material: MeshStandardMaterial): Shader {
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <project_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>",
  };

  const renderer = { render: null };

  if (!isShader(shader) || !isRenderer(renderer)) throw new TypeError("no shader");

  material.onBeforeCompile(shader, renderer);

  return shader;
}

test("a later patch runs after an earlier one, and each tells its program apart", () => {
  const plain = new MeshStandardMaterial();
  const once = weathered(new MeshStandardMaterial(), { colour: 0.2, rough: 0.1 });

  const twice = patched(
    weathered(new MeshStandardMaterial(), { colour: 0.2, rough: 0.1 }),
    "fade",
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
    (shader) => {
      shader.fragmentShader += "\n// faded";
    },
  );

  expect(compiled(twice).fragmentShader).toContain("weatherNoise");
  expect(compiled(twice).fragmentShader.endsWith("// faded")).toBe(true);

  const keys = [plain, once, twice].map(
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
    (made) => made.customProgramCacheKey(),
  );

  expect(new Set(keys).size).toBe(3);
});

test("finishes weathered alike share a program, whatever their strengths", () => {
  const [lawn, gravel, wall] = [
    weathered(new MeshStandardMaterial(), { colour: 0.3, rough: 0.1, loose: true }),
    weathered(new MeshStandardMaterial(), { colour: 0.1, rough: 0.2, loose: true }),
    weathered(new MeshStandardMaterial(), { colour: 0.1, rough: 0.2, foot: 0.8 }),
  ];

  expect(lawn.customProgramCacheKey()).toBe(gravel.customProgramCacheKey());
  expect(wall.customProgramCacheKey()).not.toBe(lawn.customProgramCacheKey());
  expect(compiled(lawn).uniforms["uWeather"]?.value).toEqual([0.3, 0.1, 1]);
});

test("only loose ground samples its map at a second scale", () => {
  const loose = compiled(
    weathered(new MeshStandardMaterial(), { colour: 0.3, rough: 0.1, loose: true }),
  );

  const laid = compiled(weathered(new MeshStandardMaterial(), { colour: 0.3, rough: 0.1 }));

  expect(loose.fragmentShader).toContain("textureLod(map, mat2");
  expect(laid.fragmentShader).not.toContain("textureLod(map, mat2");
});

test("off the full motion tier a finish is drawn as it is, in a program of its own", () => {
  const lean = weathered(new MeshStandardMaterial(), { colour: 0.3, rough: 0.1, loose: true });
  const full = lean.customProgramCacheKey();

  weatherFinishes(false);

  const [shader, key] = [compiled(lean), lean.customProgramCacheKey()];

  weatherFinishes(true);

  expect(shader.fragmentShader).not.toContain("weatherNoise");
  expect(shader.uniforms).toEqual({});
  expect(key).not.toBe(full);
});
