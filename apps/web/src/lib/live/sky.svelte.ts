// The dashboard scene's sky (ADR 20 Look, ADR 23): the weather now, read again as it moves on.
import type { Core } from "../api/core.ts";
import { sceneWeather, type Plant, type SceneWeather } from "@sunreye/builder/canvas";
import { weatherNow } from "../weather/now.ts";
import { weatherAt, type WeatherRead } from "../weather/weather.ts";

/** The forecast's step: the weather is read again this often, as the scene's sun moves on. */
const STEP = 15 * 60_000;

export class LiveSky {
  #now = $state(Date.now());

  /** The stored weather around an instant, and that instant: the last read stands until the
   * next lands, so no quantity lapses between the two. */
  #read = $state.raw<readonly [WeatherRead, number]>();

  /** The weather now; nothing of it without weather for now. */
  readonly weather = $derived(this.#read ? weatherAt(...this.#read) : weatherAt(undefined, 0));

  /** The scene's weather now, for what the `plant` reads (ADR 23). */
  readonly scene = (plant: Plant): SceneWeather => sceneWeather(this.weather, plant);

  /** Reads from what `core` gives; call during a component's set-up. */
  constructor(core: () => Pick<Core, "history" | "forecasts">) {
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
        const read = await weatherNow(reader, now);

        if (current) this.#read = read;
      })();

      return () => {
        current = false;
      };
    });
  }
}
