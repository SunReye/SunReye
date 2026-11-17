// What stands under a day of the PV forecast sheet (ADR 21 "Details by drilling down"): its
// sunshine and its best window, today how the forecast holds, and the way on to the Forecast
// screen. In the SPA's locale.
import type { Fact } from "../detail/figures.ts";
import { accuracyText } from "../history/forecast.ts";
import { delta } from "../history/words.ts";
import { m } from "../paraglide/messages.js";
import { getLocale } from "../paraglide/runtime.js";
import { iso } from "../range/calendar.ts";
import { calendar } from "../range/range.ts";
import { WINDOW_HOURS, type AheadDay, type Track } from "./ahead.ts";

const HOUR = 3_600_000;

/** A day's sunshine in hours and its best window; a row that does not matter is absent. */
export function dayFacts(day: Readonly<AheadDay>, sunshine: number | null): Fact[] {
  const hourOf = (at: number) => Math.round((at - day.start) / HOUR);

  return [
    ...(sunshine === null
      ? []
      : [{ label: m.weather_sunshine(), value: sunshine, unit: "h", digits: 1 }]),
    ...(day.window === null
      ? []
      : [
          {
            label: m.ahead_window({ hours: WINDOW_HOURS }),
            text: m.ahead_window_hours({
              from: hourOf(day.window.from),
              to: hourOf(day.window.to),
            }),
          },
          { label: m.ahead_window_yield(), value: day.window.kwh, unit: "kWh", digits: 1 },
        ]),
  ];
}

/** How the forecast holds: today so far, then the whole days before it. */
export function holdFacts(track: Readonly<Track>): Fact[] {
  const [error, , days] = accuracyText(track.accuracy, false);

  return [
    { label: m.ahead_sofar(), text: delta(track.sofar) },
    { label: m.ahead_error(), text: error },
    { label: m.stats_forecast_days(), text: days },
  ];
}

/**
 * The Forecast screen on the sheet's day `at`, 0 today, and the link's words for it.
 * @param start the day's plant midnight, ms since 1970
 */
export function onward(zone: string, now: number, at: number, start: number) {
  const date = iso(calendar(zone, new Date(now)).today + at);
  const weekday = new Intl.DateTimeFormat(getLocale(), { weekday: "long", timeZone: zone });
  // A day's middle is on its date in any zone.
  const day = at === 0 ? m.dash_today() : weekday.format(start + 12 * HOUR);

  return {
    href: `#/forecast?${new URLSearchParams({ range: "day", at: date }).toString()}`,
    label: m.ahead_open({ day }),
  };
}
