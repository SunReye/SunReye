// The studio kept lit for a canvas (ADR 20 Look): the sun, the theme and the motion tier, each
// change drawn once. Call during a component's set-up.
import { createSubscriber } from "svelte/reactivity";
import {
  Box3,
  BufferGeometry,
  Material,
  Mesh,
  Sphere,
  Vector3,
  type Group,
  type Object3D,
  type PerspectiveCamera,
} from "three";
import type { Point } from "../builder/pv.ts";
import type { Glow } from "../builder/scene.ts";
import { motion } from "../motion/tier.svelte.ts";
import { cssColour } from "./backdrop.ts";
import { daylight, theme } from "./light.ts";
import { Flight } from "./flight.ts";
import { easeGlow } from "./live-glow.svelte.ts";
import { Studio } from "./studio.ts";

/** Follows mode-watcher's class on the root element. */
const themed = createSubscriber((update) => {
  const watch = new MutationObserver(update);

  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return () => {
    watch.disconnect();
  };
});

function dark(): boolean {
  themed();

  return document.documentElement.classList.contains("dark");
}

export interface Lit {
  readonly studio: Studio;
  /** The camera's flight to a new view; it lands at once on the still tier. */
  readonly flight: Flight;
  /** The string glow now: read in an effect, it follows the sun and the theme. */
  readonly glow: () => Glow;
  /** Relights `drawn` on each live tick, easing to the new `shares` (ADR 21). */
  readonly ease: (
    drawn: () => Group | undefined,
    shares: () => readonly (number | null)[] | undefined,
  ) => void;
  /** Draws `group` in place of the last, which it frees; the sun's shadow and the lawn fit it. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws it.
  readonly show: (group: Group) => void;
  /** Frees the drawn group and the studio. */
  readonly dispose: () => void;
}

/** Frees a drawn part's meshes; textures are shared and stay. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js frees in place.
function free(part: Object3D): void {
  if (part instanceof Mesh) {
    if (part.geometry instanceof BufferGeometry) part.geometry.dispose();

    if (part.material instanceof Material) part.material.dispose();
  }

  for (const child of part.children) free(child);
}

/** Casts and catches the sun's shadow. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js sets it in place.
function shadowed(part: Object3D): void {
  part.castShadow = true;
  part.receiveShadow = true;

  for (const child of part.children) shadowed(child);
}

/** Draws one group at a time in `studio`, freeing the last. */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws in it.
function stage(studio: Studio): Pick<Lit, "show" | "dispose"> {
  let drawn: Group | undefined;

  return {
    // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws it.
    show(group) {
      shadowed(group);

      if (drawn !== undefined) {
        studio.scene.remove(drawn);
        free(drawn);
      }

      studio.scene.add(group);
      drawn = group;

      const bounds = new Box3().setFromObject(group).getBoundingSphere(new Sphere());

      studio.frame(bounds.isEmpty() ? new Vector3() : bounds.center, bounds.radius);
    },
    dispose() {
      if (drawn !== undefined) free(drawn);

      studio.dispose();
    },
  };
}

/** A studio on `canvas`, lit by `sun` (null for a fixed one); `render` draws after each change. */
export function lit(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws on it.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  camera: PerspectiveCamera,
  sun: () => Point | null,
  render: () => void,
): Lit {
  const studio = new Studio(canvas, camera);
  const day = $derived(daylight(sun()));
  let colour = $state(0);

  $effect(() => {
    studio.light(day, theme(dark()), cssColour("var(--background)"));
    colour = cssColour("var(--e-solar)").getHex();
    render();
  });

  $effect(() => {
    studio.follow(motion.tier);
    render();
  });

  const glow = (): Glow => ({ colour, daylight: day.glow });

  return {
    studio,
    flight: new Flight(() => motion.still),
    glow,
    ease: (drawn, shares) => {
      easeGlow(drawn, shares, glow, render);
    },
    ...stage(studio),
  };
}
