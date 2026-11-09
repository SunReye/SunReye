// The time slider's instant (ADR 20): the day and time the admin picks, the sun then and each
// string's production. It reads the draft and never writes it: nothing changes the scene.
import { load, sunward, wattsAt, type Day, type Reading } from "./moment.ts";
import type { Point } from "./pv.ts";

/** `YYYY-MM-DD` of `date` in the browser's calendar, as a date input holds it. */
function calendarDay(date: Readonly<Date>): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

const MINUTE = 60_000;

export class Moment {
  day = $state(calendarDay(new Date()));
  /** Since the day's midnight. */
  minutes = $state(12 * 60);

  /** The day's production once read, by string position. */
  production = $state.raw<Day>();

  /** Milliseconds since 1970; NaN while the day is cleared. */
  readonly at = $derived(new Date(`${this.day}T00:00`).getTime() + this.minutes * MINUTE);

  readonly #reading: () => Omit<Reading, "day" | "today">;

  /** Reads the day for what `reading` gives; call during a component's set-up. */
  constructor(reading: () => Omit<Reading, "day" | "today">) {
    this.#reading = reading;

    $effect(() => {
      const asked = { ...this.#reading(), day: this.day, today: calendarDay(new Date()) };
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
  }

  /** Toward the sun, or null without the plant's location. */
  get sun(): Point | null {
    const { pv, location } = this.#reading();

    return location === undefined || Number.isNaN(this.at)
      ? null
      : sunward(pv.sun(Math.floor(this.at / 1000), location));
  }

  /** Each string's watts at the instant, null without a value. */
  get watts(): (number | null)[] {
    const { draft } = this.#reading();

    return draft.strings.map((_, i) =>
      this.production === undefined ? null : wattsAt(this.production.strings[i] ?? [], this.at),
    );
  }
}
