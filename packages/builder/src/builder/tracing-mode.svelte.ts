// The builder's tracing mode (ADR 20): entered from the Buildings group, the canvas is seen from
// above and clicks trace a roof's lines; each line is one undo step. The picked line is held here,
// never stored, and "Linie entfernen" removes it. The roof is pulled up here too: its eaves and
// ridges to a height, the picked line made an eave or a ridge, a point of it given a height, a
// picked dormer raised. A ready shape is held here until the canvas places it. Every edit is a
// named `TraceEdit`, made by `replay`, as a consumer keeping the scene elsewhere makes it.
import { bent, dormers, lineKind, replay, type Kind, type TraceEdit } from "@sunreye/scene";
import type { Draft } from "./modules.ts";
import type { LineRef, Placing, Tracing } from "./tracing.svelte.ts";

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

  /** The ready shape the next tap places. */
  placing = $state.raw<Placing>();

  constructor(session: Readonly<Traced>) {
    this.#session = session;
  }

  enter(): void {
    this.active = true;
  }

  leave(): void {
    this.active = false;
    this.line = undefined;
    this.placing = undefined;
  }

  /** Holds ready shape `placing` for the next tap; without one, lets go of what was held. */
  hold(placing?: Placing): void {
    this.placing = placing;

    if (placing !== undefined) this.line = undefined;
  }

  /** Removes the picked line, one undo step. */
  remove(): void {
    const { line } = this;

    if (line === undefined) return;

    this.line = undefined;
    this.#emit({ kind: "remove", ...line });
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
  get bent(): boolean {
    const { scene } = this.#session.draft;

    return scene.blocks.some((_, block) => bent(scene, block).length > 0);
  }

  /** Pulls the block's eaves, or ridges, to `height` metres: one undo step. */
  pull(kind: Kind, height: number): void {
    const { block } = this;

    if (block !== undefined) this.#emit({ kind: "pull", block, which: kind, height });
  }

  /** Makes the picked line an eave or a ridge: one undo step. */
  mark(kind: Kind): void {
    const { line } = this;

    if (line !== undefined) this.#emit({ kind: "mark", ...line, as: kind });
  }

  /** Sets the height of the picked line's first point, or its second: one undo step. */
  raise(end: 0 | 1, height: number): void {
    const { line } = this;
    const scene = this.#session.draft.scene;
    const point = line && scene.blocks[line.block]?.freeForm?.traced?.lines[line.line]?.[end];

    if (line !== undefined && point !== undefined)
      this.#emit({ kind: "height", block: line.block, point, height });
  }

  /** The dormer the picked line is a line of: its first face, and its lowest and highest points'
   * heights, its eaves' and its ridges'. */
  get dormer(): { face: number; eave: number; ridge: number } | undefined {
    const { line } = this;
    const scene = this.#session.draft.scene;

    if (line === undefined) return undefined;

    const traced = scene.blocks[line.block]?.freeForm?.traced;
    const ends = traced?.lines[line.line];

    if (traced === undefined || traced === null || ends === undefined) return undefined;

    const of = dormers(scene, line.block).find((d) =>
      d.faces.some((f) => ends.every((p) => traced.faces[f]?.includes(p) === true)),
    );

    const heights = [...new Set(of?.faces.flatMap((f) => traced.faces[f] ?? []))].map(
      (p) => traced.points[p]?.[1] ?? 0,
    );

    const [face] = of?.faces ?? [];

    return face === undefined
      ? undefined
      : { face, eave: Math.min(...heights), ridge: Math.max(...heights) };
  }

  /** Pulls the picked dormer's eaves, or ridges, to `height` metres: one undo step. */
  raiseDormer(kind: Kind, height: number): void {
    const { line, dormer } = this;

    if (line !== undefined && dormer !== undefined)
      this.#emit({ kind: "pullDormer", block: line.block, face: dormer.face, which: kind, height });
  }

  /** Makes `edit` on the draft, one undo step; a refused edit changes nothing. */
  #emit(edit: TraceEdit): void {
    const edited = replay(this.#session.draft.scene, edit);

    if (!("refused" in edited))
      this.#session.change({ ...this.#session.draft, scene: edited.scene });
  }

  /** The canvas's tracing while the mode is on. */
  get tracing(): Tracing | undefined {
    if (!this.active) return undefined;

    const { draft } = this.#session;

    return {
      scene: draft.scene,
      line: this.line,
      placing: this.placing,
      onpickline: (line) => {
        this.line = line;
      },
      ontrace: (scene, edit) => {
        this.line = undefined;

        if (edit.kind === "roof" || edit.kind === "dormer") this.placing = undefined;

        this.#session.change({ ...this.#session.draft, scene });
      },
    };
  }
}
