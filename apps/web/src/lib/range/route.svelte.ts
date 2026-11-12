// The range as the hash route holds it (ADR 21), and how each change of it travels. The screen
// moves at once; the address follows once the movement is over, so the router's own work stays
// out of its frames, and it carries the whole range, so quick changes cannot lose each other.
import { untrack } from "svelte";
import {
  canStep,
  customRange,
  rangeFor,
  rangeKey,
  rangeLabel,
  spanRange,
  step,
  travel,
  type Bounds,
  type Calendar,
  type Kind,
  type Range,
  type Ranged,
  type Via,
} from "./range.ts";
import { parseRange, rangeParams, RANGE_PARAMS } from "./params.ts";
import type { Core } from "../api/core.ts";
import { dayOfIso, iso } from "./calendar.ts";
import { PlantZone } from "./plant-zone.svelte.ts";
import type { Place } from "./range-data.svelte.ts";

/** Patches the hash route; `push` adds a history entry, so back returns from a drill. */
export type Go = (patch: Readonly<Record<string, string | null>>, push: boolean) => void;

/** The query inside a hash route: `#/history?range=week` holds `range=week`. */
export function hashParams(url: { readonly hash: string }): URLSearchParams {
  return new URLSearchParams(url.hash.split("?")[1] ?? "");
}

/** The hash route of `url` with `patch` applied to its query; null removes a parameter. */
export function patchHash(
  url: { readonly hash: string },
  patch: Readonly<Record<string, string | null>>,
): string {
  const [path = "#/", query = ""] = url.hash.split("?");
  const next = new URLSearchParams(query);

  for (const [k, v] of Object.entries(patch)) {
    if (v === null) next.delete(k);
    else next.set(k, v);
  }

  const rest = next.toString();

  return rest ? `${path}?${rest}` : path;
}

/** What a screen gives its range: the hash route's query, a way to patch it, and the core. */
export interface RouteInput {
  readonly params: URLSearchParams;
  readonly go: Go;
  /** Reads the plant timezone the range's days are cut in. */
  readonly core: Readonly<Pick<Core, "timezone">>;
}

/** How long a change waits before the address follows: past the 300 ms movement. */
const SETTLE_MS = 380;

export class RangeRoute implements Ranged {
  readonly #input: () => RouteInput;
  readonly #zone: PlantZone;
  /** The screen's own parameters beside the range's, which the address carries with it. */
  readonly #owns: readonly string[];

  #ahead = $state.raw<{ on: URLSearchParams; to: URLSearchParams } | null>(null);
  #later: ReturnType<typeof setTimeout> | undefined;
  #pushes = false;
  #said: "kind" | "step" | null = null;
  #held: { key: string; range: Range } | null = null;
  #last: (Via & { key: string; range: Range }) | null = null;

  /** The route as the screen sees it: a change made here, until the router has caught up. */
  readonly #now = $derived.by(() => {
    const ahead = this.#ahead;
    const params = this.#input().params;

    return ahead && ahead.on === params ? ahead.to : params;
  });

  /** The range; it keeps its identity while it stays the same range. */
  readonly range: Range = $derived.by(() => {
    const next = parseRange(this.#cal(), this.#now);
    const key = rangeKey(next);

    if (this.#held?.key !== key) this.#held = { key, range: next };

    return this.#held.range;
  });

  /** How the chart gets to the current range; its `id` changes with every change of range. */
  readonly via: Via = $derived.by(() => {
    const next = this.range;
    const key = rangeKey(next);
    const was = this.#last;

    if (was?.key === key) return was;

    const hint = this.#said;

    this.#said = null;

    const how = was
      ? travel(was.range, next, hint)
      : { kind: "none" as const, a: 0, b: 1, inward: true, dir: 0 as const };

    this.#last = { ...how, id: (was?.id ?? 0) + 1, key, range: next };

    return this.#last;
  });

  get label(): string {
    return rangeLabel(this.#cal(), this.range);
  }

  get canPrev(): boolean {
    return canStep(this.#cal(), this.range, -1);
  }

  get canNext(): boolean {
    return canStep(this.#cal(), this.range, 1);
  }

  /**
   * @param ahead how many days past today the screen reaches, such as a forecast's
   * @param owns the screen's own parameters, which `patch` changes with the range's
   */
  constructor(input: () => RouteInput, ahead = 0, owns: readonly string[] = []) {
    this.#input = input;
    this.#owns = [...RANGE_PARAMS, ...owns];
    this.#zone = new PlantZone(() => input().core, ahead);

    $effect(() => () => {
      if (this.#later) this.#sync();
    });
  }

  /** The plant's timezone and calendar now. */
  get place(): Place {
    return this.#zone.place;
  }

  #cal(): Calendar {
    return this.#zone.place.cal;
  }

  #nav(patch: Readonly<Record<string, string | null>>, push = false): void {
    const to = new URLSearchParams(untrack(() => this.#now));

    for (const [k, v] of Object.entries(patch)) {
      if (v === null) to.delete(k);
      else to.set(k, v);
    }

    this.#ahead = { on: untrack(() => this.#input().params), to };
    this.#pushes ||= push;
    clearTimeout(this.#later);
    this.#later = setTimeout(() => {
      this.#sync();
    }, SETTLE_MS);
  }

  #sync(): void {
    clearTimeout(this.#later);
    this.#later = undefined;

    const to = untrack(() => this.#now);

    this.#input().go(Object.fromEntries(this.#owns.map((k) => [k, to.get(k)])), this.#pushes);
    this.#pushes = false;
  }

  /** The route as the screen sees it, a change made here included. */
  get params(): URLSearchParams {
    return this.#now;
  }

  /** Changes the screen's own parameters; `push` adds a history entry, so back returns. */
  patch = (patch: Readonly<Record<string, string | null>>, push = false): void => {
    this.#nav(patch, push);
  };

  /** A new kind, anchored at the range's last day that has happened. */
  setKind = (kind: Kind): void => {
    const cal = this.#cal();
    const r = untrack(() => this.range);
    const anchor = Math.min(cal.today, r.to - 1);

    this.#said = "kind";
    this.#nav(
      rangeParams(
        cal,
        kind === "custom" ? customRange(cal, anchor - 29, anchor + 1) : rangeFor(kind, anchor),
      ),
    );
  };

  step = (dir: -1 | 1): void => {
    const cal = this.#cal();
    const r = untrack(() => this.range);

    if (!canStep(cal, r, dir)) return;

    this.#said = "step";
    this.#nav(rangeParams(cal, step(cal, r, dir)));
  };

  /** Drills into a range, or narrows to one; back returns. */
  open = (next: Range): void => {
    this.#nav(rangeParams(this.#cal(), next), true);
  };

  /** The range control's custom bounds. */
  get custom(): Bounds {
    const r = this.range;
    const cal = this.#cal();

    return {
      from: iso(r.from),
      to: iso(r.to - 1),
      fromHour: r.h0 ?? 0,
      toHour: r.h1 ?? 24,
      min: "2000-01-01",
      max: iso(cal.last),
      onchange: (a, b, u, v) => {
        this.#nav(rangeParams(cal, spanRange(cal, dayOfIso(a) * 24 + u, dayOfIso(b) * 24 + v)));
      },
    };
  }
}
