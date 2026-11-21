// The weather device's stored series over a span (ADR 17, 23): its history and its forecasts,
// each source one read of every series it has (ADR 9).
import { WEATHER, type Forecasts, type History, type Problem } from "../api/core.ts";
import type { DetailRole, Held, Span, WeatherReader } from "./weather.ts";

/** A forecast value is in force this long at most: the hourly quantities' step. */
const STEP = 3_600_000;

type Interval = History["points"][number];

type Target = Forecasts["points"][number];

const measured = (points: readonly Readonly<Interval>[]): Held[] =>
  points.map(({ start, end, mean }) => ({
    from: Date.parse(start),
    to: Date.parse(end),
    value: mean,
  }));

function forecast(points: readonly Readonly<Target>[]): Held[] {
  const begun = points.map(({ target }) => Date.parse(target));

  return points.map(({ value }, i) => {
    const start = begun[i] ?? 0;

    return { from: start, to: Math.min(begun[i + 1] ?? Infinity, start + STEP), value };
  });
}

/** Why a source was not read whole: the core's first refusal, none for a lost core. */
interface Unread {
  readonly refused: Problem | undefined;
}

interface Source {
  readonly held: ReadonlyMap<DetailRole, Held[]>;
  readonly unread: Unread | undefined;
}

/** Each of `roles` from one source, read together; a series the core refuses or fails is empty. */
async function source<P>(
  roles: readonly DetailRole[],
  read: (roles: readonly DetailRole[]) => Promise<readonly (Readonly<{ points: P }> | Problem)[]>,
  held: (points: P) => Held[],
): Promise<Source> {
  if (roles.length === 0) return { held: new Map(), unread: undefined };

  const answers = await read(roles).catch(() => null);
  const refused = answers?.find((a): a is Problem => "problem" in a);

  const out = new Map(
    roles.map((role, i): [DetailRole, Held[]] => {
      const answer = answers?.[i];

      return [role, answer !== undefined && "points" in answer ? held(answer.points) : []];
    }),
  );

  return {
    held: out,
    unread: answers === null ? { refused: undefined } : refused && { refused },
  };
}

/**
 * Each of `series` from both sources, one read a source; a series refused or failed is empty, and
 * `unread` says why.
 */
export async function stored(
  core: WeatherReader,
  series: readonly Readonly<{ role: DetailRole; history: boolean; forecasts: boolean }>[],
  spans: Readonly<{ past: Span; ahead: Span }>,
) {
  const [past, ahead] = await Promise.all([
    source(
      series.flatMap((s) => (s.history ? [s.role] : [])),
      (roles) => core.history(WEATHER, roles, ...spans.past),
      measured,
    ),
    source(
      series.flatMap((s) => (s.forecasts ? [s.role] : [])),
      (roles) => core.forecasts(WEATHER, roles, ...spans.ahead),
      forecast,
    ),
  ]);

  return {
    past: (role: DetailRole) => past.held.get(role) ?? [],
    ahead: (role: DetailRole) => ahead.held.get(role) ?? [],
    unread: past.unread ?? ahead.unread,
  };
}
