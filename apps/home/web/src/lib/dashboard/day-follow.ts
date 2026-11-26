// Keeps the dashboard's today current (ADR 21) without reading all of it each minute: the live
// stream carries the powers now, so each part of today is read again only as often as it moves.
import type { Visibility } from "../api/live.ts";
import { plantMidnight } from "../plant-day.ts";
import {
  dayOf,
  readAll,
  readHourly,
  readMoving,
  readQuarterly,
  type Day,
  type Reader,
  type Reads,
} from "./day.ts";

export type { Day } from "./day.ts";

const MINUTE = 60_000;

const QUARTER = 15 * MINUTE;

const HOUR = 60 * MINUTE;

/** The core closes a quarter's clear-sky index half a minute after its end, as the weather now
 * reads it. */
const CLOSES = MINUTE;

/** What is read again: the energies and money each minute, the measured powers and the weather
 * each quarter, the forecasts each hour, everything each day; a quarter or an hour from a minute
 * after it begins. */
type Due = "moving" | "quarterly" | "hourly" | "whole";

/** The part of today due at `now` after a read of `reads` at `at`. */
function due(reads: Readonly<Reads> | undefined, at: number, now: Readonly<Date>): Due {
  if (reads === undefined) return "whole";

  if (plantMidnight(reads.place.zone, now).getTime() !== reads.place.start.getTime())
    return "whole";

  // From a minute past each step, once the core has closed the quarter before.
  const changed = (step: number) =>
    Math.floor((at - CLOSES) / step) !== Math.floor((now.getTime() - CLOSES) / step);

  if (changed(HOUR)) return "hourly";

  return changed(QUARTER) ? "quarterly" : "moving";
}

/** `reads` with what `part` reads read again at `now`. */
async function reread(
  core: Reader,
  reads: Readonly<Reads> | undefined,
  part: Due,
  now: Readonly<Date>,
): Promise<Reads> {
  if (reads === undefined || part === "whole") return readAll(core, now);

  const { place } = reads;

  const [hourly, quarterly, moving] = await Promise.all([
    part === "hourly" ? readHourly(core, place) : reads.hourly,
    part === "moving" ? reads.quarterly : readQuarterly(core, place, now),
    readMoving(core, place),
  ]);

  return { place, hourly, quarterly, moving };
}

/**
 * Shows today as of now, then again each minute, until the returned stop. While `page` is hidden
 * nothing is read; shown again, today is read whole. A failed read keeps the last day; the next
 * minute tries again.
 */
export function followDay(
  core: Reader,
  show: (day: Day) => void,
  page: Visibility | undefined = globalThis.document,
): () => void {
  let reads: Reads | undefined;
  // When the last read that landed was made, in ms since 1970.
  let at = 0;
  let stopped = false;
  // Each read's turn: a read landing after a later one began is dropped, as it may be older.
  let turn = 0;

  const read = async (whole: boolean) => {
    if (page?.hidden) return;

    const mine = (turn += 1);
    const now = new Date();
    const part = whole ? "whole" : due(reads, at, now);

    const next = await reread(core, reads, part, now).catch(() => null);

    if (stopped || next === null || mine !== turn) return;

    reads = next;
    at = now.getTime();
    show(dayOf(next, now));
  };

  const shown = () => {
    if (!page?.hidden) void read(true);
  };

  void read(true);

  const timer = setInterval(() => void read(false), MINUTE);

  page?.addEventListener("visibilitychange", shown);

  return () => {
    stopped = true;
    clearInterval(timer);
    page?.removeEventListener("visibilitychange", shown);
  };
}
