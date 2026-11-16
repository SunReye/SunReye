/// <reference types="bun" />
import { expect, test } from "bun:test";
import {
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from "three";
import { patched, perTree, weatherFinishes, weathered } from "./weather.ts";

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
    fragmentShader:
      "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>",
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

test("unweathered, a finish is drawn as it is, in a program of its own", () => {
  const lean = weathered(new MeshStandardMaterial(), { colour: 0.3, rough: 0.1, loose: true });
  const full = lean.customProgramCacheKey();

  weatherFinishes(false);

  const [shader, key] = [compiled(lean), lean.customProgramCacheKey()];

  weatherFinishes(true);

  expect(shader.fragmentShader).not.toContain("weatherNoise");
  expect(shader.uniforms).toEqual({});
  expect(key).not.toBe(full);
});

test("in relief, the variation also tilts the surface, in a program of its own", () => {
  const wall = weathered(new MeshStandardMaterial(), { colour: 0.1, rough: 0.1, relief: 0.012 });
  const flat = [compiled(wall), wall.customProgramCacheKey()] as const;

  weatherFinishes(true, true);

  const raised = [compiled(wall), wall.customProgramCacheKey()] as const;

  weatherFinishes(true);

  expect(flat[0].fragmentShader).not.toContain("weatherRelief");
  expect(raised[0].fragmentShader).toContain("normal = weatherRelief(normal");
  expect(raised[0].uniforms["uRelief"]?.value).toBe(0.012);
  expect(raised[1]).not.toBe(flat[1]);
});

test("an unweathered finish has no relief either", () => {
  const wall = weathered(new MeshStandardMaterial(), { colour: 0.1, rough: 0.1, relief: 0.012 });

  weatherFinishes(false, true);

  const shader = compiled(wall);

  weatherFinishes(true);

  expect(shader.fragmentShader).not.toContain("weatherRelief");
});

const plain = { colour: 0.1, rough: 0.1 } as const;

test("each laid stone takes its own tone, hue and lift, by the cell of its bond", () => {
  const laid = compiled(weathered(new MeshStandardMaterial(), { ...plain, cells: [4, 8, 0.5] }));
  const poured = compiled(weathered(new MeshStandardMaterial(), plain));

  expect(laid.uniforms["uCells"]?.value).toEqual([4, 8, 0.5]);
  // Every other course shifted, as the map lays them; then one cell per stone.
  expect(laid.fragmentShader).toContain("mod(floor(weatherStone.y), 2.0) * uCells.z");
  expect(laid.fragmentShader).toContain("weatherHash(weatherCell + 0.5)");
  expect(laid.fragmentShader).toContain("tbn[0] * (weatherHash(weatherCell + 3.1) - 0.5)");
  expect(poured.fragmentShader).not.toContain("weatherCell");
});

test("every finish drifts at a scale of metres and again at its grain's", () => {
  const shader = compiled(weathered(new MeshStandardMaterial(), plain)).fragmentShader;

  expect(shader).toContain("weatherNoise(weatherAt * 0.13)");
  expect(shader).toContain("weatherNoise(weatherAt * 11.0 + 43.0)");
});

test("each kind of finish gathers what its kind does, and no other's", () => {
  const kinds = {
    roof: { ...plain, roof: true },
    wall: { ...plain, foot: 0.8 },
    lawn: { ...plain, clover: true },
    feet: { ...plain, wear: "feet" },
    wheels: { ...plain, wear: "wheels" },
  } as const;

  const marks = {
    roof: "weatherMoss",
    wall: "weatherPatch",
    lawn: "weatherClover",
    feet: "smoothstep(0.2, 0.8, abs(vWeatherWear.x))",
    wheels: "abs(abs(vWeatherWear.x) - 0.5)",
  } as const;

  const names = ["roof", "wall", "lawn", "feet", "wheels"] as const;
  const made = names.map((name) => weathered(new MeshStandardMaterial(), kinds[name]));
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  const shaders = made.map((material) => compiled(material).fragmentShader);

  for (const [i, name] of names.entries()) {
    expect(names.filter((_, j) => shaders[j]?.includes(marks[name]) === true)).toEqual([name]);
    expect(shaders[i]).toContain(marks[name]);
  }

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  expect(new Set(made.map((material) => material.customProgramCacheKey())).size).toBe(5);
});

test("a roof's moss keeps to the side turned from the sun and the metres above the eave", () => {
  const roof = compiled(weathered(new MeshStandardMaterial(), { ...plain, roof: true }));

  expect(roof.vertexShader).toContain("attribute vec2 fall;");
  expect(roof.fragmentShader).toContain("0.25 - weatherFace.z * 1.5");
  expect(roof.fragmentShader).toContain("1.0 - smoothstep(0.0, 1.4, vWeatherFall.x)");
});

test("a tree's leaves and bark take the tree's own cast, and plain they keep their own", () => {
  const leaves = perTree(new MeshStandardMaterial());

  const shader = () => {
    const made = {
      uniforms: {},
      vertexShader: "",
      fragmentShader: "#include <common>\n#include <color_fragment>",
    };

    const renderer = { render: null };

    if (!isShader(made) || !isRenderer(renderer)) throw new TypeError("no shader");

    leaves.onBeforeCompile(made, renderer);

    return made.fragmentShader;
  };

  expect(shader()).toContain("weatherHash(weatherStood)");

  weatherFinishes(false);

  const bare = shader();

  weatherFinishes(true);

  expect(bare).toBe("#include <common>\n#include <color_fragment>");
});
