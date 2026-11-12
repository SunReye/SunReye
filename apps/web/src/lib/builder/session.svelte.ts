// One editing session of the builder (ADR 20): the draft with undo and redo until save, what the
// crate makes of it, and the inspector's level.
import type { Core, Device, Layout, ModuleType, Problem } from "../api/core.ts";
import { haptics } from "../haptics.ts";
import { begin, record, redo, undo, type Edits } from "./history.ts";
import { parent, picked, type Level } from "./levels.ts";
import { painted, panels, type Draft } from "./modules.ts";
import { exists, type Plan } from "./outline.ts";
import type { Geometry, Modules, Pv } from "./pv.ts";
import type { Hit, Panel } from "./scene.ts";

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
    this.plan = $derived({ draft: this.draft, laid: this.laid, devices: opening().devices });
  }

  get draft(): Draft {
    return this.#history.present;
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

  undo(): void {
    this.#history = undo(this.#history);
  }

  redo(): void {
    this.#history = redo(this.#history);
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
