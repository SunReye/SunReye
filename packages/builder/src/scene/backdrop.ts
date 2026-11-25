// The studio's surroundings (ADR 20 Look): a flat backdrop in the page colour, a floor
// that fades into it, and the sky that lights the scene. Browser-only: colours come from CSS.
import {
  Color,
  DataTexture,
  FloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Vector2,
  Vector3,
} from "three";
import { Sky } from "three/addons/objects/Sky.js";
import type { Clouds } from "./light.ts";
import { floor } from "./materials.ts";
import { untone } from "./tone.ts";

/** Metres of floor each way; it fades long before its edge. */
const FLOOR = 400;

/** Resolves any CSS colour (oklch included) to linear RGB through a 1 px canvas. */
export function cssColour(expression: string): Color {
  const canvas = document.createElement("canvas");

  canvas.width = canvas.height = 1;

  // A CPU canvas: reading a GPU one back waits behind whatever the GPU is still drawing.
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const probe = document.createElement("span");

  probe.style.color = expression;
  document.body.append(probe);

  if (context === null) return new Color();

  context.fillStyle = getComputedStyle(probe).color;
  probe.remove();
  context.fillRect(0, 0, 1, 1);

  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;

  return new Color().setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
}

/** The page colour, as it lands after tone mapping: a flat backdrop, so the floor fades into the
 * page with no horizon, and no lighter middle glows behind the house. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- cloned, never changed.
export function backdrop(page: Color, exposure: number): DataTexture {
  const data = new Float32Array([...untone([page.r, page.g, page.b], exposure), 1]);
  const texture = new DataTexture(data, 1, 1, RGBAFormat, FloatType);

  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;

  return texture;
}

/** The floor fade's uniforms: the plot's centre on the ground and its radius in metres. */
export interface Fade {
  readonly centre: { value: Vector2 };
  readonly radius: { value: number };
}

/** The fade starts at this share of the plot's radius and ends at `END` of it, plus `PAST`
 * metres: wide, so the floor has no edge, and long shadows still land on it. */
const FADE = { start: 0.8, end: 2.1, past: 10 } as const;

/** The studio floor, faded with distance from the plot's centre into the backdrop. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- shared with the shader.
export function ground(fade: Fade): Mesh {
  const material = floor();

  material.transparent = true;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uFadeCentre"] = fade.centre;
    shader.uniforms["uFadeRadius"] = fade.radius;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFadeWorld;")
      .replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vFadeWorld;\nuniform vec2 uFadeCentre;\nuniform float uFadeRadius;",
      )
      .replace(
        "#include <alphatest_fragment>",
        `#include <alphatest_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(uFadeRadius * ${FADE.start.toFixed(2)}, uFadeRadius * ${FADE.end.toFixed(2)} + ${FADE.past.toFixed(1)}, length(vFadeWorld.xz - uFadeCentre));`,
      );
  };

  material.customProgramCacheKey = () => "floor-fade";

  const mesh = new Mesh(new PlaneGeometry(FLOOR, FLOOR), material);

  mesh.rotation.x = -Math.PI / 2;
  // A hair below the footprints, so the floor never flickers through them.
  mesh.position.y = -0.01;
  mesh.receiveShadow = true;

  return mesh;
}

export function sky(scale: number): Sky {
  const made = new Sky();
  const uniforms = made.material.uniforms;

  made.scale.setScalar(scale);
  uniforms["mieCoefficient"]!.value = 0.004;
  uniforms["mieDirectionalG"]!.value = 0.82;
  uniforms["time"]!.value = 120;
  uniforms["showSunDisc"]!.value = 0;

  return made;
}

/** The sky model's haze. */
interface Haze {
  readonly turbidity: number;
  readonly rayleigh: number;
}

const HIGH_SUN: Haze = { turbidity: 2.4, rayleigh: 1.1 };
const LOW_SUN: Haze = { turbidity: 5, rayleigh: 2.2 };

/** The dark theme's sky is deeper and moodier at the same sun; a low sun's is hazier, `low` of
 * the way: blended, as a switch would step the sky's light. */
function haze(dark: boolean, low: number): Haze {
  if (dark) return { turbidity: 6, rayleigh: 2.4 };

  return {
    turbidity: HIGH_SUN.turbidity + (LOW_SUN.turbidity - HIGH_SUN.turbidity) * low,
    rayleigh: HIGH_SUN.rayleigh + (LOW_SUN.rayleigh - HIGH_SUN.rayleigh) * low,
  };
}

/** Points the sky at the sun, `toward` in three.js's frame, under `clouds`. */
export function aim(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
  made: Sky,
  toward: Readonly<Vector3>,
  { dark, low, clouds }: { readonly dark: boolean; readonly low: number; readonly clouds: Clouds },
): void {
  const uniforms = made.material.uniforms;
  const sunPosition: unknown = uniforms["sunPosition"]?.value;
  const { turbidity, rayleigh } = haze(dark, low);

  if (sunPosition instanceof Vector3) sunPosition.set(toward.x, toward.y, toward.z);

  Object.assign(uniforms["turbidity"] ?? {}, { value: turbidity });
  Object.assign(uniforms["rayleigh"] ?? {}, { value: rayleigh });
  Object.assign(uniforms["cloudCoverage"] ?? {}, { value: clouds.coverage });
  Object.assign(uniforms["cloudDensity"] ?? {}, { value: clouds.density });
}
