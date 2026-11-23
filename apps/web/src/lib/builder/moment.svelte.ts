// The time slider's instant (ADR 20): the day and time the admin picks, the sun then, the weather
// and each string's production. It reads the draft and never writes it: nothing changes the scene.
import { today } from "./day.ts";
import { load, shareAt, spanOf, wattsAt, type Day, type Reading } from "./moment.ts";
import { sunAt, type Point } from "@sunreye/builder/builder/pv.ts";
import { exact, type SceneWeather } from "@sunreye/builder/scene/weather.ts";
import { sceneWeather } from "../weather/scene-weather.ts";
import { readWeather, weatherAt, type Weather, type WeatherRead } from "../weather/weather.ts";
import { TRIAL_WEATHER, type Trial } from "./trials.ts";

const MINUTE = 60_000;

export class Moment {
  day = $state(today());
  /** Since the day's midnight. */
  minutes = $state(12 * 60);

  /** The day's production once read, by string position. */
  production = $state.raw<Day>();

  /** A trial weather in place of the stored one (ADR 23 "Builder"); null for the stored. */
  trial = $state<Trial | null>(null);

  /** The day's stored weather once read, and when: the scene's sky. */
  #weather = $state.raw<readonly [WeatherRead, number]>();

  /** Milliseconds since 1970; NaN while the day is cleared. */
  readonly at = $derived(new Date(`${this.day}T00:00`).getTime() + this.minutes * MINUTE);

  readonly #reading: () => Omit<Reading, "day" | "today">;

  readonly #editing: () => boolean;

  /** Reads the day for what `reading` gives; call during a component's set-up. `editing` tells
   * whether the admin edits now: asked apart, so that it never reads the day anew. */
  constructor(reading: () => Omit<Reading, "day" | "today">, editing: () => boolean) {
    this.#reading = reading;
    this.#editing = editing;

    $effect(() => {
      const asked = { ...this.#reading(), day: this.day, today: today() };
      let current = true;

      // A cleared day input keeps the last day's values.
      if (asked.day !== "") {
        void (async () => {
          const loaded = await load(asked);

          if (current) this.production = loaded;
        })();
      }

      return () => {
        current = false;
      };
    });

    // Apart from the production: the weather changes with the day alone, never with the draft.
    $effect(() => {
      const { core } = this.#reading();
      const { day } = this;
      let current = true;

      if (day !== "") {
        void (async () => {
          const asOf = Date.now();
          const read = await readWeather(core, ...spanOf(day));

          if (current) this.#weather = [read, asOf];
        })();
      }

      return () => {
        current = false;
      };
    });
  }

  /** The trial, or the weather at the instant; nothing of it without weather for it. */
  get weather(): Weather {
    if (this.trial !== null) return TRIAL_WEATHER[this.trial];

    const [read, asOf] = this.#weather ?? [];

    return weatherAt(read, this.at, asOf);
  }

  /** Toward the sun, or null without the plant's location. */
  get sun(): Point | null {
    const { pv, location } = this.#reading();

    return location === undefined || Number.isNaN(this.at) ? null : sunAt(pv, location, this.at);
  }

  /** The scene's weather at the instant, as the dashboard shows it; while the admin edits,
   * without fog, wet ground, what falls and the glass (ADR 23 "Builder"). Snow covers the modules
   * only where the day's production was measured. */
  get scene(): SceneWeather {
    const { draft, moduleTypes } = this.#reading();
    const share = shareAt(this.production, draft.strings, moduleTypes, this.at);
    const weather = sceneWeather(this.weather, { sun: this.sun, share });

    return this.#editing() ? exact(weather) : weather;
  }

  /** Each string's watts at the instant, null without a value. */
  get watts(): (number | null)[] {
    const { draft } = this.#reading();

    return draft.strings.map((_, i) =>
      this.production === undefined ? null : wattsAt(this.production.strings[i] ?? [], this.at),
    );
  }
}
