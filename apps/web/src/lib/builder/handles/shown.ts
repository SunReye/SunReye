// The handles kept in the studio (ADR 20, 21): rebuilt with each edit, so the inspector's numbers
// move them, and grown in with the entrance curve when an object is selected. Drawn on demand: the
// entrance draws only while it plays.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js draws them in place. */
import type { Color, Group, Scene as Studio } from "three";
import { ease, MOTION_MS, motionMs } from "../../motion.ts";
import { cssColour } from "../../scene/backdrop.ts";
import { appear, free, gizmo } from "./gizmo.ts";
import type { Editing } from "./grabbing.ts";
import { handles } from "./grips.ts";

/** The entrance: the larger of kbase's, for a handle set on a whole object. */
const ENTRANCE = MOTION_MS.slow;

export class Shown {
  readonly #studio: Studio;
  readonly #render: () => void;
  #group: Group | undefined;
  #selected = "";
  #frame = 0;
  #colour: Color | undefined;
  /** How far the entrance has played, 0 to 1. */
  #progress = 1;

  constructor(studio: Studio, render: () => void) {
    this.#studio = studio;
    this.#render = render;
  }

  readonly group = (): Group | undefined => this.#group;

  /** The handles of what `editing` selects, or none. */
  show(editing: Editing | undefined): void {
    const found = editing === undefined ? [] : handles(editing.scene, editing.target, editing.laid);

    const key = editing === undefined ? "" : `${editing.target.kind} ${editing.target.index}`;
    const fresh = key !== this.#selected;

    // Read on a new selection only: a drag rebuilds them on every step.
    if (fresh || this.#colour === undefined) this.#colour = cssColour("var(--brand)");

    this.#replace(found.length === 0 ? undefined : gizmo(found, this.#colour));
    this.#selected = key;

    // A new selection grows in; the same one, edited, stands where it is.
    if (fresh && this.#group !== undefined) this.#enter();

    if (this.#group !== undefined) appear(this.#group, ease(this.#progress));

    this.#render();
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    this.#replace();
  }

  #enter(): void {
    const duration = motionMs(ENTRANCE);
    let start: number | undefined;

    const step = (now: number): void => {
      start ??= now;
      this.#progress = duration === 0 ? 1 : Math.min((now - start) / duration, 1);

      if (this.#group !== undefined) appear(this.#group, ease(this.#progress));

      this.#render();
      this.#frame = this.#progress < 1 ? requestAnimationFrame(step) : 0;
    };

    this.#progress = 0;
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(step);
  }

  #replace(next?: Group): void {
    if (this.#group !== undefined) {
      this.#studio.remove(this.#group);
      free(this.#group);
    }

    this.#group = next;

    if (next !== undefined) this.#studio.add(next);
  }
}
