// fallow-ignore-file coverage-gaps -- replays reads against a live core; run by hand with `bun run bench`.
// The dashboard's detail sheets as the SPA opens them (`lib/detail`): bits-ui mounts every tab's
// pane hidden, so the overview, the heat map and the comparison all read at once.

import {
  api,
  DETAIL_ROLES,
  FLOWS,
  forecasts,
  history,
  HOUR,
  type Body,
  midnight,
  pieces,
  type Plant,
  PLANT,
  type Read,
  type Screen,
  statistics,
  today,
  WEATHER,
  weekday,
  WEATHER_ROLES,
} from "./reads.ts";

/** Today's hours of a series, from midnight to the moment the sheet opens. */
const hours = (plant: Plant, device: number, series: string): string =>
  statistics(device, series, "hour", today(plant), plant.now);

/** What every sheet reads on opening: its context, then its head after the catalog. */
async function context(read: Read, plant: Plant, heads: readonly string[]): Promise<void> {
  const [d0, y0] = [today(plant), midnight(plant, plant.now, -1)];

  const head = async (): Promise<void> => {
    await read(api("series"));
    await Promise.all(
      heads.flatMap((series) => [
        read(hours(plant, PLANT, series)),
        read(statistics(PLANT, series, "hour", y0, y0 + plant.now - d0)),
      ]),
    );
  };

  await Promise.all([
    read(api("layout")),
    read(api("capabilities")),
    read(api("topology")),
    head(),
  ]);
}

/** The overview with forecasts from `forecasters`, and the week's heat map. */
function panes(read: Read, plant: Plant, overview: string, heat: string): Promise<Body>[] {
  const monday = midnight(plant, plant.now, 1 - weekday(plant));

  return [
    read(hours(plant, PLANT, overview)),
    read(statistics(PLANT, heat, "hour", monday, plant.now)),
  ];
}

const forecastsToday = (
  read: Read,
  plant: Plant,
  devices: readonly number[],
  series: string,
): Promise<Body>[] =>
  devices.map((device) =>
    read(forecasts(device, series, today(plant), midnight(plant, plant.now, 1))),
  );

function sheet(
  id: string,
  heads: readonly string[],
  open: (read: Read, plant: Plant) => Promise<Body>[],
): Screen {
  return {
    name: `detail sheet ${id}`,
    open: async (read, plant) => {
      await Promise.all([context(read, plant, heads), ...open(read, plant)]);
    },
  };
}

const production = sheet("production", ["pv.power"], (read, plant) => [
  ...panes(read, plant, "pv.power", "pv.power"),
  ...forecastsToday(read, plant, plant.inverters, "pv.power"),
  // The string comparison.
  read(api("module-types")),
  read(api("corrections")),
  ...plant.strings.map((s) => read(hours(plant, s.device, `pv.string.power[${s.id}]`))),
  // The PV facts.
  read(hours(plant, PLANT, "pv.power")),
  ...forecastsToday(read, plant, plant.inverters, "pv.power"),
  read(api("capabilities")),
]);

const consumption = sheet("consumption", ["load.power"], (read, plant) => [
  ...panes(read, plant, "load.power", "load.power"),
  read(hours(plant, PLANT, "load.power")),
  ...FLOWS.map((flow) => read(hours(plant, PLANT, flow))),
]);

const battery = sheet("battery", ["battery.discharge.power"], (read, plant) => [
  ...panes(read, plant, "battery.power", "battery.discharge.power"),
  ...["battery.charge.power", "battery.discharge.power", "battery.soc"].map((series) =>
    read(hours(plant, PLANT, series)),
  ),
]);

const grid = sheet("grid", ["grid.import.power", "grid.export.power"], (read, plant) =>
  panes(read, plant, "grid.power", "grid.import.power"),
);

/** Every weather series from midnight to the end of the hour, and three days of forecasts. */
const weatherSheet = sheet("weather", [], (read, plant) => {
  const d0 = today(plant);
  const hour = Math.ceil(plant.now / HOUR) * HOUR;
  const roles = [...WEATHER_ROLES, ...DETAIL_ROLES];

  return [
    ...roles
      .values()
      .filter((role) => role !== "weather.visibility")
      .map((role) => read(history(WEATHER, role, d0, hour)))
      .toArray(),
    ...roles
      .values()
      .filter((role) => role !== "weather.clearness")
      .map((role) => read(forecasts(WEATHER, role, d0, midnight(plant, d0, 3))))
      .toArray(),
  ];
});

/** `forecast/ahead-read.ts`: the layout, then thirty days back and three ahead. */
const forecastSheet = sheet("forecast", [], (read, plant) => {
  const d0 = today(plant);
  const [month, ahead] = [midnight(plant, d0, -30), midnight(plant, d0, 3)];

  const rest = (): Promise<Body>[] => [
    ...plant.inverters.flatMap((i) =>
      pieces(month, ahead, 350).map((piece) =>
        read(forecasts(i, "pv.power", piece.from, piece.to)),
      ),
    ),
    ...plant.strings.map((s) => read(forecasts(s.device, `pv.string.power[${s.id}]`, d0, ahead))),
    ...plant.inverters.map((i) => read(statistics(i, "pv.power", "day", month, plant.now))),
    ...["weather.code", "weather.ghi", "weather.sunshine"].flatMap((role) => [
      read(history(WEATHER, role, d0, plant.now)),
      read(forecasts(WEATHER, role, d0, ahead)),
    ]),
  ];

  const after = async (): Promise<Body> => {
    await read(api("layout"));
    await Promise.all(rest());

    return null;
  };

  return [after()];
});

export const DETAIL_SHEETS: readonly Screen[] = [
  production,
  consumption,
  battery,
  grid,
  weatherSheet,
  forecastSheet,
];
