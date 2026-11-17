// A studio drawn in this browser's 3D quality (ADR 20 Look, Rendering quality) and under what
// this browser draws of the weather (ADR 23 "Off switch"), and counted while it is on show: a
// strain the frame watch measures then is its drawing's too.
import { untrack } from "svelte";
import type { PerspectiveCamera } from "three";
import { motion } from "../motion/tier.svelte.ts";
import { weatherEffects } from "./effects.svelte.ts";
import { quality } from "./quality.svelte.ts";
import type { Look } from "./quality.ts";
import { Studio } from "./studio.ts";
import { lightAlone, type SceneWeather } from "./weather.ts";

export interface Opened {
  readonly studio: Studio;
  /** What the studio is to draw now: read in an effect, it follows the choice and the tier. */
  readonly look: () => Look;
  /** What the studio is to draw of `given`: read in an effect, it follows the Wettereffekte
   * switch. */
  readonly weather: (given: SceneWeather | undefined) => SceneWeather | undefined;
  /** The studio is off show. */
  readonly close: () => void;
}

/** What this browser draws now: its 3D quality on its motion tier. */
const look = (): Look => quality.look(motion.tier);

/** What this browser draws of `given`: its light alone while the Wettereffekte switch is off. */
const weather = (given: SceneWeather | undefined): SceneWeather | undefined =>
  given === undefined || weatherEffects.on ? given : lightAlone(given);

/** A studio on `canvas` in the look of the moment. */
export function openStudio(
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws on it.
  canvas: HTMLCanvasElement,
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  camera: PerspectiveCamera,
): Opened {
  // Untracked: a caller's effect makes the studio once, and its own follows the look.
  const studio = new Studio(canvas, camera, (gpu) =>
    untrack(() => {
      quality.see(gpu);

      return look();
    }),
  );

  const hide = quality.show();
  const unwatch = motion.watch();

  return {
    studio,
    look,
    weather,
    close() {
      unwatch();
      hide();
    },
  };
}
