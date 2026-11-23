// The builder's tracing mode (ADR 20): entered from the Buildings group, the canvas is seen from
// above and clicks trace a roof's lines; each line is one undo step. The picked line is held here,
// never stored, and "Linie entfernen" removes it.
import { removeLine } from "@sunreye/scene";
import type { Draft } from "./modules.ts";
import type { LineRef, Tracing } from "./tracing.svelte.ts";

/** The session the mode reads and edits. */
export interface Traced {
  readonly draft: Draft;
  change(draft: Draft): void;
}

export class TracingMode {
  readonly #session: Traced;

  /** Whether the canvas traces. */
  active = $state(false);

  /** The line a tap picked. */
  line = $state.raw<LineRef>();

  constructor(session: Readonly<Traced>) {
    this.#session = session;
  }

  // fallow-ignore-next-line unused-class-member -- called from the inspector's Svelte markup, which fallow does not read in this package.
  enter(): void {
    this.active = true;
  }

  // fallow-ignore-next-line unused-class-member -- called from the canvas bar's Svelte markup, which fallow does not read in this package.
  leave(): void {
    this.active = false;
    this.line = undefined;
  }

  /** Removes the picked line, one undo step. */
  // fallow-ignore-next-line unused-class-member -- called from the canvas bar's Svelte markup, which fallow does not read in this package.
  remove(): void {
    const { line } = this;

    if (line === undefined) return;

    const { draft } = this.#session;
    const edited = removeLine(draft.scene, line.block, line.line);

    this.line = undefined;

    if (!("refused" in edited)) this.#session.change({ ...draft, scene: edited.scene });
  }

  /** The canvas's tracing while the mode is on. */
  // fallow-ignore-next-line unused-class-member -- read in the builder's Svelte markup, which fallow does not read in this package.
  get tracing(): Tracing | undefined {
    if (!this.active) return undefined;

    const { draft } = this.#session;

    return {
      scene: draft.scene,
      line: this.line,
      onpickline: (line) => {
        this.line = line;
      },
      ontrace: (scene) => {
        this.line = undefined;
        this.#session.change({ ...this.#session.draft, scene });
      },
    };
  }
}
