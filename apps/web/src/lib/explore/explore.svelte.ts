// The Explore screen's state (ADR 22): its range and view from the hash route, the series catalog
// behind the picker, and what each control does to the route. Nothing is kept outside the route.
import type { Core } from "../api/core.ts";
import { parseRange, rangeParams } from "../range/params.ts";
import { RangeRoute, type Go } from "../range/route.svelte.ts";
import { overlayRange } from "./overlay.ts";
import { chosenOf, pickerOf, type Chosen, type PickerDevice } from "./picker.ts";
import {
  EXPLORE_PARAMS,
  same,
  seriesParam,
  toggled,
  viewOf,
  type ExploreView,
  type Mode,
  type SeriesRef,
} from "./view.ts";

/** What the screen and its charts read. */
export type ExploreCore = Readonly<Pick<Core, "timezone" | "series" | "history" | "statistics">>;

export type CatalogState = "loading" | "ready" | "failed";

export interface ExploreInput {
  readonly core: ExploreCore;
  /** The hash route's query. */
  readonly params: URLSearchParams;
  readonly go: Go;
  /** Steps back one history entry, as the browser's back does. */
  readonly back: () => void;
}

export class Explore {
  readonly #input: () => ExploreInput;

  /** Whether the open picker is a step this screen pushed: closing it then goes back over it. */
  #opened = false;

  /** Undefined while the core answers, and after it refused. */
  #catalog = $state.raw<readonly PickerDevice[]>();
  #failed = $state(false);

  // Explore opens on today: a bare route is a day's. An address that overlays a longer range
  // reads as the day overlay opens of it.
  readonly #params = $derived.by(() => {
    const { params } = this.#input();
    const kind = params.get("range");
    const overlaid = params.get("mode") === "overlay" && kind !== "day" && kind !== "week";

    if (kind !== null && !overlaid) return params;

    const own = new URLSearchParams(params);

    own.set("range", "day");

    if (kind !== null) {
      const { cal } = this.route.place;
      const opened = rangeParams(cal, overlayRange(cal, parseRange(cal, params)));

      for (const key of ["from", "to"]) own.delete(key);

      if (opened.at === null) own.delete("at");
      else own.set("at", opened.at);
    }

    return own;
  });

  readonly route: RangeRoute;

  readonly view: ExploreView = $derived.by(() => viewOf(this.route.params));

  /** The picker's devices; empty until the catalog is read. */
  readonly devices: readonly PickerDevice[] = $derived(this.#catalog ?? []);

  readonly chosen: readonly Chosen[] = $derived(
    this.view.series.map((ref) => chosenOf(ref, this.devices)),
  );

  constructor(input: () => ExploreInput) {
    this.#input = input;
    this.route = new RangeRoute(() => ({ ...input(), params: this.#params }), 0, EXPLORE_PARAMS);
    void this.load();
  }

  /** Whether the catalog was read: until it is, a chosen series' kind, unit and instants are null. */
  get catalog(): CatalogState {
    if (this.#failed) return "failed";

    return this.#catalog === undefined ? "loading" : "ready";
  }

  /** Reads the catalog. */
  load = async (): Promise<void> => {
    const { core } = this.#input();

    this.#catalog = undefined;
    this.#failed = false;

    // An unreachable core rejects; a refusal answers with a problem.
    const catalog = await core.series().catch(() => ({ problem: "network" }) as const);

    if ("problem" in catalog) {
      this.#failed = true;

      return;
    }

    this.#catalog = pickerOf(catalog);
  };

  isChosen = (ref: SeriesRef): boolean => this.view.series.some((r) => same(r, ref));

  /** Adds a series, or removes a chosen one, as a step back can undo. */
  toggle = (ref: SeriesRef): void => {
    this.route.patch({ s: seriesParam(toggled(this.view.series, ref)) }, true);
  };

  /** A pick in the drawer: it closes on its own entry, so back undoes the pick and the opening. */
  choose = (ref: SeriesRef): void => {
    this.#opened = false;
    this.route.patch({ s: seriesParam(toggled(this.view.series, ref)), pick: null });
  };

  /** Overlay takes a day or a week (ADR 22): from a longer range it opens a day of it. */
  setMode = (mode: Mode): void => {
    if (mode === this.view.mode) return;

    const { cal } = this.route.place;
    const range = mode === "overlay" ? rangeParams(cal, overlayRange(cal, this.route.range)) : {};

    this.route.patch({ ...range, mode: mode === "series" ? null : mode }, true);
  };

  /** Opens the picker as a step of its own: back closes it. */
  pick = (): void => {
    this.#opened = true;
    this.route.patch({ pick: "1" }, true);
  };

  /** Closed without a pick: back over the step that opened it, or, opened by address, in place. */
  closePicker = (): void => {
    if (!this.view.picking) return;

    const { params, back } = this.#input();
    const pushed = this.#opened && params.get("pick") === "1";

    this.#opened = false;

    if (pushed) back();
    else this.route.patch({ pick: null });
  };
}
