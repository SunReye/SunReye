// The EV and loadpoint sheets' range (ADR 21 "Sheet content"): the charging power's hourly rollups,
// whatever the range's bands, so a session keeps its hours and each hour its own PV share, and the
// plant's house load, purchase and battery discharge by the same hours (ADR 14).
import { PLANT } from "../api/core.ts";
import { rollups, type Rolled } from "../history/history.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import { t0Of, t1Of } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { pvShareOf, sessionsOf, type PlantHours } from "./ev.ts";
import { strict, type MeasureCore } from "./measure.ts";

/** What the range reads through, where it stands, and whose charging power it reads. */
export interface EvInput {
  readonly core: MeasureCore;
  readonly route: RangeRoute;
  /** The plant for the EV, else the loadpoint's device (ADR 10). */
  readonly device: number;
}

interface Read extends PlantHours {
  /** Whose charging power was read: a sheet opened on another shows none of it. */
  readonly device: number;
  readonly charge: readonly Rolled[];
  readonly until: number;
}

const DAY_HOURS = 24;

export class EvRange {
  readonly #input: () => EvInput;
  readonly #data: RangeData<Read>;

  constructor(input: () => EvInput) {
    this.#input = input;
    this.#data = new RangeData(
      () => input().route,
      async (from, to, now) => {
        const { core, device } = input();
        const until = new Date(Math.min(to.getTime(), now));
        const sure = strict(core);

        const read = (id: number, series: string) =>
          from < until ? rollups(sure, id, series, "hour", from, until) : Promise.resolve([]);

        const [charge, load, imported, discharge] = await Promise.all([
          read(device, "ev.charge.power"),
          read(PLANT, "load.power"),
          read(PLANT, "grid.import.power"),
          read(PLANT, "battery.discharge.power"),
        ]);

        return {
          device,
          charge,
          load,
          imported,
          discharge,
          until: until.getTime(),
        };
      },
    );
  }

  get failed(): boolean {
    return this.#data.failed;
  }

  retry = (): void => {
    this.#data.retry();
  };

  /** The sessions newest first, the share PV met and whether the range runs past a day; null unread. */
  readonly view = $derived.by(() => {
    const got = this.#data.current;

    if (got === undefined || got.data.device !== this.#input().device) return null;

    const { charge, until } = got.data;

    return {
      sessions: sessionsOf(charge, until),
      share: pvShareOf(charge, got.data),
      days: t1Of(got.range) - t0Of(got.range) > DAY_HOURS,
    };
  });
}
