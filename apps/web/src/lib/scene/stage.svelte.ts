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
import { DRY, stage, type SceneWeather, type Staged } from "./staged.ts";
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
  /** Draws `group` in place of the last, which it frees; the sun's shadow and the floor fit it. */
  readonly show: Staged["show"];
  /** When it draws: nothing before `opening.open` has prepared it. */
  readonly opening: Opening;
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

type Falling = NonNullable<SceneWeather["falling"]>;

type Glass = NonNullable<SceneWeather["glass"]>;

/** What falls, anew only when a value of it changed. */
function steadyFalling(given: () => Falling | null): () => Falling | null {
  const kind = $derived(given()?.kind);
  const density = $derived(given()?.density ?? 0);
  const east = $derived(given()?.wind[0] ?? 0);
  const north = $derived(given()?.wind[1] ?? 0);

  const falling = $derived(
    kind === undefined ? null : { kind, density, wind: [east, north] as const },
  );

  return () => falling;
}

/** What is on the lens, anew only when a value of it changed. */
function steadyGlass(given: () => Glass | null): () => Glass | null {
  const on = $derived(given() !== null);
  const rain = $derived(given()?.rain ?? 0);
  const snow = $derived(given()?.snow ?? 0);
  const frost = $derived(given()?.frost ?? 0);
  const glass = $derived(on ? { rain, snow, frost } : null);

  return () => glass;
}

/**
 * The light and the weather of `sky`, each anew only when a value of it changed: a live tick
 * asks for the same weather again and must light nothing. Each value is derived on its own and
 * the weather composed of them, as a derived value that comes out the same wakes nothing. The
 * studio's `look` tells whether it draws the lens glass, and `weatherOf` what it draws of a
 * weather.
 */
function steadied(sky: () => Sky, look: Opened["look"], weatherOf: Opened["weather"]) {
  const sun = $derived(sky().sun);
  const diffuse = $derived(sky().diffuse);
  const read = $derived(weatherOf(sky().weather));
  const known = $derived(read !== undefined);
  const given = $derived(read ?? DRY);
  const fog = $derived(given.fog);
  const wet = $derived(given.wet);
  const snow = $derived(given.snow);
  const covered = $derived(given.covered);
  const thunder = $derived(given.thunder);
  // Apart from the rest: the ground drying under it must not start the loop over.
  const falling = steadyFalling(() => given.falling);
  const whole = steadyGlass(() => given.glass);

  const weather = $derived(
    known ? { fog, wet, snow, covered, thunder, falling: falling(), glass: whole() } : undefined,
  );

  // None where the look draws none, at Niedrig: no loop is kept for it there.
  const glass = $derived(look().glass ? whole() : null);
  const day = $derived(daylight(sun, diffuse, thunder));

  return {
    get day() {
      return day;
    },
    get weather() {
      return weather;
    },
    get falling() {
      return falling();
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
  const { studio, look, weather, settle, close } = openStudio(canvas, camera);
  const opened = new Opening(studio, drawn, settle);
  const { flight, render } = opened;
  const shown = stage(studio);
  const steady = steadied(sky, look, weather);
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
      easeGlow(group, shares, glow, opened);
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
