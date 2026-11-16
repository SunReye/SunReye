// What a studio has on show (ADR 20): one built group at a time, its lamps, and on Ultra the
// lawn's blades around it.
import { Box3, BufferGeometry, Material, Mesh, Sphere, type Group, type Object3D } from "three";
import { blades } from "./grass.ts";
import type { Studio } from "./studio.ts";
import { lamps } from "./wall-openings.ts";

/** Frees a drawn part's meshes; textures are shared and stay. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js frees in place.
export function free(part: Object3D): void {
  if (part instanceof Mesh) {
    if (part.geometry instanceof BufferGeometry) part.geometry.dispose();

    if (part.material instanceof Material) part.material.dispose();
  }

  for (const child of part.children) free(child);
}

/** How long after a change the lawn's blades grow again: an edit's drag changes the scene with
 * every step, and they are tens of thousands. */
const REGROW_MS = 300;

/** Ultra's grass blades on the lawn the drawn group leaves open (ADR 20 Rendering quality). */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws in it.
function turf(studio: Studio, render: () => void) {
  let grown: Object3D | undefined;
  let later: ReturnType<typeof setTimeout> | undefined;

  const clear = (): void => {
    if (grown === undefined) return;

    studio.scene.remove(grown);
    free(grown);
    grown = undefined;
  };

  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's group, read only.
  const plant = (group: Group, { center, radius }: Readonly<Sphere>): void => {
    clear();
    grown = blades(group, [center.x, center.z], radius) ?? undefined;

    if (grown !== undefined) studio.scene.add(grown);

    render();
  };

  return {
    /** Grows the blades for `group`: at once where none stand, else once the scene has settled. */
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js's group, read only.
    grow(group: Group | undefined, bounds: Readonly<Sphere>): void {
      clearTimeout(later);

      if (group === undefined || !studio.look.finest) clear();
      else if (grown === undefined) plant(group, bounds);
      else {
        later = setTimeout(() => {
          plant(group, bounds);
        }, REGROW_MS);
      }
    },
    dispose(): void {
      clearTimeout(later);
      clear();
    },
  };
}

export interface Staged {
  /** Draws `group` in place of the last, which it frees; the sun's shadow and the lawn fit it. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws it.
  readonly show: (group: Group) => void;
  /** Frees the drawn group and the studio. */
  readonly dispose: () => void;
  /** How far the house's lamps are on. */
  readonly lamp: (level: number) => void;
  /** The 3D quality changed: what it adds to the drawn group follows. */
  readonly dress: () => void;
}

/** Draws one group at a time in `studio`, freeing the last. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws in it.
export function stage(studio: Studio, render: () => void): Staged {
  let drawn: Group | undefined;
  let lamplight = 0;
  let bounds = new Sphere();
  const lawn = turf(studio, render);

  return {
    dress() {
      lawn.grow(drawn, bounds);
    },
    lamp(level) {
      lamplight = level;

      if (drawn !== undefined) lamps(drawn, level);
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws it.
    show(group) {
      if (drawn !== undefined) {
        studio.scene.remove(drawn);
        free(drawn);
      }

      lamps(group, lamplight);
      studio.dress(group);
      studio.scene.add(group);
      drawn = group;

      bounds = new Box3().setFromObject(group).getBoundingSphere(new Sphere());

      if (bounds.isEmpty()) bounds.center.set(0, 0, 0);

      studio.frame(bounds.center, bounds.radius);
      lawn.grow(group, bounds);
    },
    dispose() {
      lawn.dispose();

      if (drawn !== undefined) free(drawn);

      studio.dispose();
    },
  };
}
