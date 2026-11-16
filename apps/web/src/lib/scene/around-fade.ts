// How the imported surroundings end (ADR 20 Look): everything fades out toward the radius, into
// the page, so studio mode keeps no visible horizon. Pure.
import { type Material, Mesh, MeshStandardMaterial, type Object3D, type Vector4 } from "three";
import type { Point } from "../builder/pv.ts";
import type { Relief } from "../builder/imported.ts";
import { patched } from "./weather.ts";

/** The fade's uniform: its centre east and south in three.js's frame, the radius it ends at and
 * the metres it takes. */
export interface Fade {
  readonly value: Vector4;
}

export const toThree = ([east, north, up]: Point): [number, number, number] => [
  east,
  up,
  0 - north,
];

/** The share of the radius over which everything fades into the page, and its least metres. */
export const BAND = 0.2;
export const LEAST = 10;

/** The relief's middle east and north of the scene's origin, and metres from it to an edge. */
export function reach({ origin, across, along, side }: Relief): readonly [number, number, number] {
  const half = Math.max(side - 1, 0) / 2;

  return [
    origin[0] + (across[0] + along[0]) * half,
    origin[1] + (across[1] + along[1]) * half,
    Math.hypot(across[0], across[1]) * half,
  ];
}

/** Fades a material out toward the radius; what lies past it is not drawn. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
function faded<M extends Material>(material: M, fade: Fade): M {
  material.transparent = true;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js patches it in place.
  return patched(material, "around-fade", (shader) => {
    shader.uniforms["uAroundFade"] = fade;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAroundAt;")
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vec4 aroundAt = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
aroundAt = instanceMatrix * aroundAt;
#endif
vAroundAt = (modelMatrix * aroundAt).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vAroundAt;\nuniform vec4 uAroundFade;",
      )
      .replace(
        "#include <alphatest_fragment>",
        `#include <alphatest_fragment>
float aroundFade = 1.0 - smoothstep(uAroundFade.z - uAroundFade.w, uAroundFade.z, length(vAroundAt.xz - uAroundFade.xy));
if (aroundFade < 0.004) discard;
diffuseColor.a *= aroundFade;`,
      );
  });
}

/** Fades every material under `part`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
export function fadeAll(part: Object3D, fade: Fade): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  part.traverse((child) => {
    const material: unknown = child instanceof Mesh ? child.material : undefined;

    if (material instanceof MeshStandardMaterial) faded(material, fade);
  });
}
