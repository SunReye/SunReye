// Weathering for the generated finishes (ADR 20 Look): large-scale variation in colour and
// roughness that never repeats, so no tiling shows from afar, a second scale of the same map on
// loose ground, and grime at a wall's foot. One shader patch, no texture and no pass of its own.
import {
  Color,
  DataTexture,
  type Material,
  type MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from "three";

/** Off below Mittel, and on the lite and still motion tiers under Auto (ADR 20, ADR 21). */
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

export interface Weather {
  /** How far the colour and the roughness swing with the large-scale variation, 0 to 1. */
  readonly colour: number;
  readonly rough: number;
  /** A wall: the variation runs down it, and its foot darkens to this share of its colour. */
  readonly foot?: number;
  /** Loose ground (grass, gravel): a second, turned scale of its map breaks the repeats. */
  readonly loose?: boolean;
  /** What patches of it turn toward, as a factor per channel: a lawn's dry spots. */
  readonly patches?: readonly [number, number, number];
  /** How far the surface rises and falls with the variation in relief, in metres. */
  readonly relief?: number;
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

const VARYING = "varying vec3 vWeatherAt;";

/** Value noise on a hashed lattice: it has no period, unlike the maps. */
const NOISE = `
${VARYING}
uniform vec3 uWeather;
uniform vec3 uPatches;
uniform float uMean;
float weatherHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float weatherNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(weatherHash(i), weatherHash(i + vec2(1.0, 0.0)), f.x),
    mix(weatherHash(i + vec2(0.0, 1.0)), weatherHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}`;

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
#include <normal_fragment_maps>
float weatherHeight = weatherNoise(weatherAt * 1.9 + 3.0) + 0.5 * weatherNoise(weatherAt * 4.3 + 9.0);
normal = weatherRelief(normal, -vViewPosition, weatherHeight * uRelief, faceDirection);`;

/** The second scale: the map again, turned 34° and 3.2 times as large, as a brightness. One
 * fixed level of it: a brightness needs no anisotropic filtering, which costs most at the
 * lawn's grazing angles. */
const LOOSE = `
vec3 wide = textureLod(map, mat2(0.829, 0.559, -0.559, 0.829) * vMapUv * 0.317 + 0.37, 2.0).rgb;
diffuseColor.rgb *= mix(1.0, dot(wide, vec3(1.0)) / uMean, 0.7);`;

/** The variation's finer octave. */
const FINE = "weather = mix(weatherWide, weatherNoise(weatherAt * 0.47 + 17.0), 0.4);";

/** Along a wall and up it, so streaks run down; else across the ground. */
const at = (wall: boolean): string =>
  wall ? "vec2(dot(vWeatherAt.xz, vec2(0.83, 0.56)) * 2.0, vWeatherAt.y * 0.5)" : "vWeatherAt.xz";

function colour({ foot, loose, patches }: Weather): string {
  return `
#include <map_fragment>
vec2 weatherAt = ${at(foot !== undefined)};
float weatherWide = weatherNoise(weatherAt * 0.13);
float weather = weatherWide;
${FINE}
${loose === true ? LOOSE : ""}
diffuseColor.rgb *= 1.0 + (weather - 0.5) * 2.0 * uWeather.x;
${
  patches === undefined
    ? ""
    : "diffuseColor.rgb *= mix(vec3(1.0), uPatches, smoothstep(0.55, 0.85, weatherWide));"
}
${
  foot === undefined
    ? ""
    : "diffuseColor.rgb *= mix(uWeather.z, 1.0, smoothstep(0.0, 0.7, vWeatherAt.y + (weather - 0.5) * 0.5));"
}`;
}

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
    .replace("#include <normal_fragment_maps>", RAISED);
}

/** Weathers a finish that has a map; its programs are shared by every finish weathered alike. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches in place.
export function weathered<M extends MeshStandardMaterial>(material: M, weather: Weather): M {
  const { foot, loose, patches } = weather;
  const key = `weather:${foot !== undefined}:${loose === true}:${patches !== undefined}`;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own.
  const made = patched(material, key, (shader) => {
    // The lite and still tiers draw the finish as it is.
    if (!extras) return;

    shader.uniforms["uWeather"] = { value: [weather.colour, weather.rough, foot ?? 1] };
    shader.uniforms["uPatches"] = { value: patches ?? [1, 1, 1] };
    shader.uniforms["uMean"] = { value: brightness(material) };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VARYING}`)
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvWeatherAt = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${NOISE}`)
      .replace("#include <map_fragment>", colour(weather))
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.0 + (weather - 0.5) * 2.0 * uWeather.y), 0.04, 1.0);",
      );

    if (relief) raise(shader, weather.relief ?? 0);
  });

  const keyed = made.customProgramCacheKey.bind(made);

  // Weathered and plain are two programs.
  made.customProgramCacheKey = () => `${keyed()}:${extras}:${relief}`;

  return made;
}
