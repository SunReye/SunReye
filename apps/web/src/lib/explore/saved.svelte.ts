// Explore's saved views (ADR 22): the list every reader sees, which of them the route shows, and
// the admin's writes. A view is told by its query alone; nothing of it is in the route.
import type { Problem } from "../api/client.ts";
import type { Core } from "../api/core.ts";
import type { RangeRoute } from "../range/route.svelte.ts";
import { bare, opening, queryOf, type View } from "./saved.ts";

export type ViewsCore = Readonly<Pick<Core, "views" | "saveView" | "replaceView" | "removeView">>;

export interface SavedInput {
  readonly core: ViewsCore;
  /** The hash route's query, as the address holds it. */
  readonly params: URLSearchParams;
}

export class Saved {
  readonly #input: () => SavedInput;
  readonly #route: () => RangeRoute;

  #list = $state.raw<readonly View[]>([]);
  #answered = $state(false);

  /** The view the route last showed: changing the route leaves it open, to be updated. */
  #last = $state<number>();

  /** The route as a view is saved. */
  readonly query = $derived.by(() => queryOf(this.#route().params));

  /** The view the route shows; its chip is marked. */
  readonly marked = $derived.by(() => {
    const shown = this.#list.filter(
      (view: View) => queryOf(new URLSearchParams(view.query)) === this.query,
    );

    // Two views may hold one query: the one opened stays the marked one.
    return shown.find((view: View) => view.id === this.#last) ?? shown[0];
  });

  /** The open view after the route moved off it: undefined while a chip is marked. */
  readonly changed = $derived(
    this.marked ? undefined : this.#list.find((view: View) => view.id === this.#last),
  );

  /** @param route Explore's, as the screen sees it */
  constructor(input: () => SavedInput, route: () => RangeRoute) {
    this.#input = input;
    this.#route = route;
    // A step back or an address reaches a view outside Saved, and `marked` reads #last: no derived.
    $effect(() => {
      if (this.marked) this.#last = this.marked.id;
    });
    void this.#start();
  }

  /** Every saved view, in the order saved. */
  get list(): readonly View[] {
    return this.#list;
  }

  /** Whether Explore, opened with nothing chosen, still waits to learn its first view. */
  get opening(): boolean {
    return !this.#answered && bare(this.#input().params);
  }

  /** Opened from More with nothing chosen, Explore opens the first saved view. */
  async #start(): Promise<void> {
    await this.load();
    this.#answered = true;

    const [first] = this.#list;

    if (first && bare(this.#input().params)) this.open(first, false);
  }

  /** Reads the list; a core that refuses or cannot be reached leaves it as it was. */
  load = async (): Promise<void> => {
    const list = await this.#input()
      .core.views()
      .catch(() => ({ problem: "network" }) as const);

    if (!("problem" in list)) this.#list = list;
  };

  /** Opens a view; a tap is a step back can undo. */
  open = (view: View, push = true): void => {
    this.#last = view.id;
    this.#route().patch(opening(view.query), push);
  };

  /** The view named `name`. */
  named = (name: string): View | undefined => this.#list.find((view: View) => view.name === name);

  /** Saves the route as a new view after the others. */
  save = async (name: string): Promise<Problem | undefined> => {
    const view = await this.#input().core.saveView(name, this.query);

    if ("problem" in view) return view;

    this.#list = [...this.#list, view];
    this.#last = view.id;

    return undefined;
  };

  /** Puts a name and a query, the route's unless given, in place of a view's. */
  replace = async (id: number, name: string, query = this.query): Promise<Problem | undefined> => {
    const view = await this.#input().core.replaceView(id, name, query);

    if ("problem" in view) return view;

    this.#list = this.#list.map((was: View) => (was.id === id ? view : was));
    this.#last = view.id;

    return undefined;
  };

  remove = async (view: View): Promise<Problem | undefined> => {
    const refused = await this.#input().core.removeView(view.id);

    if (refused === undefined) this.#list = this.#list.filter((was: View) => was.id !== view.id);

    return refused;
  };
}
