// The dashboard scene's sky (ADR 20 Look): how diffuse the light is now, from the weather
// forecast, read again as it moves on.
import type { Core } from "../api/core.ts";
import { diffuseAt, irradiance, type Irradiance } from "../scene/diffuse.ts";

const HOUR = 3_600_000;

/** The forecast's step: the weather is read again this often, as the scene's sun moves on. */
const STEP = 15 * 60_000;

export class LiveSky {
  #now = $state(Date.now());

  /** The forecast irradiance around now. */
  #weather = $state.raw<Irradiance>();

  /** How diffuse the sky's light is now, 0 to 1; null without weather for now. */
  readonly diffuse = $derived(diffuseAt(this.#weather, this.#now));

  /** Reads from what `core` gives; call during a component's set-up. */
  constructor(core: () => Pick<Core, "forecasts">) {
    $effect(() => {
      const timer = setInterval(() => {
        this.#now = Date.now();
      }, STEP);

      return () => {
        clearInterval(timer);
      };
    });

    // A failed read keeps a clear sky.
    $effect(() => {
      const now = this.#now;
      const reader = core();
      let current = true;

      void (async () => {
        const read = await irradiance(reader, new Date(now - HOUR), new Date(now + HOUR));

        if (current) this.#weather = read;
      })();

      return () => {
        current = false;
      };
    });
  }
}
