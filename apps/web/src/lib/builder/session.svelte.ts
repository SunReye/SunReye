// One editing session of the builder (ADR 20): the draft with undo and redo until save, what the
// crate makes of it, and the inspector's level.
import type { Core, Datasheet, Device, Layout, ModuleType, Problem, Types } from "../api/core.ts";
import { checked, stringRefusal, type Checking, type StringRefusal } from "./checks.ts";
import { Drafts } from "./drafts.svelte.ts";
import { handled, parent, picked, type Level } from "./levels.ts";
import { wiredIn, panels, type Draft } from "./modules.ts";
import { exists, type Plan } from "./outline.ts";
import type { Geometry, Modules, Pv, Scene, Sizes } from "./pv.ts";
import { layingOf, type Editing, type Hit, type Roofwork, type Panel } from "./drawing.svelte.ts";
import { Picking } from "./picking.svelte.ts";
import { WiringMode } from "./wiring-mode.svelte.ts";

/** Today in the browser's calendar, as a date input holds it: Sweden writes `YYYY-MM-DD`. */
const today = (): string => new Date().toLocaleDateString("sv-SE");

/** What a session reads: the crate, the core, the layout in force and the plant's devices. */
export interface Reads extends Checking {
  readonly pv: Pv;
  readonly core: Core;
  /** The layout in force, or an empty one: nothing to undo before it. */
  readonly start: Draft;
  /** The inverter and battery types of the layout in force, which a save keeps (ADR 27). */
  readonly types?: Readonly<Types> | undefined;
  readonly moduleTypes: readonly Readonly<ModuleType>[];
  readonly devices: readonly Readonly<Device>[];
}

export class Session {
  readonly #opening: () => Reads;

  readonly #drafts: Drafts;

  readonly geometry: Geometry;

  /** The crate's layout of the draft's grids. */
  readonly laid: Modules;

  /** The placed modules, to draw. */
  readonly panels: readonly Panel[];

  readonly plan: Plan;

  /** Each module type's size, by its id. */
  readonly #sizes: Sizes;

  /** The day the saved layout applies from, `YYYY-MM-DD`. */
  appliesFrom = $state(today());

  /** The last save's answer, until the next edit. */
  saved = $state.raw<Layout | Problem>();

  /** Whether a click in 3D asked the inspector to show itself. */
  expanded = $state(false);

  /** The wiring mode: its selection, and what wiring it makes of the draft (ADR 20). */
  readonly wiring = new WiringMode(this, () => ({
    ...this.#opening(),
    moduleTypes: this.moduleTypes,
  }));

  /** What is picked, and how it is held: the turn mode and the wall spot. */
  readonly picking = new Picking();

  /** Whether the admin chose to start from nothing. */
  #empty = $state(false);

  /** Module types added in this session; the core keeps them, no undo takes them back. */
  #added = $state.raw<readonly ModuleType[]>([]);

  constructor(opening: () => Reads) {
    this.#opening = opening;
    // The start is where this session begins; a later one is a new session's.
    this.#drafts = new Drafts(opening().start, (scene) => opening().pv.covered(scene, this.#sizes));

    this.#sizes = $derived(
      Object.fromEntries(this.moduleTypes.map(({ id, width, height }) => [id, { width, height }])),
    );

    this.geometry = $derived(opening().pv.geometry(this.draft.scene));
    this.laid = $derived(opening().pv.modules(this.draft.scene, this.#sizes));
    this.panels = $derived(this.wiring.lit(panels(this.draft.scene, this.laid.grids)));
    this.plan = $derived({
      draft: this.draft,
      laid: this.laid,
      pv: opening().pv,
      sizes: this.#sizes,
      devices: opening().devices,
      ...checked(opening(), this.draft, this.moduleTypes),
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

  #refused(): StringRefusal | null {
    const { saved } = this;
    const names = this.draft.strings.map(({ name }) => name);

    return saved !== undefined && "problem" in saved ? stringRefusal(saved, names) : null;
  }

  /** The draft as recorded: without a drag's step or a proposal. */
  get present(): Draft {
    return this.#drafts.present;
  }

  get draft(): Draft {
    return this.#drafts.dragged ?? this.wiring.proposal ?? this.#drafts.present;
  }

  get undoable(): boolean {
    return this.#drafts.undoable;
  }

  get redoable(): boolean {
    return this.#drafts.redoable;
  }

  /** The level shown: an undo or a removal can take its object away, and its group shows instead. */
  get level(): Level {
    const { level } = this.picking;

    return exists(level, this.plan) ? level : parent(level);
  }

  /** Records `next` as one undo step. While a proposal shows, the edit was made of it: the
   * proposal is dropped and nothing recorded, for only Keep or a save keeps one (ADR 20). */
  change(next: Draft): void {
    if (this.wiring.proposal !== undefined) {
      this.wiring.discard();

      return;
    }

    this.picking.spot = undefined;
    this.#drafts.record(next);
    this.saved = undefined;
  }

  /** Shows a handle drag's step at once; `drop` records the drag as one undo step (ADR 20). */
  drag(scene: Scene): void {
    this.#drafts.drag(scene);
  }

  drop(): void {
    const dragged = this.#drafts.drop();

    if (dragged !== undefined) this.change(dragged);
  }

  /** Either drops a proposal: a redo back to its draft must not bring it back. */
  undo(): void {
    this.wiring.discard();
    this.picking.spot = undefined;
    this.#drafts.undo();
  }

  redo(): void {
    this.wiring.discard();
    this.picking.spot = undefined;
    this.#drafts.redo();
  }

  /** A selected block, obstacle, ground surface, fence, car place, chimney or opening's handles,
   * and where their drags go. */
  get editing(): Editing | undefined {
    const { level } = this;

    if (!handled(level)) return undefined;

    return {
      scene: this.draft.scene,
      target: { kind: level.kind, index: level.index },
      pv: this.#opening().pv,
      laid: this.laid,
      turning: this.picking.turning,
      ondrag: (scene) => {
        this.drag(scene);
      },
      ondrop: () => {
        this.drop();
      },
    };
  }

  /** The selected face's grid, on whose roof a press in 3D lays modules, or the wiring mode, in
   * which a drag across modules selects them (ADR 20). */
  get roofwork(): Roofwork | undefined {
    return (
      this.wiring.roofwork ??
      layingOf(this.level, {
        draft: this.draft,
        laid: this.laid,
        pv: this.#opening().pv,
        sizes: this.#sizes,
        ondrag: (scene) => {
          this.drag(scene);
        },
        ondrop: () => {
          this.drop();
        },
        go: (level) => {
          this.go(level);
        },
      })
    );
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
    this.wiring.entered(level);
    this.picking.go(level);
  }

  /** Drills the inspector to what a click in 3D struck, and pulls it up unless it should `peek`: a
   * phone keeps the canvas in view, its handles at hand. */
  pick(hit: Hit, peek = false): void {
    const level = picked(this.draft.scene, hit, this.#opening().pv);

    if (this.wiring.aimed(level) || level === null) return;

    this.go(level);
    this.picking.strike(hit, this.laid.walls);
    // A wall spot's toolbar is on the canvas: the inspector stays where it is.
    this.expanded = !peek && this.picking.spot === undefined;
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
    const strings = draft.strings.map((string, i) => ({ ...string, ...wiredIn(draft.scene, i) }));

    const saved = await this.#opening().core.changeLayout({
      appliesFrom: new Date(`${this.appliesFrom}T00:00`).toISOString(),
      strings,
      scene: draft.scene,
      types: this.#opening().types,
    });

    this.saved = saved;

    const refused = this.#refused();

    if (refused !== null) this.go({ kind: "string", index: refused.string });

    if (!("problem" in saved)) {
      this.#drafts.begin({ scene: saved.scene ?? draft.scene, strings: saved.strings });
    }
  }
}
