// What a 3D quality's look does to the scene's finishes (ADR 20 Look, Rendering quality):
// weathering and relief are compiled into their programs, Hoch's reflections set on them.
import { Material, Mesh, type Object3D } from "three";
import { eaves } from "./eaves.ts";
import { enrich } from "./gloss.ts";
import type { Look } from "./quality.ts";
import { weatherFinishes } from "./weather.ts";

/** What of a look is compiled into the finishes' programs. */
const compiled = ({ weathering, rich }: Look): string => `${weathering}:${rich}`;

/** Draws `scene`'s finishes, and those made from here on, in `look`. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene, set in place.
export function finishIn(scene: Object3D, look: Look): void {
  weatherFinishes(look.weathering, look.rich);
  eaves(scene);
  enrich(scene, look.rich);
}

/** After a change from `before` to `look`, every finish whose program differs makes it again. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's scene, set in place.
export function refinish(scene: Object3D, before: Look, look: Look): void {
  if (compiled(before) === compiled(look)) return;

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's part.
  scene.traverse((part) => {
    if (part instanceof Mesh && part.material instanceof Material) part.material.needsUpdate = true;
  });
}
