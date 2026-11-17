// The plant's flows as the detail sheet tests serve them: each series' power by the hour.
import { PLANT, rollup, type Asked } from "./detail.harness.ts";

/** Each plant series' power in W by the UTC hour it starts. */
export type Flows = Readonly<Partial<Record<string, Readonly<Record<string, number>>>>>;

/** The plant's flows as hourly rollups, whatever period is asked for. */
export const plant =
  (flows: Flows) =>
  (a: Asked): Response | undefined => {
    if (a.device !== PLANT) return undefined;

    const [from, to] = [Date.parse(a.from), Date.parse(a.to)];

    const points = Object.entries(flows[a.series] ?? {})
      .map((e: readonly [string, number]) => [Date.parse(e[0]), e[1]] as const)
      .filter(([at]) => at >= from && at < to)
      .map(([at, watts]) => rollup(at, watts));

    return Response.json({ points, period: "hour" });
  };

/** `watts` in each of `hours` on `day`. */
export const hours = (day: string, at: readonly number[], watts: number) =>
  Object.fromEntries(at.map((h) => [`${day}T${String(h).padStart(2, "0")}:00:00Z`, watts]));

const DAY = 86_400_000;

/** The plant's flows as the core rolls them up: by the UTC day where days are asked for. */
export const byDay =
  (flows: Flows) =>
  (a: Asked): Response | undefined => {
    if (a.device !== PLANT || a.period !== "day") return plant(flows)(a);

    const days = new Map<number, number[]>();

    for (const [at, v] of Object.entries(flows[a.series] ?? {})) {
      const day = Math.floor(Date.parse(at) / DAY) * DAY;

      if (day >= Date.parse(a.from) && day < Date.parse(a.to))
        days.set(day, [...(days.get(day) ?? []), v]);
    }

    const points = [...days].map(([day, all]: readonly [number, readonly number[]]) => {
      const [start, end] = [new Date(day).toISOString(), new Date(day + DAY).toISOString()];
      const integral = all.reduce((x, y) => x + y, 0);

      return {
        date: start.slice(0, 10),
        start,
        end,
        mean: integral / all.length,
        integral,
        hours: all.length,
      };
    });

    return Response.json({ points, period: "day" });
  };
