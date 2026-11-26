// A saved view (ADR 22) is a name and Explore's route query. One spelling per view, so the route
// that shows a saved view is told by comparing strings.
import type { SavedView } from "../api/views.ts";
import { RANGE_PARAMS } from "../range/params.ts";
import type { Go } from "../range/route.svelte.ts";
import { seriesParam, viewOf } from "./view.ts";

export type View = Readonly<SavedView>;

/** Every parameter a view may hold; the open picker is no part of it. */
const KEYS = [...RANGE_PARAMS, "mode", "s", "vs", "by"] as const;

/** What a route holds of a view: a default is left out, an unknown parameter ignored. */
function held(p: Readonly<URLSearchParams>): Map<string, string> {
  const view = viewOf(p);
  const range = p.get("range");

  const named = {
    // A route without a range is a day's.
    range: range === "day" ? null : range,
    at: p.get("at"),
    from: p.get("from"),
    to: p.get("to"),
    mode: view.mode === "series" ? null : view.mode,
    s: seriesParam(view.series),
    vs: view.periods.length > 0 ? view.periods.join(",") : null,
    by: p.get("by"),
  };

  return new Map(
    KEYS.flatMap((key) => {
      const value = named[key];

      return value === null ? [] : [[key, value] as const];
    }),
  );
}

/** The query a view is saved as, and the one a route is compared by. */
export function queryOf(p: Readonly<URLSearchParams>): string {
  const query = new URLSearchParams([...held(p)]);

  query.sort();

  return query.toString();
}

/** The route patch that opens a saved query: what it lacks is cleared, and the picker closes. */
export function opening(query: string): Parameters<Go>[0] {
  const view = held(new URLSearchParams(query));

  return {
    ...Object.fromEntries(KEYS.map((key) => [key, view.get(key) ?? null])),
    // Named, as the range reads a route without one as a month until the address has followed.
    range: view.get("range") ?? "day",
    pick: null,
  };
}

/** Whether a route names nothing of the range or the view: Explore opened from More. */
export function bare(p: Readonly<URLSearchParams>): boolean {
  return ![...KEYS, "pick"].some((key) => p.has(key));
}

/** The core's longest name, in bytes. */
const LONGEST = 256;

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** A new view's name: its series' labels, as far as the core keeps them. */
export function nameFor(labels: readonly string[]): string {
  let name = "";

  for (const char of labels.join(", ")) {
    if (bytes(name + char) > LONGEST) break;

    name += char;
  }

  return name.trim();
}
