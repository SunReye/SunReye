// A measured sheet's head over its range (ADR 21): the figure against the range before it, cut to
// as much as the range has run, and the record's edges inside it. A range before the first reading
// reads nothing and says so once.
import { baselineOf } from "../history/compare.ts";
import type { Stored } from "../live/plant-facts.ts";
import { periodOf } from "../history/history.ts";
import { RangeData } from "../range/range-data.svelte.ts";
import { hourInstant, t1Of, type Calendar, type Range } from "../range/range.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { beforeText, notesOf, versus } from "./head-words.ts";
import { measureOf, type Head, type Measure, type MeasureCore, type Measured } from "./measure.ts";

/** What the head and the analytics show of the range. */
export interface HeadView {
  readonly state: "loading" | "error" | "before" | "ready";
  /** What the figure is, where the sheet's title does not say it. */
  readonly name?: string | undefined;
  /** The range's name: "Heute". */
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly digits: number;
  /** "−12 % vs gestern"; empty without a baseline that has readings. */
  readonly versus: string;
  /** Where the record begins or its readings stop inside the range; before it, the one sentence. */
  readonly notes: readonly string[];
}

/** The sheet's figure, what it reads through and the record's edges. */
export interface HeadInput {
  /** Null for a sheet that heads with none. */
  readonly head: Head | null;
  readonly core: MeasureCore;
  readonly route: RangeRoute;
  /** The stored series by `device/series` (ADR 22); null until the catalog is read. */
  readonly record: ReadonlyMap<string, Stored> | null;
}

interface Read {
  readonly key: string;
  readonly first: number | null;
  readonly last: number | null;
  readonly zone: string;
  readonly cal: Calendar;
  /** The range's name. */
  readonly label: string;
  readonly base: Range;
  /** Up to now, in ms. */
  readonly from: number;
  readonly until: number;
  readonly got: Measured;
  readonly was: Measured;
}

const NOTHING: Measured = { value: null, stops: null };

const keyOf = (measure: Readonly<Measure>) => `${measure.device}/${measure.series}`;

/** How the sheet's head reads; null for a sheet that heads with none. */
const measureFor = (head: Readonly<Head> | null, core: MeasureCore) =>
  head === null ? null : measureOf(head, core);

/** Where the route stands: its range, the plant's clock, and the range's name. */
type At = Readonly<Pick<RangeRoute, "range" | "place" | "label">>;

/** The range ends after the first reading. */
const recorded = (at: At, first: number) =>
  hourInstant(at.place.zone, t1Of(at.range)).getTime() > first;

/** The one sentence for a range that ends before the first reading; null for any other. */
const beforeOf = (at: At, first: number | null) =>
  first === null || recorded(at, first) ? null : beforeText(at.place.zone, first);

/** The head of a range read, written with its value's digits; a share's change is in points. */
const ready = (none: Omit<HeadView, "state">, got: Read, measure: Readonly<Measure>): HeadView => ({
  ...none,
  state: "ready",
  label: got.label,
  value: got.got.value,
  digits: measure.digits(got.got.value ?? 0),
  versus: versus(got.cal, got.base, got.got.value, got.was.value, measure.points === true),
  notes: notesOf({ ...got, stops: got.got.stops }),
});

export class RangeHead {
  readonly #input: () => HeadInput;
  readonly #data: RangeData<Read | null>;

  constructor(input: () => HeadInput) {
    this.#input = input;
    this.#data = new RangeData(
      () => input().route,
      (from, to, now) => {
        const { route, record, head, core } = input();
        const measure = measureFor(head, core);

        // The record's edges decide what to read, so the range is read once, after the catalog.
        if (measure === null || record === null) return Promise.resolve(null);

        return read(route, measure, record.get(keyOf(measure)) ?? null, { from, to, now });
      },
    );
  }

  get view(): HeadView | null {
    const input = this.#input();
    const measure = measureFor(input.head, input.core);

    if (measure === null) return null;

    const key = keyOf(measure);

    const none = {
      name: measure.name,
      label: input.route.label,
      unit: measure.unit,
      digits: measure.digits(0),
      value: null,
      versus: "",
      notes: [],
    };

    // Known at once, so a step back past the record never draws an empty chart.
    const before = beforeOf(input.route, input.record?.get(key)?.first ?? null);

    if (before !== null) return { ...none, state: "before", notes: [before] };

    if (this.#data.failed) return { ...none, state: "error" };

    const data = this.#data.current?.data;

    return data?.key === key ? ready(none, data, measure) : { ...none, state: "loading" };
  }

  retry = (): void => {
    this.#data.retry();
  };
}

/** The figure over the range and over the one before it, each from the first reading on. */
async function read(
  route: At,
  measure: Readonly<Measure>,
  stored: Stored | null,
  span: Readonly<{ from: Readonly<Date>; to: Readonly<Date>; now: number }>,
): Promise<Read> {
  const { range, place } = route;
  const base = baselineOf(place.cal, range, "prev");
  const ms = (t: number) => hourInstant(place.zone, t).getTime();
  const [a, b] = [span.from.getTime(), Math.min(span.to.getTime(), span.now)];
  const [b0, b1] = [ms(base.hours[0]), Math.min(ms(base.hours[1]), span.now)];
  const period = periodOf(range);
  const [first, last] = [stored?.first ?? null, stored?.last ?? null];
  const after = (end: number) => first === null || end > first;
  const at = { key: keyOf(measure), first, last, zone: place.zone, cal: place.cal };
  const edges = { ...at, label: route.label, base: base.range, from: a, until: b };

  if (!after(span.to.getTime())) return { ...edges, got: NOTHING, was: NOTHING };

  const [got, was] = await Promise.all([
    a < b ? measure.read(a, b, period) : NOTHING,
    b0 < b1 && after(b1) ? measure.read(b0, b1, period) : NOTHING,
  ]);

  return { ...edges, got, was };
}
