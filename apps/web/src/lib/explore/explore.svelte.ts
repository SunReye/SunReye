// The Explore screen's state (ADR 22): its range and view from the hash route, the series catalog
// behind the picker, and what each control does to the route. Nothing is kept outside the route.
import type { Core } from "../api/core.ts";
import { RangeRoute, type Go } from "../range/route.svelte.ts";
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
export type ExploreCore = Readonly<
  Pick<Core, "timezone" | "series" | "capabilities" | "history" | "statistics">
>;

export interface ExploreInput {
  readonly core: ExploreCore;
  /** The hash route's query. */
  readonly params: URLSearchParams;
  readonly go: Go;
}

export class Explore {
  readonly #input: () => ExploreInput;

  /** Undefined while the core answers, and after it refused. */
  #catalog = $state.raw<readonly PickerDevice[]>();
  #failed = $state(false);

  // Explore opens on today: a bare route is a day's.
  readonly #params = $derived.by(() => {
    const { params } = this.#input();

    if (params.has("range")) return params;

    const own = new URLSearchParams(params);

    own.set("range", "day");

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

  get loading(): boolean {
    return this.#catalog === undefined && !this.#failed;
  }

  get failed(): boolean {
    return this.#failed;
  }

  /** Reads the catalog, and which series are estimates; a viewer may not read those (ADR 9). */
  load = async (): Promise<void> => {
    const { core } = this.#input();

    this.#catalog = undefined;
    this.#failed = false;

    const [catalog, caps] = await Promise.all([core.series(), core.capabilities()]);

    if ("problem" in catalog) {
      this.#failed = true;

      return;
    }

    this.#catalog = pickerOf(catalog, "devices" in caps ? caps.devices : {});
  };

  isChosen = (ref: SeriesRef): boolean => this.view.series.some((r) => same(r, ref));

  /** Adds a series, or removes a chosen one; an open picker closes on its entry, so back undoes both. */
  toggle = (ref: SeriesRef): void => {
    const s = seriesParam(toggled(this.view.series, ref));

    if (this.view.picking) this.route.patch({ s, pick: null });
    else this.route.patch({ s }, true);
  };

  setMode = (mode: Mode): void => {
    if (mode !== this.view.mode) this.route.patch({ mode: mode === "series" ? null : mode }, true);
  };

  /** Opens the picker as a step of its own: back closes it. */
  pick = (): void => {
    this.route.patch({ pick: "1" }, true);
  };

  closePicker = (): void => {
    if (this.view.picking) this.route.patch({ pick: null });
  };
}
