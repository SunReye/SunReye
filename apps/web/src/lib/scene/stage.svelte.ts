// The studio kept lit for a canvas (ADR 20 Look): the sun, the theme and the 3D quality, each
// change drawn once. Call during a component's set-up.
import { createSubscriber } from "svelte/reactivity";
import type { Group, PerspectiveCamera } from "three";
import type { Glow } from "../builder/scene.ts";
import { motion } from "../motion/tier.svelte.ts";
import { cssColour, flowRgb } from "./backdrop.ts";
import { daylight, theme } from "./light.ts";
import { easeGlow } from "./live-glow.svelte.ts";
import { Opening } from "./opening.svelte.ts";
import { stage, type Staged } from "./staged.ts";
import { openStudio, type Opened } from "./studio-look.svelte.ts";

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

/** Why a scene is not drawn: "webgl2" when this browser has none. */
export type SceneFailure = "webgl2" | "failed";

/** The picture without newly parked cars, held over the canvas while they fade in beneath it. */
export class Ghost {
  canvas = $state<HTMLCanvasElement>();
  phase = $state<"off" | "hold" | "fade">("off");

  /** The still tier shows them at once. */
  get instant(): boolean {
    return motion.still;
  }
}

export interface Lit {
  readonly studio: Opened["studio"];
  /** The camera's flight to a new view; it lands at once on the still tier. */
  readonly flight: Opening["flight"];
  /** The string glow now: read in an effect, it follows the sun and the theme. */
  readonly glow: () => Glow;
  /** Relights `drawn` on each live tick, easing to the new `shares` (ADR 21). */
  readonly ease: (
    drawn: () => Group | undefined,
    shares: () => readonly (number | null)[] | undefined,
  ) => void;
  /** Draws `group` in place of the last, which it frees; the sun's shadow and the lawn fit it. */
  readonly show: Staged["show"];
  /** When it draws: nothing before `opening.open` has prepared it. */
  readonly opening: Opening;
  /** Frees the drawn group and the studio. */
  readonly dispose: () => void;
}

/** A studio on `canvas`, lit by `sky`, drawn after each change; `drawn` follows each draw. The
 * sky is the sun (null for a fixed one) and how diffuse its light is (null for a clear sky). */
export function lit(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws on it.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  camera: PerspectiveCamera,
  sky: () => Readonly<{ sun: Parameters<typeof daylight>[0]; diffuse: number | null }>,
  drawn: () => void,
): Lit {
  const { studio, look, close } = openStudio(canvas, camera);
  const opened = new Opening(studio, drawn);
  const { flight } = opened;
  const { render } = opened;
  const shown = stage(studio, render);
  const day = $derived(daylight(sky().sun, sky().diffuse));
  let colour = $state(0);

  $effect(() => {
    studio.light(day, theme(dark()), cssColour("var(--background)"));
    shown.lamp(day.lamps);
    colour = flowRgb("solar").getHex();
    render();
  });

  $effect(() => {
    studio.follow(look());
    shown.dress();
    render();
  });

  const glow = (): Glow => ({ colour, daylight: day.glow });

  return {
    studio,
    flight,
    glow,
    ease: (group, shares) => {
      easeGlow(group, shares, glow, render);
    },
    opening: opened,
    show: shown.show,
    dispose() {
      close();
      opened.dispose();
      shown.dispose();
    },
  };
}
