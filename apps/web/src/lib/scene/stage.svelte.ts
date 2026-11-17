// The studio kept lit for a canvas (ADR 20 Look): the sun, the theme and the 3D quality, each
// change drawn once. Call during a component's set-up.
import { createSubscriber } from "svelte/reactivity";
import type { Group, PerspectiveCamera } from "three";
import type { Glow } from "../builder/scene.ts";
import { motion } from "../motion/tier.svelte.ts";
import { cssColour, flowRgb } from "./backdrop.ts";
import { weatherEffects } from "./effects.svelte.ts";
import { daylight, theme } from "./light.ts";
import { easeGlow } from "./live-glow.svelte.ts";
import { Opening } from "./opening.svelte.ts";
import { stage, type SceneWeather, type Staged } from "./staged.ts";
import { openStudio, type Opened } from "./studio-look.svelte.ts";
import { lightAlone } from "./weather.ts";

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
  /** Draws `group` in place of the last, which it frees; the sun's shadow and the floor fit it. */
  readonly show: Staged["show"];
  /** When it draws: nothing before `opening.open` has prepared it. */
  readonly opening: Opening;
  /**
   * The weather loop (ADR 23 "Motion"): `keep(step)` runs it while something moves, `step` told
   * the seconds it has run before each frame, until the release returned is called. It draws 30
   * frames a second at most, on the full tier alone, and not while the tab is hidden or the
   * canvas off screen.
   */
  readonly loop: Pick<Opening["loop"], "keep" | "running">;
  /** Frees the drawn group and the studio. */
  readonly dispose: () => void;
}

/** The sun (null for a fixed one), how diffuse its light is (null for a clear sky) and the
 * scene's weather (none, clear and dry). */
export interface Sky {
  readonly sun: Parameters<typeof daylight>[0];
  readonly diffuse: number | null;
  readonly weather: SceneWeather | undefined;
}

/** `next`, or `last` where it says the same. */
const same = <T>(last: T, next: T): T =>
  JSON.stringify(next) === JSON.stringify(last) ? last : next;

/** The light and the weather of `sky`, each anew only when a value of it changed: a live tick
 * asks for the same weather again and must light nothing. `glazing` tells whether the look
 * draws the lens glass. */
function steadied(sky: () => Sky, glazing: () => boolean) {
  const sun = $derived(sky().sun);
  const diffuse = $derived(sky().diffuse);
  let last: Sky["weather"];
  let fell: NonNullable<Sky["weather"]>["falling"] = null;
  let glazed: NonNullable<Sky["weather"]>["glass"] = null;

  const weather = $derived.by(() => {
    const given = sky().weather;

    // Its light alone while this browser's Wettereffekte switch is off (ADR 23 "Off switch").
    last = same(last, given === undefined || weatherEffects.on ? given : lightAlone(given));

    return last;
  });

  // Apart from the rest: the ground drying under it must not start the loop over.
  const falling = $derived.by(() => {
    fell = same(fell, weather?.falling ?? null);

    return fell;
  });

  // As what falls is: the glass fades by itself, and a drying ground must not start it over.
  // None where the look draws none, at Niedrig: no loop is kept for it there.
  const glass = $derived.by(() => {
    glazed = same(glazed, glazing() ? (weather?.glass ?? null) : null);

    return glazed;
  });

  const day = $derived(daylight(sun, diffuse, weather?.thunder));

  return {
    get day() {
      return day;
    },
    get weather() {
      return weather;
    },
    get falling() {
      return falling;
    },
    get glass() {
      return glass;
    },
  };
}

/** A studio on `canvas`, lit by `sky` and under its weather, drawn after each change; `drawn`
 * follows each draw. */
export function lit(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws on it.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  camera: PerspectiveCamera,
  sky: () => Sky,
  drawn: () => void,
): Lit {
  const { studio, look, close } = openStudio(canvas, camera);
  const opened = new Opening(studio, drawn);
  const { flight, render } = opened;
  const shown = stage(studio);
  const steady = steadied(sky, () => look().glass);
  const day = $derived(steady.day);
  let colour = $state(0);

  $effect(() => {
    studio.light(day, theme(dark()), cssColour("var(--background)"), steady.weather);
    shown.lamp(day.lamps);
    shown.weather(steady.weather);
    colour = flowRgb("solar").getHex();
    render();
  });

  $effect(() => {
    studio.follow(look());
    render();
  });

  opened.moves(steady);

  const glow = (): Glow => ({ colour, daylight: day.glow });

  return {
    studio,
    flight,
    glow,
    ease: (group, shares) => {
      easeGlow(group, shares, glow, render);
    },
    opening: opened,
    loop: opened.loop,
    show: shown.show,
    dispose() {
      close();
      opened.dispose();
      shown.dispose();
    },
  };
}
