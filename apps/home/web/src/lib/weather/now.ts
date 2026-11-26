// The weather now (ADR 23 "The sky"): one read a quarter, which the scene and the dashboard share.
import { readWeather, type WeatherRead, type WeatherReader } from "./weather.ts";

const MINUTE = 60_000;

const QUARTER = 15 * MINUTE;

const HOUR = 60 * MINUTE;

/** The core closes a quarter's clear-sky index half a minute after its end: until a minute after,
 * the quarter before's read stands. */
const CLOSES = MINUTE;

/** The quarter whose read stands at `now`, ms since 1970: from a minute after it begins. */
const quarterOf = (now: number): number => Math.floor((now - CLOSES) / QUARTER);

/** Each reader's last read of the weather now, and the quarter it was made in. */
const nows = new WeakMap<
  WeatherReader,
  { readonly quarter: number; readonly read: Promise<readonly [WeatherRead, number]> }
>();

/**
 * The stored weather an hour either side of `now`, ms since 1970, and the instant it was read at:
 * every caller within the quarter of the first shares its read. A read with no weather at all, as
 * from a core that refused or failed it, is not shared.
 */
export function weatherNow(
  core: Readonly<WeatherReader>,
  now: number,
): Promise<readonly [WeatherRead, number]> {
  const quarter = quarterOf(now);
  const last = nows.get(core);

  if (last?.quarter === quarter) return last.read;

  const read = readWeather(core, new Date(now - HOUR), new Date(now + HOUR)).then(
    (held) => [held, now] as const,
  );

  const entry = { quarter, read };

  nows.set(core, entry);
  void read.then(([held]) => {
    if (Object.values(held).every((values) => values.length === 0) && nows.get(core) === entry)
      nows.delete(core);

    return null;
  });

  return read;
}
