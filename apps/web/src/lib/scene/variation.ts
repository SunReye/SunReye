// The shader arithmetic of the finishes' weathering and variation (ADR 20 Look): what each kind
// of finish adds to its colour, its roughness and its normal. All of it from noise on a hashed
// lattice or from a stone's own cell, so nothing here has a period. Pure strings: no three.js.

/** How a finish weathers and varies; every strength is 0 to 1. */
export interface Weather {
  /** How far the colour and the roughness swing with the large-scale variation. */
  readonly colour: number;
  readonly rough: number;
  /** A wall: the variation runs down it, it is patched, and its foot darkens to this share. */
  readonly foot?: number;
  /** Loose ground (grass, gravel): a second, turned scale of its map breaks the repeats. */
  readonly loose?: boolean;
  /** What patches of it turn toward, as a factor per channel: a lawn's dry spots. */
  readonly patches?: readonly [number, number, number];
  /** A lawn: its greens shift at three scales, and clover grows in it. */
  readonly clover?: boolean;
  /** Laid stones: columns and rows per repeat of the map and every other row's shift in stones.
   * Each stone takes its own hue, brightness and lift. */
  readonly cells?: readonly [number, number, number];
  /** A pitched roof: streaks down its fall line, moss and lichen where it stays damp. */
  readonly roof?: boolean;
  /** Ground that is walked or driven on: worn along its middle, or in two wheel tracks. */
  readonly wear?: "feet" | "wheels";
  /** How far the surface rises and falls with the variation in relief, in metres. */
  readonly relief?: number;
}

/** What tells two finishes' programs apart. */
export function kindOf(weather: Weather): string {
  const { foot, loose, patches, clover, cells, roof, wear } = weather;

  return [foot !== undefined, loose, patches !== undefined, clover, cells !== undefined, roof, wear]
    .map((part) => `${part ?? false}`)
    .join(":");
}

/** Value noise on a hashed lattice: it has no period, unlike the maps. */
const HASH = `
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

const VARYINGS = `
varying vec3 vWeatherAt;
varying vec2 vWeatherFall;
varying vec2 vWeatherWear;`;

/** What the fragment shader declares. */
export const DECLARED = `
${VARYINGS}
uniform vec3 uWeather;
uniform vec3 uPatches;
uniform vec3 uCells;
uniform float uMean;
${HASH}`;

/** What the vertex shader hands on: where the fragment lies in the world, how far a roof's
 * point lies above its eave, and where ground lies across its width; a mesh without the last
 * two hands on nothing, and nothing gathers there. */
export const VERTEX = {
  declared: `attribute vec2 fall;\nattribute vec2 wear;\n${VARYINGS}`,
  set: `vWeatherAt = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWeatherFall = fall;
vWeatherWear = wear;`,
} as const;

/** The second scale: the map again, turned 34° and 3.2 times as large, as a brightness. One
 * fixed level of it: a brightness needs no anisotropic filtering, which costs most at the
 * lawn's grazing angles. */
const LOOSE = `
vec3 wide = textureLod(map, mat2(0.829, 0.559, -0.559, 0.829) * vMapUv * 0.317 + 0.37, 2.0).rgb;
diffuseColor.rgb *= mix(1.0, dot(wide, vec3(1.0)) / uMean, 0.7);`;

/** Each stone by the cell it lies in: a brightness and a hue of its own. The cells follow the
 * map's bond, and a cell's number never comes round again. */
const CELLS = `
vec2 weatherStone = vMapUv * uCells.xy;
weatherStone.x += mod(floor(weatherStone.y), 2.0) * uCells.z;
vec2 weatherCell = floor(weatherStone);
float weatherTone = weatherHash(weatherCell + 0.5);
float weatherHue = weatherHash(weatherCell + 17.3) - 0.5;
diffuseColor.rgb *= (0.8 + weatherTone * 0.4) * vec3(1.0 + weatherHue * 0.18, 1.0, 1.0 - weatherHue * 0.18);`;

/** A lawn's greens at three scales, yellower here and bluer there, and clover: rounder, darker,
 * bluer-green patches that keep to the lusher stretches. */
const CLOVER = `
float weatherFine = weatherNoise(weatherAt * 2.3 + 29.0);
float weatherGreen = weatherWide * 0.5 + weatherNoise(weatherAt * 0.47 + 61.0) * 0.3 + weatherFine * 0.2;
diffuseColor.rgb *= mix(vec3(1.22, 1.02, 0.6), vec3(0.78, 0.98, 1.16), smoothstep(0.25, 0.75, weatherGreen));
float weatherClover = smoothstep(0.54, 0.66, weatherNoise(weatherAt * 1.1 + 50.0) * 0.7 + weatherFine * 0.3)
  * smoothstep(0.35, 0.6, weatherNoise(weatherAt * 0.19 + 9.0));
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 1.0, 0.6), weatherClover * 0.85);`;

/** A wall: mended patches a shade off, soiling that runs down it, and a darkened foot. */
const WALL = `
float weatherPatch = smoothstep(0.58, 0.61, weatherNoise(weatherAt * vec2(0.22, 0.45) + 31.0));
diffuseColor.rgb *= 1.0 + weatherPatch * 0.09 * (weatherNoise(weatherAt * 0.6 + 3.0) - 0.35);
float weatherRun = smoothstep(0.5, 0.95, weatherNoise(vec2(weatherAt.x * 3.1, weatherAt.y * 0.24)));
diffuseColor.rgb *= 1.0 - weatherRun * 0.12 * vec3(1.0, 0.92, 0.8);
diffuseColor.rgb *= mix(uWeather.z, 1.0, smoothstep(0.0, 0.7, vWeatherAt.y + (weather - 0.5) * 0.5));`;

/** Where feet run: a paler, smoother band along the middle, uneven like tread. */
const FEET = `
float weatherWorn = vWeatherWear.y * (1.0 - smoothstep(0.2, 0.8, abs(vWeatherWear.x)))
  * (0.55 + 0.45 * weatherNoise(vWeatherAt.xz * 1.3 + 77.0));
diffuseColor.rgb *= 1.0 + weatherWorn * 0.2;
diffuseColor.rgb *= 1.0 - vWeatherWear.y * smoothstep(0.82, 1.0, abs(vWeatherWear.x)) * 0.16 * weatherFiner;`;

/** Where wheels run: two darker, packed tracks. */
const WHEELS = `
float weatherWorn = vWeatherWear.y * (1.0 - smoothstep(0.1, 0.26, abs(abs(vWeatherWear.x) - 0.5)))
  * (0.6 + 0.4 * weatherNoise(vWeatherAt.xz * 0.9 + 77.0));
diffuseColor.rgb *= 1.0 - weatherWorn * 0.2;`;

const WEAR = { feet: FEET, wheels: WHEELS } as const;

/** Along a wall and up it, so streaks run down; else across the ground. */
const at = (wall: boolean): string =>
  wall ? "vec2(dot(vWeatherAt.xz, vec2(0.83, 0.56)) * 2.0, vWeatherAt.y * 0.5)" : "vWeatherAt.xz";

/** The colour: drift at a scale of metres and again at the grain's, then what the kind adds. */
export function colour(weather: Weather): string {
  const { foot, loose, patches, clover, cells, wear } = weather;

  return `
#include <map_fragment>
vec2 weatherAt = ${at(foot !== undefined)};
float weatherWide = weatherNoise(weatherAt * 0.13);
float weather = mix(weatherWide, weatherNoise(weatherAt * 0.47 + 17.0), 0.4);
float weatherFiner = weatherNoise(weatherAt * 11.0 + 43.0);
${loose === true ? LOOSE : ""}
diffuseColor.rgb *= 1.0 + (weather - 0.5) * 2.0 * uWeather.x + (weatherFiner - 0.5) * uWeather.x;
${cells === undefined ? "" : CELLS}
${patches === undefined ? "" : "diffuseColor.rgb *= mix(vec3(1.0), uPatches, smoothstep(0.55, 0.85, weatherWide));"}
${clover === true ? CLOVER : ""}
${foot === undefined ? "" : WALL}
${wear === undefined ? "" : WEAR[wear]}`;
}

/** The roughness swings with the colour's drift; worn ground is smoother. */
export function roughness({ wear }: Weather): string {
  return `
#include <roughnessmap_fragment>
roughnessFactor *= 1.0 + (weather - 0.5) * 2.0 * uWeather.y + (weatherFiner - 0.5) * uWeather.y;
${wear === undefined ? "" : "roughnessFactor *= 1.0 - weatherWorn * 0.22;"}
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);`;
}

/** Each stone's lift: it lies a little out of true, tilted in the surface's own frame. */
const LIFT = `
#ifdef USE_NORMALMAP_TANGENTSPACE
normal = normalize(normal
  + tbn[0] * (weatherHash(weatherCell + 3.1) - 0.5) * 0.16
  + tbn[1] * (weatherHash(weatherCell + 7.7) - 0.5) * 0.16);
#endif`;

/** A pitched roof: dark streaks down the fall line, moss on the side turned from the sun and
 * above the eaves, where a roof stays damp, and pale lichen in spots. */
const ROOF = `
vec3 weatherFace = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
float weatherShade = clamp(0.25 - weatherFace.z * 1.5, 0.0, 1.0);
float weatherEave = vWeatherFall.y * (1.0 - smoothstep(0.0, 1.4, vWeatherFall.x));
float weatherDamp = clamp(weatherShade * 0.7 + weatherEave * 0.5, 0.0, 1.0);
float weatherStreak = smoothstep(0.45, 0.9, weatherNoise(vec2(vMapUv.x * 5.0, vMapUv.y * 0.3)))
  * (0.5 + 0.5 * weatherNoise(vMapUv * vec2(13.0, 0.9) + 5.0));
diffuseColor.rgb *= 1.0 - weatherStreak * (0.16 + weatherDamp * 0.14);
float weatherMoss = smoothstep(0.8 - weatherDamp * 0.3, 0.92 - weatherDamp * 0.26,
  weatherNoise(vWeatherAt.xz * 1.3 + 5.0) * 0.55 + weatherNoise(vWeatherAt.xz * 6.0) * 0.3 + weatherFiner * 0.15);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.068, 0.022) * (0.7 + weatherFiner * 0.6), weatherMoss * 0.8);
float weatherLichen = smoothstep(0.8, 0.86, weatherNoise(vWeatherAt.xz * 19.0 + 40.0))
  * smoothstep(0.4, 0.7, weatherNoise(vWeatherAt.xz * 0.8 + 70.0)) * (0.2 + weatherShade * 0.8);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.43, 0.3), weatherLichen * 0.55);
roughnessFactor = mix(roughnessFactor, 1.0, max(weatherMoss, weatherLichen));`;

/** The normal, and what waits for it: a stone's lift and a roof's growth. */
export function surface({ cells, roof }: Weather): string {
  return `
#include <normal_fragment_maps>
${cells === undefined ? "" : LIFT}
${roof === true ? ROOF : ""}`;
}

/** A tree's own cast: every leaf and its bark a shade and a hue off the next tree's, by where
 * it stands. What is placed in the scene's own frame, a hedge's leaves, keeps its colours. */
export const TREE = {
  declared: `uniform mat4 modelMatrix;\n${HASH}`,
  tint: `
#include <color_fragment>
vec2 weatherStood = modelMatrix[3].xz;
vec2 weatherTree = (vec2(weatherHash(weatherStood), weatherHash(weatherStood.yx + 9.0)) - 0.5)
  * step(0.001, dot(weatherStood, weatherStood));
diffuseColor.rgb *= (1.0 + weatherTree.x * 0.4) * vec3(1.0 + weatherTree.y * 0.24, 1.0, 1.0 - weatherTree.y * 0.24);`,
} as const;

/** Soiling under a sill: streaks that run down from it and thin out, `seep` giving the metres
 * along the wall and how much runs there. */
export const SOIL = {
  vertex: {
    declared: "attribute vec2 seep;\nvarying vec2 vWeatherSeep;",
    set: "vWeatherSeep = seep;",
  },
  declared: `varying vec2 vWeatherSeep;\n${HASH}`,
  run: `
#include <color_fragment>
float weatherRuns = smoothstep(0.3, 0.8, weatherNoise(vec2(vWeatherSeep.x * 11.0, vWeatherSeep.y * 1.4)));
diffuseColor.a *= vWeatherSeep.y * vWeatherSeep.y * (0.25 + 0.75 * weatherRuns);`,
} as const;
