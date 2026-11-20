// The fake core the range-read tests ask: it answers each series it is asked and records every
// request.
import { connect } from "./core.ts";
import type { Visibility } from "./live.ts";

export const FROM = new Date("2026-11-12T00:00:00Z");
export const TO = new Date("2026-11-12T12:00:00Z");

/** Now: 2026-11-20 10:30 UTC, so a range ending by 09:00 is closed. */
export const NOW = new Date("2026-11-20T10:30:00Z");

export const DAY = { from: new Date("2026-11-19T00:00:00Z"), to: new Date("2026-11-19T09:00:00Z") };

/** A point ending at `end`. */
export const point = (end: string) => ({ start: "2026-11-12T00:00:00Z", end, mean: 1 });

/** The series each answer names; a refusal names one only where the core said which. */
export function named(read: readonly Readonly<{ series?: string }>[]): (string | undefined)[] {
  const names: (string | undefined)[] = [];

  for (const one of read) names.push(one.series);

  return names;
}

const ONE_POINT = [point("2026-11-12T01:00:00Z")];

/** A rejected read's error. */
export const failed = (error: Readonly<Error>) => error;

/** What the fake core answers and how. */
export type Options = Readonly<{
  refused?: readonly string[];
  points?: (series: string) => readonly object[];
  page?: Visibility;
  /** Each write is answered once this settles. */
  writes?: () => Promise<void>;
  /** Each range read is answered once this settles. */
  reads?: () => Promise<void>;
}>;

/** A range read's answer: each of `series` with `points(series)`, or the first `refused`. */
function answer(options: Options, statistics: boolean, series: readonly string[]): Response {
  const refused = series.find((s) => options.refused?.includes(s) === true);

  if (refused !== undefined)
    return Response.json(
      { status: 422, code: "history.range", series: refused },
      { status: 422, headers: { "content-type": "application/problem+json" } },
    );

  const kind = statistics ? { period: "day" } : { tier: "raw" };

  return Response.json({
    series: series.map((s) =>
      Object.assign({ series: s, points: options.points?.(s) ?? ONE_POINT }, kind),
    ),
  });
}

/** A fake core answering each series it is asked with `points(series)`, refusing those in
 * `refused` by name, with every request it was asked. */
export function fake(options: Options = {}) {
  const urls: string[] = [];
  const asked: (readonly string[])[] = [];

  const core = connect(
    {
      base: "http://core.test/",
      fetch: async (request) => {
        await Promise.resolve();

        if (request.method !== "GET") {
          await options.writes?.();

          return new Response(null, { status: 204 });
        }

        const url = new URL(request.url);
        const series = url.searchParams.getAll("series");

        urls.push(request.url);

        if (series.length > 0) asked.push(series);

        await options.reads?.();

        return answer(options, url.pathname.endsWith("/statistics"), series);
      },
    },
    options.page,
  );

  return { core, urls, asked };
}
