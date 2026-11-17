// The dashboard scene's sky (ADR 20 Look, ADR 23): the weather now, read again as it moves on.
import type { Core } from "../api/core.ts";
import { readWeather, weatherAt, type WeatherRead } from "../weather/weather.ts";

const HOUR = 3_600_000;

/** The forecast's step: the weather is read again this often, as the scene's sun moves on. */
const STEP = 15 * 60_000;

export class LiveSky {
  #now = $state(Date.now());

  /** The stored weather around now. */
  #read = $state.raw<WeatherRead>();

  /** The weather now; nothing of it without weather for now. */
  readonly weather = $derived(weatherAt(this.#read, this.#now));

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
        const read = await readWeather(reader, new Date(now - HOUR), new Date(now + HOUR));

        if (current) this.#read = read;
      })();

      return () => {
        current = false;
      };
    });
  }
}
