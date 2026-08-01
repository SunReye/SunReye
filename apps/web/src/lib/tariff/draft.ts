/**
 * The shape the tariff settings form edits.
 *
 * Derived from the server's own response rather than hand-written: the form PUTs
 * the *whole* config, so any field the type doesn't know about would be dropped
 * on save and silently reset to its default — which is how a plant would lose
 * its day-ahead pricing settings just by opening the page and pressing Save.
 *
 * Only the bands differ from the wire shape: `days` is optional there (absent
 * meaning "every day") and always present here so the editor can bind to it.
 */

import type { api } from "$lib/api";

export type TariffResponse = NonNullable<
  Awaited<ReturnType<typeof api.api.settings.tariff.get>>["data"]
>;

export type BandDraft = {
  name: string;
  pricePerKwh: number;
  startHour: number;
  endHour: number;
  days: number[];
};

export type TariffDraft = Omit<TariffResponse, "import"> & {
  import: Omit<TariffResponse["import"], "bands"> & { bands: BandDraft[] };
};

/** Every ISO weekday — the editing stand-in for a band with no `days`. */
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
