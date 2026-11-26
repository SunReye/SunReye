// The connected cars parked on the canvas once the house is on screen.
/* oxlint-disable typescript/prefer-readonly-parameter-types -- the canvas and the studio, used in place. */
import type { Object3D } from "three";
import { untrack } from "svelte";
import type { Ghost, Lit } from "../scene/stage.svelte.ts";
import { openGarage, parkedKey, type Garage, type ModelLoader, type Parked } from "./garage.ts";

export type { ModelLoader, Parked } from "./garage.ts";

/** Where the garage opens: the studio's scene, how it casts shadows again, the cars' model. */
interface Opened {
  readonly scene: Object3D;
  readonly recast: () => void;
  readonly model: () => ModelLoader | undefined;
}

/** Parks the cars once `due`, each change after the last; the default body loaded and their
 * programs compiled first. No car is drawn when the body cannot be read. A live tick that moves
 * only power or SOC brings nothing: an arrival snapshots the canvas, a stutter on every tick. */
export function parkLater(
  canvas: HTMLCanvasElement,
  opening: Lit["opening"],
  ghost: Ghost,
  cars: () => readonly Parked[],
  { scene, recast, model }: Opened,
) {
  const open = () => openGarage(scene, recast, untrack(model));

  let due = $state(false);
  let parking: Promise<Garage | null> | undefined;
  let parked: Promise<unknown> = Promise.resolve();
  let brought = parkedKey([]);

  $effect(() => {
    const arriving = cars();
    const key = parkedKey(arriving);

    if (due && key !== brought) {
      brought = key;
      parking ??= open().catch(() => null);
      parked = parked
        .then(() => parking)
        .then(
          (ready) =>
            ready &&
            opening.arrive(canvas, ghost, () => {
              ready.park(arriving);
            }),
        )
        .catch(() => {});
    }
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
