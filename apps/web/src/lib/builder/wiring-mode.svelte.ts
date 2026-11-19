// The builder's wiring mode (ADR 20): while the Strings group or a string is open, every string's
// wiring is drawn, a drag across modules selects them, and the selection is wired or unwired. The
// selection is held here, never stored, and is no undo step.
import { m } from "../paraglide/messages.js";
import type { Selecting } from "./gestures.ts";
import { laying, type Level } from "./levels.ts";
import type { Draft } from "./modules.ts";
import type { Modules, RoofFace } from "./pv.ts";
import type { Panel } from "./scene.ts";
import { mostUnwired, unwired, wiredInto, wiredNew, type Cell } from "./selecting.ts";
import { wiring } from "./wiring.ts";

/** The session the mode reads and edits. */
export interface Wired {
  readonly level: Level;
  readonly draft: Draft;
  readonly laid: Modules;
  change(draft: Draft): void;
}

type Face = Readonly<Pick<RoofFace, "block" | "face">>;

export class WiringMode {
  readonly #session: Wired;

  /** The modules picked, in the order they were crossed. */
  #selection = $state.raw<readonly Cell[]>([]);

  /** The roof face a tap named, which a phone's camera flies onto. */
  #face = $state.raw<Face>();

  /** Why the last wiring was refused, until the selection changes. */
  refused = $state<string>();

  constructor(session: Readonly<Wired>) {
    this.#session = session;
  }

  /** Whether the Strings group or a string is open. */
  get active(): boolean {
    const { level } = this.#session;

    return level.kind === "string" || (level.kind === "section" && level.section === "strings");
  }

  /** The string that is open, by its position; none in the Strings group. */
  get picked(): number | undefined {
    const { level } = this.#session;

    return level.kind === "string" ? level.index : undefined;
  }

  /** The selection, without what an undo or a removal took from the roofs. */
  get selection(): readonly Cell[] {
    const { grids = [] } = this.#session.draft.scene;

    return this.active
      ? this.#selection.filter(({ grid, module }) => grids[grid]?.modules[module] !== undefined)
      : [];
  }

  /** The modules in no string, grid by grid. */
  get unwired(): Cell[] {
    return (this.#session.draft.scene.grids ?? []).flatMap((grid, index) =>
      grid.modules.flatMap((laid, module) =>
        (laid.string ?? undefined) === undefined ? [{ grid: index, module }] : [],
      ),
    );
  }

  select(selection: readonly Cell[]): void {
    this.#selection = selection;
    this.refused = undefined;
  }

  /** Leaving the mode drops the selection and the face. */
  entered(level: Level): void {
    if (level.kind === "string" || (level.kind === "section" && level.section === "strings"))
      return;

    this.select([]);
    this.#face = undefined;
  }

  /** A tap in 3D while wiring: a roof face's names the face to look at, and nothing leaves the
   * mode. Whether the mode took the tap. */
  aimed(level: Level | null): boolean {
    if (!this.active) return false;

    if (level?.kind === "face") this.#face = { block: level.block, face: level.face };

    return true;
  }

  /** The roof face a phone's camera flies onto: a selected face's while its modules are laid, and
   * while wiring the face a tap named, else the one with the most modules in no string. */
  get onto(): RoofFace | undefined {
    const { level, laid, draft } = this.#session;
    const face = this.active ? (this.#face ?? mostUnwired(draft.scene)) : undefined;

    return face === undefined
      ? laying(laid.roofs, level)
      : laid.roofs.find((roof) => roof.block === face.block && roof.face === face.face);
  }

  /** The modules to draw: while wiring, each glows in its string's colour at full strength. */
  lit(panels: readonly Panel[]): readonly Panel[] {
    return this.active ? panels.map((panel) => ({ ...panel, bright: true })) : panels;
  }

  /** What the canvas draws and selects while wiring; none outside the mode. */
  get painting(): Selecting | undefined {
    if (!this.active) return undefined;

    const { draft, laid } = this.#session;
    const { selection } = this;

    return {
      kind: "wiring",
      paths: draft.strings.map((_, string) => wiring(draft.scene, laid.grids, string)),
      selection,
      chosen: selection.flatMap(({ grid, module }) => laid.grids[grid]?.modules[module] ?? []),
      onselect: (next) => {
        this.select(next);
      },
    };
  }

  /** Records `wired` as one undo step and drops the selection; refused with `reason` without it. */
  #wire(wired: Draft | null, reason: string): void {
    if (wired === null) {
      this.refused = reason;

      return;
    }

    this.#session.change(wired);
    this.select([]);
  }

  /** Wires the selection into string `string`, after the modules it holds. */
  into(string: number): void {
    const { draft } = this.#session;
    const name = draft.strings[string]?.name ?? "";

    this.#wire(wiredInto(draft, this.selection, string), m.builder_refused_module_type({ name }));
  }

  /** Wires the selection into a new string of its grid's module type. */
  intoNew(): void {
    const { draft } = this.#session;
    const name = m.builder_string_default({ number: draft.strings.length + 1 });

    this.#wire(wiredNew(draft, this.selection, name), m.builder_refused_mixed());
  }

  /** Takes the selection out of its strings. */
  unwire(): void {
    this.#wire(unwired(this.#session.draft, this.selection), "");
  }
}
