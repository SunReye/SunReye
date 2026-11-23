// The drawn scene under the weather (ADR 23 "Scene weather"): wet roofs and ground darken, lying
// snow whitens them, and snow-covered modules draw white. Set from each finish as built, so it is
// applied anew on every change and never adds up.
import {
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  type Texture,
} from "three";
import { mix } from "./colour.ts";
import type { SceneWeather } from "./weather.ts";

/** What rain and snow lie on: roof faces, pitched and flat, ground surfaces, the aerial image and
 * the studio floor. */
const LYING: ReadonlySet<string> = new Set(["roof", "flat", "ground", "aerial", "floor"]);

/** Snow: a hair under white, as every finish is, so a sunlit face stays under the page's. */
const SNOW = 0xf4f6f9;

/** A soaked finish: this much of its light left, and a sheen. */
const SOAKED = { light: 0.62, roughness: 0.55 };

/** Snow is matte. */
const MATTE = 0.95;

/** A finish as built. */
interface Built {
  readonly colour: number;
  readonly roughness: number;
  readonly map: Texture | null;
  readonly roughnessMap: Texture | null;
  readonly envMapIntensity: number;
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own material.
function builtOf(material: MeshStandardMaterial): Built {
  const data: { built?: Built } = material.userData;

  data.built ??= {
    colour: material.color.getHex(),
    roughness: material.roughness,
    map: material.map,
    roughnessMap: material.roughnessMap,
    envMapIntensity: material.envMapIntensity,
  };

  return data.built;
}

/** A roof's or the ground's finish, an aerial image's too: white under snow, else darker and
 * smoother the wetter. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours in place.
function lie(material: MeshStandardMaterial, { wet, snow }: Lying): void {
  const built = builtOf(material);
  // Snow hides an aerial image lying there.
  const map = snow ? null : built.map;

  // With or without a map is another program.
  material.needsUpdate ||= material.map !== map;
  material.map = map;

  if (snow) {
    material.color.setHex(SNOW);
    material.roughness = MATTE;

    return;
  }

  material.color.setHex(built.colour).multiplyScalar(mix(1, SOAKED.light, wet));
  material.roughness = mix(built.roughness, SOAKED.roughness, wet);
}

/** A module: matte snow in place of its cells and glass while covered. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours in place.
function cover(material: MeshPhysicalMaterial, covered: boolean): void {
  const built = builtOf(material);
  const map = covered ? null : built.map;

  // With or without a map is another program.
  material.needsUpdate ||= material.map !== map;
  material.map = map;
  material.roughnessMap = covered ? null : built.roughnessMap;
  material.color.setHex(covered ? SNOW : built.colour);
  material.roughness = covered ? MATTE : built.roughness;
  material.envMapIntensity = covered ? 0 : built.envMapIntensity;
}

type Lying = Pick<SceneWeather, "wet" | "snow">;

/** Finishes `part` and all in it for the `weather`. */
export function weathered(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js recolours in place.
  part: Object3D,
  weather: Pick<SceneWeather, "wet" | "snow" | "covered">,
): void {
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's own objects.
  part.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    const material: unknown = child.material;

    if (child.name === "module" && material instanceof MeshPhysicalMaterial) {
      cover(material, weather.covered);
    } else if (LYING.has(child.name) && material instanceof MeshStandardMaterial) {
      lie(material, weather);
    }
  });
}
