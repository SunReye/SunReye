// fallow-ignore-file coverage-gaps -- replays reads against a live core; run by hand with `bun run bench`.
// Each screen's reads as the SPA issues them on open, concurrently where it does (ADR 24).

import { DETAIL_SHEETS } from "./sheets.ts";
import {
  api,
  costs,
  facts,
  FLOWS,
  forecasts,
  history,
  HOUR,
  type Body,
  midnight,
  type Plant,
  PLANT,
  ranges,
  type Read,
  readPlant,
  type Screen,
  SPOT,
  statistics,
  today,
  type Span,
  weather,
} from "./reads.ts";

/** `dashboard/day.ts` `readDay`. */
async function readDay(read: Read, plant: Plant): Promise<void> {
  await read(api("timezone"));

  const [d0, now] = [today(plant), plant.now];
  const d1 = midnight(plant, d0, 1);

  const inverters = async (): Promise<void> => {
    await read(api("layout"));
    await Promise.all(plant.inverters.map((i) => read(forecasts(i, "pv.power", d0, d1))));
  };

  await Promise.all([
    read(history(PLANT, "pv.power", d0, now)),
    read(history(PLANT, "load.power", d0, now)),
    ...FLOWS.slice(0, 6).map((flow) => read(statistics(PLANT, flow, "day", d0, d1))),
    inverters(),
    read(forecasts(SPOT, "price.spot", d0, d1)),
    weather(read, now - HOUR, now + HOUR),
    read(costs(d0, d1)),
  ]);
}

/** The entry gate, then the dashboard with its 2D flow, beside the shell's own reads. */
const dashboard: Screen = {
  name: "dashboard",
  open: async (read, plant) => {
    const entry = async (): Promise<void> => {
      await read(api("session"));
      await read(api("devices"));
      await read(api("layout"));
      await Promise.all([
        read(api("devices")),
        read(api("timezone")),
        readDay(read, plant),
        read(api("layout")),
        read(api("capabilities")),
      ]);
    };

    await Promise.all([read(api("devices")), read(api("sun-tint")), entry()]);
  },
};

/** History on a day, month or year: its facts, the range and the one before, cut alike. */
function historyScreen(unit: Span, name: string): Screen {
  return {
    name: `History by ${name}`,
    open: async (read, plant) => {
      const range = ranges(plant, unit);
      const capped = Math.min(range.end, plant.now);
      const baseline = range.before + capped - range.start;
      const hours = unit === "days";

      await Promise.all([
        read(api("timezone")),
        ...["layout", "capabilities", "payback", "corrections", "module-types"].map((path) =>
          read(api(path)),
        ),
        facts(read),
        readPlant(read, range.start, capped, hours),
        read(costs(range.start, range.end)),
        readPlant(read, range.before, baseline, hours),
        read(costs(range.before, baseline)),
      ]);
    },
  };
}

/** Explore opens on the timezone, the catalog and the saved views, then reads its chart. */
function explore(name: string, chart: (read: Read, plant: Plant) => Promise<Body[]>): Screen {
  return {
    name,
    open: async (read, plant) => {
      await Promise.all([read(api("timezone")), read(api("series")), read(api("views"))]);
      await chart(read, plant);
    },
  };
}

const exploreDefault = explore("Explore", (read, plant) => {
  const d0 = today(plant);

  return Promise.all(
    ["pv.power", "load.power"].map((series) =>
      read(history(PLANT, series, d0, midnight(plant, d0, 1))),
    ),
  );
});

const exploreOverlay = explore(
  "Explore overlay, the day before and a year before",
  (read, plant) => {
    const d0 = today(plant);
    const days = [d0, midnight(plant, d0, -1), midnight(plant, d0, -1, "years")];

    return Promise.all(
      days.map((day) => read(history(PLANT, "pv.power", day, midnight(plant, day, 1)))),
    );
  },
);

const exploreFold = explore("Explore fold, a year by month", async (read, plant) => {
  const year = ranges(plant, "years");

  return [await read(statistics(PLANT, "pv.power", "month", year.start, year.end))];
});

const catalog: Screen = {
  name: "series catalog",
  open: async (read) => {
    await read(api("series"));
  },
};

export const SCREENS: readonly Screen[] = [
  dashboard,
  historyScreen("days", "day"),
  historyScreen("months", "month"),
  historyScreen("years", "year"),
  exploreDefault,
  exploreOverlay,
  exploreFold,
  catalog,
  ...DETAIL_SHEETS,
];
