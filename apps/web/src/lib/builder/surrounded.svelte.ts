// The imported surroundings kept on a SceneCanvas (ADR 20): drawn once the house is on screen,
// again when the crate stands them anew, and moved whole while a drag lines them up.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js objects, drawn in place. */
import { untrack } from "svelte";
import type { Group } from "three";
import { buildAround, settle, type Drawn, type Lie, type Stood } from "../scene/around.ts";
import type { Lit } from "../scene/stage.svelte.ts";
import { free } from "../scene/staged.ts";

export type { Lie, Stood } from "../scene/around.ts";

/** SceneCanvas's props, read when needed. */
export interface Surroundings {
  readonly stood: () => Stood | undefined;
  /** Where the import lies now: a drag's step, not yet stood by the crate. */
  readonly lie: () => Lie | null | undefined;
  /** Whether the hidden buildings are drawn see-through. */
  readonly ghosts: () => boolean;
}

export class Surrounded {
  #shown: { readonly drawn: Drawn; readonly stood: Stood } | undefined;

  /** The house is on screen: the surroundings may come. */
  #due = $state(false);

  /** What is drawn of them, for a click to strike. */
  readonly drawn = (): Group | undefined => this.#shown?.drawn.group;

  readonly due = (): void => {
    this.#due = true;
  };

  /** Keeps them in the studio; `arrive` runs their first drawing, which fades in like a car.
   * Call during a component's set-up; returns their removal. */
  attach(
    { studio }: Lit,
    source: Surroundings,
    arrive: (change: () => void) => void,
    render: () => void,
  ): () => void {
    $effect(() => {
      const [stood, ghosts] = [source.stood(), source.ghosts()];

      if (!this.#due) return;

      untrack(() => {
        const change = (): void => {
          this.#replace(studio, stood, ghosts);
          this.#place(source.lie());
        };

        if (this.#shown === undefined && stood !== undefined) arrive(change);
        else {
          change();
          render();
        }
      });
    });

    $effect(() => {
      const lie = source.lie();

      untrack(() => {
        this.#place(lie);
        render();
      });
    });

    return () => {
      this.#replace(studio, undefined, false);
    };
  }

  /** Draws what the crate `stood` in place of what was drawn, which it frees. */
  #replace(studio: Lit["studio"], stood: Stood | undefined, ghosts: boolean): void {
    if (this.#shown !== undefined) {
      studio.scene.remove(this.#shown.drawn.group);
      free(this.#shown.drawn.group);
    }

    this.#shown =
      stood === undefined
        ? undefined
        : { drawn: buildAround(stood.around, stood.key, ghosts), stood };

    if (this.#shown !== undefined) {
      // In the studio's 3D quality, as the scene itself.
      studio.dress(this.#shown.drawn.group);
      studio.scene.add(this.#shown.drawn.group);
    }

    studio.surround(this.#shown?.drawn.fade.value.z ?? 0);
  }

  #place(lie: Lie | null | undefined): void {
    if (this.#shown === undefined) return;

    const { drawn, stood } = this.#shown;

    settle(drawn, stood.north, stood.lie, lie ?? stood.lie);
  }
}
