// The selected object's handles on a SceneCanvas (ADR 20): shown in the studio, grabbed by the
// pointer, and the live value placed beside the dragging handle after each draw.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- three.js and the DOM, used in place. */
import type { Lens } from "../lens.ts";
import { untrack } from "svelte";
import type { Group, Scene as Studio } from "three";
import { getLocale } from "../../paraglide/runtime.js";
import type { Point } from "../pv.ts";
import type { Panel } from "../scene.ts";
import { Grabbing, type Editing, type Reading } from "./grabbing.ts";
import { Shown } from "./shown.ts";
import { valueText } from "./value.ts";

export type { Editing } from "./grabbing.ts";

/** Where a point of the scene lands on the canvas; null behind the camera. */
export type Project = (point: Point) => readonly [number, number] | null;

export interface Label {
  readonly text: string;
  readonly left: number;
  readonly top: number;
}

export interface Handling {
  readonly editing: () => Editing | undefined;
  readonly drawn: () => Group | undefined;
  readonly panels: () => readonly Panel[];
}

export class Handled {
  /** The language the value beside the handle is written in. */
  readonly #locale: () => string;
  #reading = $state.raw<Reading>();
  #beside = $state.raw<readonly [number, number] | null>(null);

  /** The live value beside the dragging handle; none between drags. */
  readonly label: Label | undefined = $derived.by(() => {
    const [reading, beside] = [this.#reading, this.#beside];

    return reading === undefined || beside === null
      ? undefined
      : { text: valueText(reading, this.#locale()), left: beside[0], top: beside[1] };
  });

  constructor(locale: () => string = getLocale) {
    this.#locale = locale;
  }

  /** Shows and grabs the handles; call during set-up, before the orbit controls listen. */
  attach(
    canvas: HTMLCanvasElement,
    camera: Lens,
    studio: Studio,
    sources: Handling,
    render: () => void,
  ): () => void {
    const shown = new Shown(studio, render);

    $effect(() => {
      const editing = sources.editing();

      untrack(() => {
        shown.show(editing);
      });
    });

    const grabbing = new Grabbing(canvas, camera, {
      ...sources,
      handles: shown.group,
      onreading: (reading) => {
        this.#reading = reading;

        // The next draw places it.
        if (reading === undefined) this.#beside = null;
        else render();
      },
    });

    return () => {
      grabbing.dispose();
      shown.dispose();
    };
  }

  /** After each draw: the live value follows its handle. */
  place(project: Project): void {
    const at = this.#reading?.at;

    if (at !== undefined) this.#beside = project([at[0], 0 - at[2], at[1]]);
  }
}
