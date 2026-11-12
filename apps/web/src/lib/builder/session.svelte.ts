// One editing session of the builder (ADR 20): the draft with undo and redo until save, what the
// crate makes of it, and the inspector's level.
import type { Core, Device, Layout, ModuleType, Problem } from "../api/core.ts";
import { coldStrings, type Limits } from "./checks.ts";
import { haptics } from "../haptics.ts";
import { begin, record, redo, undo, type Edits } from "./history.ts";
import { parent, picked, type Level } from "./levels.ts";
import { painted, panels, type Draft } from "./modules.ts";
import { exists, type Plan } from "./outline.ts";
import type { Geometry, Modules, Pv, Scene } from "./pv.ts";
import type { Editing, Hit, Painting, Panel } from "./drawing.svelte.ts";
import { fill, type Template } from "./templates.ts";

const same = (a: Scene, b: Scene): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Today in the browser's calendar, as a date input holds it. */
function today(): string {
  const now = new Date();

  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

/** What a session reads: the crate, the core, the layout in force and the plant's devices. */
export interface Opening {
  readonly pv: Pv;
  readonly core: Core;
  /** The layout in force, or an empty one: nothing to undo before it. */
  readonly start: Draft;
  readonly moduleTypes: readonly Readonly<ModuleType>[];
  readonly devices: readonly Readonly<Device>[];
  /** Each inverter's maximum DC input voltage, by device id. */
  readonly limits: Limits;
}

export class Session {
  readonly #opening: () => Opening;

  #history: Edits<Draft>;

  readonly geometry: Geometry;

  /** The crate's layout of the draft's grids. */
  readonly laid: Modules;

  /** The placed modules, to draw. */
  readonly panels: readonly Panel[];

  readonly plan: Plan;

  /** Where the inspector stands, as last chosen. */
  #level = $state.raw<Level>({ kind: "root" });

  /** The day the saved layout applies from, `YYYY-MM-DD`. */
  appliesFrom = $state(today());

  /** The last save's answer, until the next edit. */
  saved = $state.raw<Layout | Problem>();

  /** Whether a click in 3D asked the inspector to show itself. */
  expanded = $state(false);

  /** Whether the admin chose to start from nothing. */
  #empty = $state(false);

  /** A handle drag's scene, shown but not yet recorded. */
  #dragged = $state.raw<Draft>();

  constructor(opening: () => Opening) {
    this.#opening = opening;
    // The start is where this session begins; a later one is a new session's.
    this.#history = $state.raw(begin(opening().start));

    const sizes = $derived(
      Object.fromEntries(
        opening().moduleTypes.map(({ id, width, height }) => [id, { width, height }]),
      ),
    );

    this.geometry = $derived(opening().pv.geometry(this.draft.scene));
    this.laid = $derived(opening().pv.modules(this.draft.scene, sizes));
    this.panels = $derived(panels(this.draft.scene, this.laid.grids));
    this.plan = $derived({
      draft: this.draft,
      laid: this.laid,
      devices: opening().devices,
      cold: coldStrings(opening().pv, this.draft, opening().moduleTypes, opening().limits),
    });
  }

  get draft(): Draft {
    return this.#dragged ?? this.#history.present;
  }

  get undoable(): boolean {
    return this.#history.past.length > 0;
  }

  get redoable(): boolean {
    return this.#history.future.length > 0;
  }

  /** The level shown: an undo or a removal can take its object away, and its group shows instead. */
  get level(): Level {
    return exists(this.#level, this.plan) ? this.#level : parent(this.#level);
  }

  change(next: Draft): void {
    this.#history = record(this.#history, next);
    this.saved = undefined;
  }

  /** Shows a handle drag's step at once; `drop` records the drag as one undo step (ADR 20). */
  drag(scene: Scene): void {
    this.#dragged = { ...this.#history.present, scene };
  }

  drop(): void {
    const dragged = this.#dragged;

    this.#dragged = undefined;

    if (dragged !== undefined && !same(dragged.scene, this.#history.present.scene)) {
      this.change(dragged);
    }
  }

  undo(): void {
    this.#history = undo(this.#history);
  }

  redo(): void {
    this.#history = redo(this.#history);
  }

  /** A selected block, obstacle or ground surface's handles, and where their drags go. */
  get editing(): Editing | undefined {
    const { level } = this;

    if (level.kind !== "block" && level.kind !== "obstacle" && level.kind !== "surface") {
      return undefined;
    }

    return {
      scene: this.draft.scene,
      target: { kind: level.kind, index: level.index },
      ondrag: (scene) => {
        this.drag(scene);
      },
      ondrop: () => {
        this.drop();
      },
    };
  }

  /** The picked string, which a drag across modules in 3D paints (ADR 20). */
  get painting(): Painting | undefined {
    const { level } = this;

    if (level.kind !== "string") return undefined;

    return {
      draft: this.draft,
      string: level.index,
      ondrag: (scene) => {
        this.drag(scene);
      },
      ondrop: () => {
        this.drop();
      },
    };
  }

  /** Templates are offered while the scene has no block, until the admin starts empty. */
  get offering(): boolean {
    return this.draft.scene.blocks.length === 0 && !this.#empty;
  }

  /** Fills the scene from a template, one undo step; nothing remembers which (ADR 20). */
  begin(template: Template): void {
    if (template === "empty") this.#empty = true;
    else this.change(fill(this.draft, template));
  }

  go(level: Level): void {
    haptics.soft();
    this.#level = level;
  }

  /** Drills the inspector to what a click in 3D struck, and shows it. */
  pick(hit: Hit): void {
    const level = picked(this.draft.scene, hit);

    if (level === null) return;

    this.go(level);
    this.expanded = true;
  }

  /** One configuration change from the chosen day on (ADR 20); nothing left to undo after. */
  async save(): Promise<void> {
    const { draft } = this;
    const strings = draft.strings.map((string, i) => ({ ...string, ...painted(draft.scene, i) }));

    const saved = await this.#opening().core.changeLayout({
      appliesFrom: new Date(`${this.appliesFrom}T00:00`).toISOString(),
      strings,
      scene: draft.scene,
    });

    this.saved = saved;

    if (!("problem" in saved)) {
      this.#history = begin({ scene: saved.scene ?? draft.scene, strings: saved.strings });
    }
  }
}
