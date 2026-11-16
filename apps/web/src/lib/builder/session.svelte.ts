// One editing session of the builder (ADR 20): the draft with undo and redo until save, what the
// crate makes of it, and the inspector's level.
import type {
  CatalogueSheet,
  Core,
  Datasheet,
  Device,
  Layout,
  ModuleType,
  Problem,
} from "../api/core.ts";
import { coldStrings, stringRefusal, type Limits, type StringRefusal } from "./checks.ts";
import { haptics } from "../haptics.ts";
import { begin, record, redo, undo, type Edits } from "./history.ts";
import { Importing } from "./importing.svelte.ts";
import { parent, picked, type Level } from "./levels.ts";
import { painted, panels, uncovered, type Draft } from "./modules.ts";
import { exists, type Plan } from "./outline.ts";
import type { Geometry, Modules, Pv, Scene, Sizes } from "./pv.ts";
import {
  editingOf,
  paintingOf,
  type Editing,
  type Hit,
  type Painting,
  type Panel,
} from "./drawing.svelte.ts";

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

  /** Each module type's size, by its id. */
  readonly #sizes: Sizes;

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

  /** Module types added in this session; the core keeps them, no undo takes them back. */
  #added = $state.raw<readonly ModuleType[]>([]);

  /** A handle drag's scene, shown but not yet recorded. */
  #dragged = $state.raw<Draft>();

  /** The imported surroundings: their documents, a load under way and what is drawn of them. */
  readonly importing: Importing;

  constructor(opening: () => Opening) {
    this.#opening = opening;
    // The start is where this session begins; a later one is a new session's.
    this.#history = $state.raw(begin(opening().start));

    this.importing = new Importing(() => ({
      core: opening().core,
      pv: opening().pv,
      recorded: this.#history.present.scene,
      scene: () => this.draft.scene,
      put: (scene) => {
        this.change({ ...this.draft, scene });
      },
    }));

    this.#sizes = $derived(
      Object.fromEntries(this.moduleTypes.map(({ id, width, height }) => [id, { width, height }])),
    );

    this.geometry = $derived(opening().pv.geometry(this.draft.scene));
    this.laid = $derived(opening().pv.modules(this.draft.scene, this.#sizes));
    this.panels = $derived(panels(this.draft.scene, this.laid.grids));
    this.plan = $derived({
      draft: this.draft,
      laid: this.laid,
      pv: opening().pv,
      sizes: this.#sizes,
      devices: opening().devices,
      cold: coldStrings(opening().pv, this.draft, this.moduleTypes, opening().limits),
      refused: this.#refused(),
    });
  }

  /** The plant's module types, the ones added here last. */
  get moduleTypes(): readonly Readonly<ModuleType>[] {
    return [...this.#opening().moduleTypes, ...this.#added];
  }

  /** Adds a module type to the core (ADR 17); the core's answer, a refusal kept for its text. */
  async addModuleType(datasheet: Readonly<Datasheet>): Promise<ModuleType | Problem> {
    const added = await this.#opening().core.addModuleType(datasheet);

    if (!("problem" in added)) this.#added = [...this.#added, added];

    return added;
  }

  /** The module catalogue's sheets (ADR 17), read anew each time a face asks. */
  moduleCatalogue(): Promise<readonly CatalogueSheet[] | Problem> {
    return this.#opening().core.moduleCatalogue();
  }

  #refused(): StringRefusal | null {
    const { saved } = this;
    const names = this.draft.strings.map(({ name }) => name);

    return saved !== undefined && "problem" in saved ? stringRefusal(saved, names) : null;
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

  /** The scene without the modules a roof chimney or roof window covers: one added or moved onto
   * modules removes them in the same undo step (ADR 20). */
  #cleared(scene: Scene): Scene {
    const lain = (scene.grids ?? []).some(({ modules }) => modules.length > 0);

    const covering = (scene.chimneys?.length ?? 0) + (scene.roofWindows?.length ?? 0);

    // No chimney and no roof window, or no module: no question to the crate.
    return lain && covering > 0
      ? uncovered(scene, this.#opening().pv.covered(scene, this.#sizes))
      : scene;
  }

  change(next: Draft): void {
    this.#history = record(this.#history, { ...next, scene: this.#cleared(next.scene) });
    this.saved = undefined;
  }

  /** Shows a handle drag's step at once; `drop` records the drag as one undo step (ADR 20). */
  drag(scene: Scene): void {
    this.#dragged = { ...this.#history.present, scene: this.#cleared(scene) };
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

  /** Where a drag's steps go, and its end. */
  readonly #steps = { ondrag: this.drag.bind(this), ondrop: this.drop.bind(this) };

  /** The selected object's handles, or the imported surroundings', and where their drags go. */
  get editing(): Editing | undefined {
    const { scene } = this.draft;
    const handling = { scene, pv: this.#opening().pv, laid: this.laid, ...this.#steps };

    return editingOf(this.level, handling, () => this.importing.rests(scene));
  }

  /** The selected face's grid to lay modules on, or the picked string to wire (ADR 20). */
  get painting(): Painting | undefined {
    return paintingOf(this.level, {
      draft: this.draft,
      laid: this.laid,
      pv: this.#opening().pv,
      sizes: this.#sizes,
      ...this.#steps,
      go: (level) => {
        this.go(level);
      },
    });
  }

  /** Templates are offered while the scene has no block, until the admin starts empty. */
  get offering(): boolean {
    return this.draft.scene.blocks.length === 0 && !this.#empty;
  }

  /** Starts from a template's `filled` draft, one undo step, or from nothing; nothing remembers
   * which (ADR 20). */
  begin(filled?: Draft): void {
    if (filled === undefined) this.#empty = true;
    else this.change(filled);
  }

  go(level: Level): void {
    haptics.soft();
    this.#level = level;
  }

  /** Drills the inspector to what a click in 3D struck, and pulls it up unless it should `peek`: a
   * phone keeps the canvas in view, its handles at hand. */
  pick(hit: Hit, peek = false): void {
    // At the surroundings' own level a tap hides or shows a building instead (ADR 20).
    if (this.level.kind === "import" && this.importing.tap(hit)) return;

    const level = picked(this.draft.scene, hit, this.#opening().pv);

    if (level === null) return;

    this.go(level);
    this.expanded = !peek;
  }

  /** Adds an object and opens it in the pulled-up inspector. */
  add(draft: Draft, level: Level): void {
    this.change(draft);
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

    const refused = this.#refused();

    if (refused !== null) this.go({ kind: "string", index: refused.string });

    if (!("problem" in saved)) {
      this.#history = begin({ scene: saved.scene ?? draft.scene, strings: saved.strings });
    }
  }
}
