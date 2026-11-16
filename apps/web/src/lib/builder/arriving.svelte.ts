// What comes to a drawn scene after the house (ADR 20 Loading): the cars and the imported
// surroundings, one after the other, each fading in over the picture before it.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Garage } from "../cars/garage.ts";
import type { Parked } from "../cars/parked.ts";
import type { Ghost, Lit } from "../scene/stage.svelte.ts";

export class Arrivals {
  readonly #canvas: HTMLCanvasElement;
  readonly #ghost: Ghost;
  readonly #opening: Lit["opening"];
  #last: Promise<void> = Promise.resolve();

  constructor(canvas: HTMLCanvasElement, ghost: Ghost, opening: Lit["opening"]) {
    this.#canvas = canvas;
    this.#ghost = ghost;
    this.#opening = opening;
  }

  /** Runs `task` once every arrival before it is in. */
  #queue(task: () => Promise<void>): void {
    this.#last = this.#last.then(task).catch(() => {});
  }

  /** Runs `change`, its programs compiled first; on screen, it fades in. */
  readonly fade = (change: () => void): void => {
    this.#queue(() => this.#opening.arrive(this.#canvas, this.#ghost, change));
  };

  /** Parks the `cars` once due, each change after the last; the default body loaded and their
   * programs compiled first. No car is drawn when the body cannot be read. Call during a
   * component's set-up. */
  park(cars: () => readonly Parked[], open: () => Promise<Garage>) {
    let due = $state(false);
    let parking: Promise<Garage | null> | undefined;

    $effect(() => {
      const arriving = cars();

      if (!due) return;

      parking ??= open().catch(() => null);
      this.#queue(async () => {
        const ready = await parking;

        if (ready) {
          await this.#opening.arrive(this.#canvas, this.#ghost, () => {
            ready.park(arriving);
          });
        }
      });
    });

    return {
      due: () => {
        due = true;
      },
      dispose: () => {
        void parking?.then((ready) => ready?.dispose());
      },
    };
  }
}
