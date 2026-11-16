// Weathering and variation for the generated finishes (ADR 20 Look): each varies like the real
// thing, from shader arithmetic that never repeats, so no tiling shows at any zoom. One shader
// patch per finish, no texture and no pass of its own; what it computes is in `./variation`.
import {
  Color,
  DataTexture,
  type Material,
  type MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three";

import {
  colour,
  DECLARED,
  kindOf,
  roughness,
  SOIL,
  surface,
  TREE,
  VERTEX,
  type Weather,
} from "./variation.ts";

export type { Weather } from "./variation.ts";

/** Off on Niedrig alone: from Mittel up every finish varies (ADR 20). */
let extras = true;

/** Hoch's: the variation also tilts the surface, so a wall or a lawn is never a flat sheet. */
let relief = false;

/**
 * Whether finishes weather from here on, and whether in relief. A finish reads it as its program
 * is made: a studio sets it as it is made, and makes its finishes' programs again on a change.
 */
export function weatherFinishes(on: boolean, raised = false): void {
  extras = on;
  relief = on && raised;
}

export type Shader = WebGLProgramParametersWithUniforms;

const means = new Map<DataTexture, Color>();

/** A map's mean albedo in linear light. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only; three.js's texture.
export function mean(made: DataTexture): Color {
  const known = means.get(made);

  if (known !== undefined) return known;

  const data: ArrayLike<number> = made.image.data ?? [];
  const sum = new Color(0, 0, 0);
  const texel = new Color();

  for (let i = 0; i + 2 < data.length; i += 4) {
    sum.add(
      texel
        .fromArray(data, i)
        .multiplyScalar(1 / 255)
        .convertSRGBToLinear(),
    );
  }

  const found = sum.multiplyScalar(1 / Math.max(1, data.length / 4));

  means.set(made, found);

  return found;
}

/** Runs `patch` on the material's shader after any earlier one; `key` tells the programs apart. */
export function patched<M extends Material>(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches in place.
  material: M,
  key: string,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  patch: (shader: Shader) => void,
): M {
  const before = material.onBeforeCompile.bind(material);
  const known = material.customProgramCacheKey();

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    patch(shader);
  };

  material.customProgramCacheKey = () => `${known}|${key}`;

  return material;
}

/** The surface's normal tilted by a height's slope across the screen (Mikkelsen's bump). */
const RELIEF = `
uniform float uRelief;
vec3 weatherRelief(vec3 n, vec3 at, float height, float face) {
  vec3 sx = dFdx(at);
  vec3 sy = dFdy(at);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  vec3 slope = sign(det) * (dFdx(height) * r1 + dFdy(height) * r2);
  return normalize(abs(det) * n - slope);
}`;

/** Two scales of the variation as a height, a hand's and an arm's length across. */
const RAISED = `
float weatherHeight = weatherNoise(weatherAt * 1.9 + 3.0) + 0.5 * weatherNoise(weatherAt * 4.3 + 9.0);
normal = weatherRelief(normal, -vViewPosition, weatherHeight * uRelief, faceDirection);`;

/** The sum of the channels of a finish's mean albedo: what its second scale is weighed against. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- read only.
function brightness({ map }: MeshStandardMaterial): number {
  if (!(map instanceof DataTexture)) return 1;

  const { r, g, b } = mean(map);

  return Math.max(r + g + b, 0.001);
}

/** Tilts the weathered surface by the variation's slope. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function raise(shader: Shader, metres: number): void {
  shader.uniforms["uRelief"] = { value: metres };
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${RELIEF}`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${RAISED}`);
}

/** The finish's weathering and variation, written into its shader. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
function vary(shader: Shader, weather: Weather, bright: number): void {
  shader.uniforms["uWeather"] = { value: [weather.colour, weather.rough, weather.foot ?? 1] };
  shader.uniforms["uPatches"] = { value: weather.patches ?? [1, 1, 1] };
  shader.uniforms["uCells"] = { value: weather.cells ?? [1, 1, 0] };
  shader.uniforms["uMean"] = { value: bright };
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX.declared}`)
    .replace("#include <project_vertex>", `#include <project_vertex>\n${VERTEX.set}`);
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${DECLARED}`)
    .replace("#include <map_fragment>", colour(weather))
    .replace("#include <roughnessmap_fragment>", roughness(weather))
    .replace("#include <normal_fragment_maps>", surface(weather));
}

/** Weathers a finish that has a map; its programs are shared by every finish weathered alike. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches in place.
export function weathered<M extends MeshStandardMaterial>(material: M, weather: Weather): M {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  const made = patched(material, `weather:${kindOf(weather)}`, (shader) => {
    // Niedrig draws the finish as it is.
    if (!extras) return;

    vary(shader, weather, brightness(material));

    if (relief) raise(shader, weather.relief ?? 0);
  });

  const keyed = made.customProgramCacheKey.bind(made);

  // Weathered and plain are two programs.
  made.customProgramCacheKey = () => `${keyed()}:${extras}:${relief}`;

  return made;
}

/** A tree's leaves or bark in the tree's own cast, by where it stands. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches in place.
export function perTree<M extends MeshStandardMaterial>(material: M): M {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  const made = patched(material, "tree", (shader) => {
    if (!extras) return;

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${TREE.declared}`)
      .replace("#include <color_fragment>", TREE.tint);
  });

  const keyed = made.customProgramCacheKey.bind(made);

  made.customProgramCacheKey = () => `${keyed()}:${extras}`;

  return made;
}

/** A decal that shows as soiling run down from a sill; plain, it shows nothing. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches in place.
export function seeping<M extends MeshStandardMaterial>(material: M): M {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  const made = patched(material, "soil", (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${SOIL.vertex.declared}`)
      .replace("#include <project_vertex>", `#include <project_vertex>\n${SOIL.vertex.set}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${SOIL.declared}`)
      .replace(
        "#include <color_fragment>",
        extras ? SOIL.run : "#include <color_fragment>\ndiffuseColor.a = 0.0;",
      );
  });

  const keyed = made.customProgramCacheKey.bind(made);

  made.customProgramCacheKey = () => `${keyed()}:${extras}`;

  return made;
}
