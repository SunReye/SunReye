// What a studio has on show (ADR 20): one built group at a time, and its lamps.
import { Box3, BufferGeometry, Material, Mesh, Sphere, type Group, type Object3D } from "three";
import type { Studio } from "./studio.ts";
import { lamps } from "./wall-openings.ts";
import { DRY, type SceneWeather } from "./weather.ts";
import { weathered } from "./weathered.ts";

export type { SceneWeather };

/** Frees a drawn part's meshes; textures are shared and stay. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js frees in place.
function free(part: Object3D): void {
  if (part instanceof Mesh) {
    if (part.geometry instanceof BufferGeometry) part.geometry.dispose();

    if (part.material instanceof Material) part.material.dispose();
  }

  for (const child of part.children) free(child);
}

export interface Staged {
  /** Draws `group` in place of the last, which it frees; the sun's shadow and the floor fit it. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws it.
  readonly show: (group: Group) => void;
  /** Frees the drawn group and the studio. */
  readonly dispose: () => void;
  /** How far the house's lamps are on. */
  readonly lamp: (level: number) => void;
  /** Wets, snows on and dries what is drawn, and what is drawn after. */
  readonly weather: (weather: SceneWeather | undefined) => void;
}

/** Draws one group at a time in `studio`, freeing the last. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws in it.
export function stage(studio: Studio): Staged {
  let drawn: Group | undefined;
  let lamplight = 0;
  let sky = DRY;

  return {
    lamp(level) {
      lamplight = level;

      if (drawn !== undefined) lamps(drawn, level);
    },
    weather(weather = DRY) {
      sky = weather;

      if (drawn !== undefined) weathered(drawn, weather);
    },
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws it.
    show(group) {
      if (drawn !== undefined) {
        studio.scene.remove(drawn);
        free(drawn);
      }

      lamps(group, lamplight);
      weathered(group, sky);
      studio.scene.add(group);
      drawn = group;

      const bounds = new Box3().setFromObject(group).getBoundingSphere(new Sphere());

      if (bounds.isEmpty()) bounds.center.set(0, 0, 0);

      studio.frame(bounds.center, bounds.radius);
    },
    dispose() {
      if (drawn !== undefined) free(drawn);

      studio.dispose();
    },
  };
}
