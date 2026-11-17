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
