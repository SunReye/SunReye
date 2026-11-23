// The builder's tracing mode (ADR 20): entered from the Buildings group, the canvas is seen from
// above and clicks trace a roof's lines; each line is one undo step. The picked line is held here,
// never stored, and "Linie entfernen" removes it. The roof is pulled up here too: its eaves and
// ridges to a height, the picked line made an eave or a ridge, a point of it given a height.
import {
  bent,
  lineKind,
  markLine,
  pullEaves,
  pullRidges,
  removeLine,
  setHeight,
  type Edited,
  type Kind,
} from "@sunreye/scene";
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
  remove(): void {
    const { line } = this;

    if (line === undefined) return;

    const { draft } = this.#session;
    const edited = removeLine(draft.scene, line.block, line.line);

    this.line = undefined;

    if (!("refused" in edited)) this.#session.change({ ...draft, scene: edited.scene });
  }

  /** The traced block the heights are given to: the picked line's, else the last traced. */
  get block(): number | undefined {
    const { blocks } = this.#session.draft.scene;
    const last = blocks.findLastIndex((block) => block.freeForm?.traced !== undefined);

    return this.line?.block ?? (last >= 0 ? last : undefined);
  }

  /** The height the block's eaves, or ridges, stand at now; undefined where it has none. */
  heightOf(kind: Kind): number | undefined {
    const { block } = this;
    const scene = this.#session.draft.scene;
    const traced = block === undefined ? undefined : scene.blocks[block]?.freeForm?.traced;
    const line = traced?.lines.findIndex((_, i) => lineKind(scene, block ?? 0, i) === kind) ?? -1;
    const point = traced?.lines[line]?.[0];

    return point === undefined ? undefined : traced?.points[point]?.[1];
  }

  /** What the picked line is, and its two points' heights. */
  // fallow-ignore-next-line unused-class-member -- read in the canvas bar's Svelte markup, which fallow does not read in this package.
  get picked(): { kind: Kind | undefined; heights: readonly [number, number] } | undefined {
    const { line } = this;

    if (line === undefined) return undefined;

    const scene = this.#session.draft.scene;
    const traced = scene.blocks[line.block]?.freeForm?.traced;
    const ends = traced?.lines[line.line];

    if (!traced || ends === undefined) return undefined;

    const { points } = traced;
    const [from = 0, to = 0] = ends.map((p) => points[p]?.[1] ?? 0);

    return { kind: lineKind(scene, line.block, line.line), heights: [from, to] };
  }

  /** Whether a traced face is bent off its plane. */
  // fallow-ignore-next-line unused-class-member -- read in the canvas bar's Svelte markup, which fallow does not read in this package.
  get bent(): boolean {
    const { scene } = this.#session.draft;

    return scene.blocks.some((_, block) => bent(scene, block).length > 0);
  }

  /** Pulls the block's eaves, or ridges, to `height` metres: one undo step. */
  pull(kind: Kind, height: number): void {
    const { block } = this;
    const scene = this.#session.draft.scene;

    if (block === undefined) return;

    this.#edited(
      kind === "eave" ? pullEaves(scene, block, height) : pullRidges(scene, block, height),
    );
  }

  /** Makes the picked line an eave or a ridge: one undo step. */
  mark(kind: Kind): void {
    const { line } = this;

    if (line !== undefined)
      this.#edited(markLine(this.#session.draft.scene, line.block, line.line, kind));
  }

  /** Sets the height of the picked line's first point, or its second: one undo step. */
  raise(end: 0 | 1, height: number): void {
    const { line } = this;
    const scene = this.#session.draft.scene;
    const point = line && scene.blocks[line.block]?.freeForm?.traced?.lines[line.line]?.[end];

    if (line !== undefined && point !== undefined)
      this.#edited(setHeight(scene, line.block, point, height));
  }

  #edited(edited: Edited): void {
    if (!("refused" in edited))
      this.#session.change({ ...this.#session.draft, scene: edited.scene });
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
