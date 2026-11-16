// The dashboard scene's imported surroundings (ADR 20): the document its layout names, read
// from the core while three.js loads, and stood by the crate once that is here.
import type { Core } from "../api/core.ts";
import type { Imported } from "../builder/imported.ts";
import type { Pv, Scene } from "../builder/pv.ts";
import type { Stood } from "../scene/around.ts";

export class LiveAround {
  #document = $state.raw<Imported>();

  #pv = $state.raw<Pick<Pv, "around">>();

  /** The surroundings as the crate stands them, to draw; none without an import, or before its
   * document and the crate are here. */
  readonly stood: Stood | undefined;

  /** Reads from what `given` gives; call during a component's set-up. */
  constructor(given: () => { readonly core: Pick<Core, "surroundings">; readonly scene: Scene }) {
    this.stood = $derived.by(() => {
      const [pv, document, { scene }] = [this.#pv, this.#document, given()];
      const imported = scene.imported ?? undefined;

      const around = pv === undefined || document === undefined ? null : pv.around(scene, document);

      return around === null || imported === undefined
        ? undefined
        : { around, key: imported.document, north: scene.north, lie: imported };
    });

    // A failed read leaves the scene without surroundings.
    $effect(() => {
      const { core, scene } = given();
      const id = scene.imported?.document;
      let current = true;

      this.#document = undefined;

      void (async () => {
        const read = id === undefined ? undefined : await core.surroundings(id).catch(() => null);

        if (current && read && !("problem" in read)) this.#document = read;
      })();

      return () => {
        current = false;
      };
    });
  }

  /** The crate, once it is loaded. */
  use(pv: Pick<Pv, "around">): void {
    this.#pv = pv;
  }
}
