// The tariff as the admin edits it: prices in ct/kWh, as households read them; the core's in EUR/kWh.
import type { ScheduleChange, TariffChange } from "../api/core";

export interface BandDraft {
  /** Tells bands apart while the admin adds and removes them. */
  readonly key: number;
  /** ISO weekdays, Monday 1 to Sunday 7. */
  days: number[];
  /** `HH:MM`. */
  from: string;
  /** `HH:MM`, up to 24:00. */
  to: string;
  /** ct/kWh. */
  price: number | null;
}

export interface ScheduleDraft {
  /** ct/kWh. */
  price: number | null;
  bands: BandDraft[];
}

export interface TariffDraft {
  /** A `datetime-local` value, empty for now. */
  appliesFrom: string;
  import: ScheduleDraft;
  export: ScheduleDraft;
}

/** A draft as the conversions read it. */
export interface ScheduleInput {
  readonly price: number | null;
  readonly bands: readonly {
    readonly days: readonly number[];
    readonly from: string;
    readonly to: string;
    readonly price: number | null;
  }[];
}

let keys = 0;

/** The draft of the tariff in force, or an empty one. */
export function draftOf(tariff: TariffChange | undefined): TariffDraft {
  return {
    appliesFrom: "",
    import: scheduleDraft(tariff?.import),
    export: scheduleDraft(tariff?.export),
  };
}

/** A new band: no days yet, the whole day. */
export function newBand(): BandDraft {
  keys += 1;

  return { key: keys, days: [], from: "00:00", to: "24:00", price: null };
}

/** A `datetime-local` value as an instant, in the viewer's timezone; empty is none. */
export function instantOf(local: string): string | undefined {
  return local === "" ? undefined : new Date(local).toISOString();
}

/** The prices the draft asks for. */
export function changeOf(draft: {
  readonly import: ScheduleInput;
  readonly export: ScheduleInput;
}): TariffChange {
  return { import: scheduleOf(draft.import), export: scheduleOf(draft.export) };
}

function scheduleDraft(schedule: ScheduleChange | undefined): ScheduleDraft {
  return {
    price: schedule === undefined ? null : cents(schedule.price),
    bands: (schedule?.bands ?? []).map((band) => {
      const draft = newBand();

      draft.days = [...band.days];
      draft.from = band.from;
      draft.to = band.to;
      draft.price = cents(band.price);

      return draft;
    }),
  };
}

function scheduleOf(draft: ScheduleInput): ScheduleChange {
  return {
    price: euros(draft.price),
    bands: draft.bands.map((band) => ({
      days: band.days.toSorted((a, b) => a - b),
      from: band.from,
      to: band.to,
      price: euros(band.price),
    })),
  };
}

/** EUR/kWh to ct/kWh, to the thousandth of a cent the core keeps. */
function cents(euro: number): number {
  return Math.round(euro * 100_000) / 1000;
}

function euros(cent: number | null): number {
  return Math.round((cent ?? 0) * 1000) / 100_000;
}
