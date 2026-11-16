// The sun's shadow for a 3D quality (ADR 20 Look, Rendering quality): its map's size, and below
// Hoch three.js's blur by one radius, in Hoch a penumbra that widens with the caster's distance.
import { BasicShadowMap, type DirectionalLight, PCFShadowMap, type WebGLRenderer } from "three";
import { CLEAR_SHADOW } from "./light.ts";
import type { Look } from "./quality.ts";
import { penumbra, softShadows } from "./soft-shadow.ts";

/** Soft shadows: PCF with a radius, as r187 dropped PCFSoftShadowMap. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it up in place.
export function soften(sun: DirectionalLight): void {
  const shadow = sun.shadow;

  sun.castShadow = true;
  shadow.bias = -0.00025;
  shadow.normalBias = 0.035;
  shadow.blurSamples = 16;
  softShadows();
}

/** The shadow's softness under a sky that spreads it `spread` times a clear one's. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
export function shade(sun: DirectionalLight, { contact }: Look, spread: number): void {
  const { shadow } = sun;
  const { camera } = shadow;

  shadow.radius = contact
    ? penumbra(spread, camera.far - camera.near, camera.right - camera.left, shadow.mapSize.x)
    : spread * CLEAR_SHADOW;
}

/** The shadow map `look` draws from, sampled its way. */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js sets them in place. */
export function shadowFor(renderer: WebGLRenderer, sun: DirectionalLight, look: Look): void {
  const { shadow } = sun;

  // Hoch's shadows harden where they touch: sampled from raw depths, three.js's basic map.
  renderer.shadowMap.type = look.contact ? BasicShadowMap : PCFShadowMap;

  if (shadow.mapSize.x === look.shadowMap) return;

  shadow.mapSize.set(look.shadowMap, look.shadowMap);
  shadow.map?.dispose();
  shadow.map = null;
}
/* oxlint-enable typescript/prefer-readonly-parameter-types */
