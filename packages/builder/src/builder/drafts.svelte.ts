// The drafts of one editing session (ADR 20): each recorded edit with undo and redo until save,
// and a handle drag's steps, shown at once and recorded as one edit when let go.
import { begin, record, redo, undo, type Edits } from "./history.ts";
import { uncovered, type Draft } from "./modules.ts";
import type { Scene } from "./pv.ts";

const same = (a: Scene, b: Scene): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The modules a roof chimney or a roof window covers, as a grid's index and a module's in it. */
export type Covered = (scene: Scene) => readonly (readonly [number, number])[];

export class Drafts {
  readonly #covered: Covered;

  #history: Edits<Draft>;

  /** A handle drag's draft, shown but not yet recorded. */
  #dragged = $state.raw<Draft>();

  constructor(start: Draft, covered: Covered) {
    this.#covered = covered;
    this.#history = $state.raw(begin(start));
  }

  /** The draft as recorded. */
  get present(): Draft {
    return this.#history.present;
  }

  /** A drag's step, while one is held. */
  get dragged(): Draft | undefined {
    return this.#dragged;
  }

  get undoable(): boolean {
    return this.#history.past.length > 0;
  }

  get redoable(): boolean {
    return this.#history.future.length > 0;
  }

  /** The scene without the modules a roof chimney or roof window covers: one added or moved onto
   * modules removes them in the same undo step. */
  #cleared(scene: Scene): Scene {
    const lain = (scene.grids ?? []).some(({ modules }) => modules.length > 0);
    const covering = (scene.chimneys?.length ?? 0) + (scene.roofWindows?.length ?? 0);

    // No chimney and no roof window, or no module: no question to the crate.
    return lain && covering > 0 ? uncovered(scene, this.#covered(scene)) : scene;
  }

  /** Records `next` as one undo step. */
  record(next: Draft): void {
    this.#history = record(this.#history, { ...next, scene: this.#cleared(next.scene) });
  }

  /** Shows a drag's step at once, unrecorded. */
  drag(scene: Scene): void {
    this.#dragged = { ...this.#history.present, scene: this.#cleared(scene) };
  }

  /** Lets a drag go: its draft to record, or none where it changed nothing. */
  drop(): Draft | undefined {
    const dragged = this.#dragged;

    this.#dragged = undefined;

    return dragged !== undefined && !same(dragged.scene, this.#history.present.scene)
      ? dragged
      : undefined;
  }

  undo(): void {
    this.#history = undo(this.#history);
  }

  redo(): void {
    this.#history = redo(this.#history);
  }

  /** Starts anew from `saved`: nothing left to undo. */
  begin(saved: Draft): void {
    this.#history = begin(saved);
  }
}
