// Range reads held (ADR 11): the series of one device, range and period asked in the same task go
// as one read; a series in flight is joined; a closed range is kept for the session.
import type { Problem } from "./client";
import type { Core, Forecasts, History, Statistics } from "./core";

/** The most points kept across every closed range. */
const KEPT_POINTS = 200_000;

const HOUR = 3_600_000;

/** A point of a history or statistics, which ends, or of forecasts, which has a target. */
type Point = Readonly<{ end: string } | { target: string }>;

/** One series' answer. */
type Answer = Readonly<{ series: string; points: readonly Point[] }>;

export type Reads = Pick<Core, "history" | "statistics" | "forecasts">;

/** Each of `series` of one range, refused or not, in order. */
type Ask<T> = (series: readonly string[]) => Promise<readonly (T | Problem)[]>;

/** Where an answer's last point ends. */
function lastEnd(points: readonly Point[]): number {
  let last = -Infinity;

  for (const p of points) last = Math.max(last, Date.parse("end" in p ? p.end : p.target));

  return last;
}

/**
 * Whether an answer over a range ending at `to` no longer moves: it ends, and its last point
 * ends, by the start of the previous hour, whose rollup is still being written.
 */
function closed(to: number, answer: Answer, now: number): boolean {
  const boundary = Math.floor(now / HOUR) * HOUR - HOUR;

  return to <= boundary && lastEnd(answer.points) <= boundary;
}

/** Closed answers by key, least recently used first, at most `KEPT_POINTS` points together. */
function kept<T extends Answer>() {
  const answers = new Map<string, T>();
  let points = 0;

  return {
    get: (key: string): T | undefined => {
      const known = answers.get(key);

      if (known !== undefined) {
        answers.delete(key);
        answers.set(key, known);
      }

      return known;
    },
    set: (key: string, answer: T): void => {
      if (answer.points.length > KEPT_POINTS || answers.has(key)) return;

      answers.set(key, answer);
      points += answer.points.length;

      for (const [old, { points: dropped }] of answers) {
        if (points <= KEPT_POINTS) break;

        answers.delete(old);
        points -= dropped.length;
      }
    },
    clear: (): void => {
      answers.clear();
      points = 0;
    },
  };
}

/** One kind of range read, coalesced by range and task, joined in flight and kept once closed. */
class Ranges<T extends Answer> {
  readonly #kept = kept<T>();
  /** Each series in flight, by range and series. */
  readonly #waiting = new Map<string, PromiseWithResolvers<T | Problem>>();
  /** The series of each range asked in this task. */
  readonly #pending = new Map<string, string[]>();
  // Bumped by `forget`: an answer asked before it is not kept.
  #generation = 0;

  forget(): void {
    this.#generation += 1;
    this.#kept.clear();
  }

  /** Each of `series` over the range `range` names, ending at `to`. */
  read(range: string, to: number, ask: Ask<T>, series: readonly string[]) {
    return Promise.all(
      series.map((name) => {
        const key = `${range}\n${name}`;
        const known = this.#kept.get(key);

        if (known !== undefined) return Promise.resolve(known);

        return this.#waiting.get(key)?.promise ?? this.#wait(range, to, ask, name);
      }),
    );
  }

  #wait(range: string, to: number, ask: Ask<T>, name: string) {
    const names = this.#pending.get(range);

    if (names === undefined) {
      this.#pending.set(range, [name]);
      queueMicrotask(() => {
        void this.#send(range, to, ask);
      });
    } else names.push(name);

    const waiting = Promise.withResolvers<T | Problem>();

    this.#waiting.set(`${range}\n${name}`, waiting);

    return waiting.promise;
  }

  async #send(range: string, to: number, ask: Ask<T>) {
    const names = this.#pending.get(range) ?? [];
    const asked = this.#generation;

    const take = (name: string) => {
      const key = `${range}\n${name}`;
      const waiting = this.#waiting.get(key);

      this.#waiting.delete(key);

      return { key, waiting };
    };

    this.#pending.delete(range);

    try {
      const answers = await ask(names);

      for (const [i, name] of names.entries()) {
        const { key, waiting } = take(name);
        const answer = answers[i] ?? { problem: "request.query" };

        if (asked === this.#generation && "points" in answer && closed(to, answer, Date.now()))
          this.#kept.set(key, answer);

        waiting?.resolve(answer);
      }
    } catch (error) {
      for (const name of names) take(name).waiting?.reject(error);
    }
  }
}

const at = (from: Readonly<Date>, to: Readonly<Date>) =>
  `${from.toISOString()}/${to.toISOString()}`;

/** `core`'s range reads held, with `forget` to drop every closed range kept. */
export function holding(core: Readonly<Reads>): Reads & { readonly forget: () => void } {
  const history = new Ranges<History>();
  const statistics = new Ranges<Statistics>();
  const forecasts = new Ranges<Forecasts>();

  return {
    history: (device, series, from, to) =>
      history.read(
        `${device}/${at(from, to)}`,
        to.getTime(),
        (names) => core.history(device, names, from, to),
        series,
      ),
    statistics: (device, series, period, from, to) =>
      statistics.read(
        `${device}/${period}/${at(from, to)}`,
        to.getTime(),
        (names) => core.statistics(device, names, period, from, to),
        series,
      ),
    forecasts: (device, series, from, to) =>
      forecasts.read(
        `${device}/${at(from, to)}`,
        to.getTime(),
        (names) => core.forecasts(device, names, from, to),
        series,
      ),
    forget: () => {
      history.forget();
      statistics.forget();
      forecasts.forget();
    },
  };
}
