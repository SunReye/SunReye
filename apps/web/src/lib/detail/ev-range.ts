// The EV and loadpoint sheets' range (ADR 21 "Sheet content"): the charging power's hourly rollups,
// whatever the range's bands, so a session keeps its hours and each hour its own PV share, and the
// plant's house load, purchase and battery discharge by the same hours (ADR 14).
import { PLANT } from "../api/core.ts";
import { rollups, type Rolled } from "../history/history.ts";
import { t0Of, t1Of } from "../range/range.ts";
import { pvShareOf, sessionsOf, type PlantHours, type Session } from "./ev.ts";
import type { RangeInput, RangeReader } from "./sheet-range.svelte.ts";

export interface EvInput extends RangeInput {
  /** The plant for the EV, else the loadpoint's device (ADR 10). */
  readonly device: number;
}

export interface EvRead extends PlantHours {
  readonly charge: readonly Rolled[];
  readonly until: number;
}

/** The sessions newest first, the share PV met and whether the range runs past a day. */
export interface EvView {
  readonly sessions: readonly Session[];
  readonly share: number | null;
  readonly days: boolean;
}

const DAY_HOURS = 24;

/** The view; null unread. */
export const EV_RANGE: RangeReader<EvInput, EvRead, EvView | null> = {
  load: async (input, from, to, now) => {
    const { core, device } = input();
    const until = new Date(Math.min(to.getTime(), now));

    const read = (id: number, series: string) =>
      from < until ? rollups(core, id, series, "hour", from, until) : Promise.resolve([]);

    const [charge, load, imported, discharge] = await Promise.all([
      read(device, "ev.charge.power"),
      read(PLANT, "load.power"),
      read(PLANT, "grid.import.power"),
      read(PLANT, "battery.discharge.power"),
    ]);

    return { charge, load, imported, discharge, until: until.getTime() };
  },
  view: (got) =>
    got && {
      sessions: sessionsOf(got.data.charge, got.data.until),
      share: pvShareOf(got.data.charge, got.data),
      days: t1Of(got.range) - t0Of(got.range) > DAY_HOURS,
    },
};
