// What the admin does with a saved view (ADR 22), and which asking is open for it: the menu
// starts one, the sheets beside it answer.
import type { Problem } from "../api/client.ts";
import { confirmed, refused } from "../feedback.ts";
import { m } from "../paraglide/messages.js";
import type { Saved } from "./saved.svelte.ts";
import type { View } from "./saved.ts";

export class ViewActions {
  readonly #saved: () => Saved;

  /** A new view's name is asked. */
  naming = $state(false);
  renaming = $state.raw<View>();
  deleting = $state.raw<View>();
  /** The view that holds a new view's name, asked to be replaced. */
  replacing = $state.raw<View>();

  constructor(saved: () => Saved) {
    this.#saved = saved;
  }

  /** A taken name asks to replace its view; any other refusal stays in the form. */
  add = async (name: string): Promise<Problem | undefined> => {
    const saved = this.#saved();
    const problem = await saved.save(name);

    if (problem === undefined) {
      confirmed(m.explore_view_saved());

      return undefined;
    }

    if (problem.problem !== "views.name") return problem;

    // Another session may have saved it: the list is read again to find it.
    await saved.load();
    this.replacing = saved.named(name);

    return this.replacing ? undefined : problem;
  };

  /**
   * Puts the route in place of the open view's query. Asked from a menu that closes on the
   * choice, so a refusal has nothing on screen to stand beside: it is a toast.
   */
  update = async (view: View): Promise<void> => {
    const problem = await this.#saved().replace(view.id, view.name);

    if (problem) refused(problem);
    else confirmed(m.explore_view_updated());
  };

  /** The route in place of the view whose name a new one took. */
  replace = async (): Promise<Problem | undefined> => {
    const view = this.replacing;

    return view && (await this.#saved().replace(view.id, view.name));
  };

  /** A new name for the view being renamed; its query stays. */
  rename = async (name: string): Promise<Problem | undefined> => {
    const view = this.renaming;

    if (!view) return undefined;

    const problem = await this.#saved().replace(view.id, name, view.query);

    if (problem === undefined) confirmed(m.explore_view_renamed());

    return problem;
  };

  remove = async (): Promise<Problem | undefined> => {
    const view = this.deleting;

    return view && (await this.#saved().remove(view));
  };
}
