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
import { untone } from "./light.ts";
import { lawn } from "./materials.ts";

/** Metres of lawn each way; it fades long before its edge. */
const LAWN = 400;

/** Metres of lawn per grass texture repeat. */
const GRASS = 3;

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

/** The vignette's light middle, how far toward it, and its darker edge, by theme. */
const VIGNETTE = {
  light: { light: [1, 1, 1], toward: 0.55, edge: 0.93 },
  dark: { light: [0.06, 0.065, 0.075], toward: 0.4, edge: 0.7 },
} as const;

/** From the light middle, 0, to the edge, 1, at a point of the backdrop in 0..1. */
function vignette(x: number, y: number): number {
  const d = Math.min(1, Math.hypot(x - 0.5, (y - 0.42) * 1.15) * 1.6);

  return d * d * (3 - 2 * d);
}

/** A soft vignette that lands on the page colour after tone mapping: no horizon shows. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- cloned, never changed.
export function backdrop(page: Color, exposure: number, dark: boolean): DataTexture {
  const size = 64;
  const data = new Float32Array(size * size * 4);

  const { light, toward, edge: darker } = dark ? VIGNETTE.dark : VIGNETTE.light;
  const centre = page.clone().lerp(new Color(...light), toward);
  const edge = page.clone().multiplyScalar(darker);

  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const t = vignette(x / size, y / size);
      const c = t < 0.5 ? centre.clone().lerp(page, t * 2) : page.clone().lerp(edge, (t - 0.5) * 2);
      const i = (y * size + x) * 4;

      data[i] = untone(c.r, exposure);
      data[i + 1] = untone(c.g, exposure);
      data[i + 2] = untone(c.b, exposure);
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
        "#include <alphatest_fragment>\ndiffuseColor.a *= 1.0 - smoothstep(uFadeRadius, uFadeRadius + 10.0, length(vFadeWorld.xz - uFadeCentre));",
      );
  };

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
  uniforms["cloudCoverage"]!.value = 0.32;
  uniforms["cloudDensity"]!.value = 0.35;
  uniforms["time"]!.value = 120;
  uniforms["showSunDisc"]!.value = 0;

  return made;
}

/** The sky model's haze. */
interface Haze {
  readonly turbidity: number;
  readonly rayleigh: number;
}

/** The dark theme's sky is deeper and moodier at the same sun, a low sun's hazier. */
function haze(dark: boolean, low: boolean): Haze {
  if (dark) return { turbidity: 6, rayleigh: 2.4 };

  return low ? { turbidity: 5, rayleigh: 2.2 } : { turbidity: 2.4, rayleigh: 1.1 };
}

/** Points the sky at the sun, `toward` in three.js's frame. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
export function aim(made: Sky, toward: Readonly<Vector3>, dark: boolean, low: boolean): void {
  const uniforms = made.material.uniforms;
  const sunPosition: unknown = uniforms["sunPosition"]?.value;
  const { turbidity, rayleigh } = haze(dark, low);

  if (sunPosition instanceof Vector3) sunPosition.set(toward.x, toward.y, toward.z);

  Object.assign(uniforms["turbidity"] ?? {}, { value: turbidity });
  Object.assign(uniforms["rayleigh"] ?? {}, { value: rayleigh });
}
