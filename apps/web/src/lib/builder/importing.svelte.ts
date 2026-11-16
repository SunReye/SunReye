// The imported surroundings of one editing session (ADR 20): the documents read from the core,
// a load under way, and what the crate stands around the blocks.
import { untrack } from "svelte";
import type { SurroundingsLoad } from "../api/core.ts";
import type { Stood } from "../scene/around.ts";
import { rests, toggled } from "./handles/aligning.ts";
import type { Imported } from "./imported.ts";
import { fetched, type Failure, type Source } from "./importing.ts";
import type { Pv, Scene } from "./pv.ts";
import type { Hit } from "./strike.ts";

/** Milliseconds between two questions about a load. */
const POLL = 1000;

/** What decides how the surroundings stand: the compass, the blocks' footprints, which the
 * terrain lies level under, and the import itself. */
function lying({ north, blocks, imported }: Scene) {
  return [
    north,
    blocks.map(({ x, z, width, depth, rotation }) => [x, z, width, depth, rotation]),
    imported,
  ];
}

export interface Importer {
  readonly core: Source;
  readonly pv: Pick<Pv, "around" | "loadImport">;
  /** The scene as last recorded: a drag in progress moves what is drawn whole instead. */
  readonly recorded: Scene;
  /** The scene as it is shown now. */
  readonly scene: () => Scene;
  /** Records a change of the scene: one undo step. */
  readonly put: (scene: Scene) => void;
}

export class Importing {
  readonly #given: () => Importer;

  /** The documents read so far, by digest. */
  #documents = $state.raw<Readonly<Record<string, Imported>>>({});

  /** A load under way, or how the last one failed, until the next. */
  loading = $state.raw<"fetching" | Failure>();

  /** The surroundings as the crate stands them, to draw; none without an import or before its
   * document is read. */
  readonly stood: Stood | undefined;

  /** Call during a component's set-up: it reads the document of whatever import the scene names. */
  constructor(given: () => Importer) {
    this.#given = given;

    const lain = $derived(JSON.stringify(lying(given().recorded)));

    this.stood = $derived.by(() => {
      // Anything else of the scene changes nothing here.
      void lain;

      const { recorded: scene, pv } = untrack(given);
      const document = this.#document(scene);
      const around = document === undefined ? null : pv.around(scene, document);

      return around === null || !scene.imported
        ? undefined
        : { around, key: scene.imported.document, north: scene.north, lie: scene.imported };
    });

    $effect(() => {
      const id = given().scene().imported?.document;

      if (id !== undefined) void this.#need(id);
    });
  }

  #document(scene: Scene): Imported | undefined {
    const id = scene.imported?.document;

    return id === undefined ? undefined : this.#documents[id];
  }

  /** The turns the surroundings' ring snaps to in `scene`. */
  rests(scene: Scene): readonly number[] {
    const document = this.#document(scene);

    return document === undefined ? [] : rests(scene, document);
  }

  async #need(id: string): Promise<void> {
    if (untrack(() => this.#documents[id]) !== undefined) return;

    const document = await this.#given().core.surroundings(id);

    if (!("problem" in document)) this.#documents = { ...this.#documents, [id]: document };
  }

  /** Fetches anew and, once the document is ready, lays it on the scene's origin with the
   * building under the blocks hidden: one undo step (ADR 20). A failed load changes nothing. */
  async load(request: SurroundingsLoad): Promise<void> {
    this.loading = "fetching";

    const ended = await fetched(this.#given().core, request, async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, POLL);
      });
    });

    if (!("document" in ended)) {
      this.loading = ended;

      return;
    }

    this.#documents = { ...this.#documents, [ended.id]: ended.document };
    this.loading = undefined;

    const { pv, scene, put } = this.#given();
    const shown = scene();

    put({ ...shown, imported: pv.loadImport(ended.id, shown, ended.document) });
  }

  /** A tap on what `hit` struck hides an imported building or shows it again, one undo step;
   * whether it was one. */
  tap(hit: Hit): boolean {
    if (hit.kind !== "imported") return false;

    const { scene, put } = this.#given();

    put(toggled(scene(), hit.building));

    return true;
  }
}
