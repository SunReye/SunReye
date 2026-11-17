// What Explore shows beside its range, as the hash route holds it (ADR 22): the mode, the chosen
// series of their devices (`s`), the overlay's earlier periods (`vs`), the fold's period (`by`) and
// the open picker (`pick`).
import { PLANT } from "../api/computed-devices.ts";

export type Mode = "series" | "overlay" | "fold";

export const MODES: readonly Mode[] = ["series", "overlay", "fold"];

/** One device's series. */
export interface SeriesRef {
  readonly device: number;
  /** Such as `pv.mppt.power[2]`. */
  readonly series: string;
}

export interface ExploreView {
  readonly mode: Mode;
  readonly series: readonly SeriesRef[];
  /**
   * The overlay's earlier periods, each by a plant-local day in it, `2026-11-14`, or by a quick
   * pick's offset from the range, `-1d`, `-1w` or `-1y`, so a current range stays relative.
   */
  readonly periods: readonly string[];
  /** The picker is open; a screen wide enough for its pane shows it anyway. */
  readonly picking: boolean;
}

/** The route's parameters the view owns, beside the range's; `by` is the fold's period. */
export const EXPLORE_PARAMS = ["mode", "s", "vs", "pick", "by"] as const;

/** Opened with nothing chosen: the plant's PV power and house load. */
const DEFAULT: readonly SeriesRef[] = [
  { device: PLANT, series: "pv.power" },
  { device: PLANT, series: "load.power" },
];

export const same = (a: SeriesRef, b: SeriesRef): boolean =>
  a.device === b.device && a.series === b.series;

/** `3:pv.power`; a comma in an extra's name is escaped, so it never ends the list's entry. */
const written = (ref: SeriesRef): string =>
  `${ref.device}:${ref.series.replaceAll("%", "%25").replaceAll(",", "%2C")}`;

function read(entry: string): SeriesRef | null {
  const match = /^(\d+):(.+)$/u.exec(entry);

  if (!match) return null;

  try {
    return { device: Number(match[1]), series: decodeURIComponent(match[2]!) };
  } catch {
    return null;
  }
}

function seriesOf(named: string | null): readonly SeriesRef[] {
  if (named === null) return DEFAULT;

  const found: SeriesRef[] = [];

  for (const entry of named.split(",")) {
    const ref = read(entry);

    if (ref && !found.some((f) => same(f, ref))) found.push(ref);
  }

  return found;
}

const PERIOD = /^(?:\d{4}-\d{2}-\d{2}|-1[dwy])$/u;

export function viewOf(p: Readonly<URLSearchParams>): ExploreView {
  return {
    mode: MODES.find((mode) => mode === p.get("mode")) ?? "series",
    series: seriesOf(p.get("s")),
    periods: (p.get("vs") ?? "").split(",").filter((entry) => PERIOD.test(entry)),
    picking: p.get("pick") === "1",
  };
}

/** The chosen series as the route's `s`: null for the default, empty for none. */
export function seriesParam(refs: readonly SeriesRef[]): string | null {
  const isDefault = refs.length === DEFAULT.length && refs.every((r, i) => same(r, DEFAULT[i]!));

  return isDefault ? null : refs.map((ref) => written(ref)).join(",");
}

/** `refs` with `ref` added at the end, or without it when it was chosen. */
export function toggled(refs: readonly SeriesRef[], ref: SeriesRef): SeriesRef[] {
  return refs.some((r) => same(r, ref)) ? refs.filter((r) => !same(r, ref)) : [...refs, ref];
}

/** The hash route that opens Explore on one series at a range, as a reading row links it. */
export function exploreHash(
  ref: SeriesRef,
  range: Readonly<Record<string, string | null>>,
): string {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(range)) if (value !== null) query.set(key, value);

  query.set("s", written(ref));

  return `#/explore?${query.toString()}`;
}
