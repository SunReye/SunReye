// The studio's surroundings (ADR 20 Look): a backdrop in the page colour with no horizon, a lawn
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
import { flowColour, type Flow } from "../energy-colours.ts";
import { untone, type Clouds } from "./light.ts";
import { lawn } from "./materials.ts";
import { backdropAt } from "./vignette.ts";
import { patched } from "./weather.ts";

/** Metres of lawn each way; it fades long before its edge. */
export const LAWN = 400;

/** Metres of lawn per grass texture repeat. */
export const GRASS = 3;

/** An energy flow's colour in the current theme, as linear RGB. */
export const flowRgb = (flow: Flow): Color => cssColour(flowColour(flow));

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

/** A soft vignette that lands on the page colour after tone mapping: no horizon shows. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- cloned, never changed.
export function backdrop(page: Color, exposure: number, dark: boolean): DataTexture {
  const size = 64;
  const data = new Float32Array(size * size * 4);

  const linear = [page.r, page.g, page.b] as const;

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const [r, g, b] = backdropAt(linear, dark, x / size, y / size);
      const i = (y * size + x) * 4;

      data[i] = untone(r, exposure);
      data[i + 1] = untone(g, exposure);
      data[i + 2] = untone(b, exposure);
      data[i + 3] = 1;
    }

  const texture = new DataTexture(data, size, size, RGBAFormat, FloatType);

  texture.colorSpace = LinearSRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.flipY = true;
  texture.needsUpdate = true;

  return texture;
}

/** The lawn, faded with distance from the plot's centre into the backdrop. */
/** The lawn fade's uniforms: the plot's centre on the ground and its radius in metres. */
export interface Fade {
  readonly centre: { value: Vector2 };
  readonly radius: { value: number };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- shared with the shader.
export function ground(fade: Fade): Mesh {
  const geometry = new PlaneGeometry(LAWN, LAWN);
  const uv = geometry.getAttribute("uv");

  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) * LAWN) / GRASS, (uv.getY(i) * LAWN) / GRASS);

  const material = lawn();

  material.transparent = true;
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  patched(material, "fade", (shader) => {
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
        "#include <alphatest_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(uFadeRadius, uFadeRadius + 10.0, length(vFadeWorld.xz - uFadeCentre));",
      );
  });

  const mesh = new Mesh(geometry, material);

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
