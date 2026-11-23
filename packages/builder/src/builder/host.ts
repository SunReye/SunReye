// What the builder asks of the app that hosts it (ADR 25 "What it asks of its host"), each a shape
// it names: Home's core and toasts answer them as they are.
import { createContext } from "svelte";
import type { Datasheet, Layout, ModuleType, Scene, StringDraft, Types } from "@sunreye/scene";

// The scene's types these shapes name, for the parts that read both.
export type { Datasheet, Layout, ModuleType, StringDraft, Types };

/** A refusal's stable code (ADR 9), and the member at fault as a JSON pointer where it is named. */
export interface Problem {
  readonly problem: string;
  readonly pointer?: string;
}

/** A device the plant's objects may name: an inverter, a meter, a loadpoint. */
export interface Device {
  readonly id: number;
  readonly name: string;
  /** Its profile's id: `evcc` is a loadpoint a car place may name. */
  readonly profile: string;
}

/** A layout change as the builder makes it; its modules name their string by position in
 * `strings`. */
export interface LayoutChange {
  /** RFC 3339. */
  readonly appliesFrom: string;
  readonly strings: readonly Readonly<StringDraft>[];
  readonly scene: Scene;
  /** Kept as the layout in force has them: a change without them removes them. */
  readonly types?: Types | undefined;
}

/** The writes an editing session makes. */
export interface Keeper {
  changeLayout(change: LayoutChange): Promise<Layout | Problem>;
  addModuleType(datasheet: Readonly<Datasheet>): Promise<ModuleType | Problem>;
}

export interface Host {
  /** A refusal's code in the host's words (ADRs 9, 11). */
  readonly refusal: (code: string) => string;
  /** What an action did, said as the host says it (ADR 21). */
  readonly confirmed: (text: string) => void;
  /** Stores an uploaded car body: its id, or a refusal. */
  readonly uploadCarBody: (glb: Readonly<Blob>) => Promise<string | Problem>;
}

export const [host, provideHost] = createContext<Host>();
