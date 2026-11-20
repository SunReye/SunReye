// Range reads held (ADR 11): the series of one device, range and period asked in the same task go
// as one read; a series in flight is joined.
import type { Problem } from "./client";
import type { Core, Forecasts, History, Statistics } from "./core";

/** One series' answer. */
type Answer = Readonly<{ series: string }>;

export type Reads = Pick<Core, "history" | "statistics" | "forecasts">;

/** Each of `series` of one range, refused or not, in order. */
type Ask<T> = (series: readonly string[]) => Promise<readonly (T | Problem)[]>;

/** One kind of range read, coalesced by range and task and joined in flight. */
class Ranges<T extends Answer> {
  /** Each series in flight, by range and series. */
  readonly #waiting = new Map<string, PromiseWithResolvers<T | Problem>>();
  /** The series of each range asked in this task. */
  readonly #pending = new Map<string, string[]>();

  /** Each of `series` over the range `range` names. */
  read(range: string, ask: Ask<T>, series: readonly string[]) {
    return Promise.all(
      series.map((name) => {
        const key = `${range}\n${name}`;

        return this.#waiting.get(key)?.promise ?? this.#wait(range, ask, name);
      }),
    );
  }

  #wait(range: string, ask: Ask<T>, name: string) {
    const names = this.#pending.get(range);

    if (names === undefined) {
      this.#pending.set(range, [name]);
      queueMicrotask(() => {
        void this.#send(range, ask);
      });
    } else names.push(name);

    const waiting = Promise.withResolvers<T | Problem>();

    this.#waiting.set(`${range}\n${name}`, waiting);

    return waiting.promise;
  }

  async #send(range: string, ask: Ask<T>) {
    const names = this.#pending.get(range) ?? [];

    const take = (name: string) => {
      const key = `${range}\n${name}`;
      const waiting = this.#waiting.get(key);

      this.#waiting.delete(key);

      return waiting;
    };

    this.#pending.delete(range);

    try {
      const answers = await ask(names);

      for (const [i, name] of names.entries())
        take(name)?.resolve(answers[i] ?? { problem: "request.query" });
    } catch (error) {
      for (const name of names) take(name)?.reject(error);
    }
  }
}

const at = (from: Readonly<Date>, to: Readonly<Date>) =>
  `${from.toISOString()}/${to.toISOString()}`;

/** `core`'s range reads held. */
export function holding(core: Readonly<Reads>): Reads {
  const history = new Ranges<History>();
  const statistics = new Ranges<Statistics>();
  const forecasts = new Ranges<Forecasts>();

  return {
    history: (device, series, from, to) =>
      history.read(
        `${device}/${at(from, to)}`,
        (names) => core.history(device, names, from, to),
        series,
      ),
    statistics: (device, series, period, from, to) =>
      statistics.read(
        `${device}/${period}/${at(from, to)}`,
        (names) => core.statistics(device, names, period, from, to),
        series,
      ),
    forecasts: (device, series, from, to) =>
      forecasts.read(
        `${device}/${at(from, to)}`,
        (names) => core.forecasts(device, names, from, to),
        series,
      ),
  };
}
