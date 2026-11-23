// What the builder asks of the app that hosts it (ADR 25 "What it asks of its host"), each a shape
// it names: Home's core and toasts answer them as they are.
import { createContext } from "svelte";
import type { Datasheet, Layout, ModuleType, Scene, StringDraft, Types } from "@sunreye/scene";
import type { ModelLoader } from "../cars/garage.ts";
import type { Weather } from "../scene/scene-weather.ts";

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

/** Watts from `from` to before `to`, in ms since 1970. */
export interface Interval {
  readonly from: number;
  readonly to: number;
  readonly watts: number;
}

/** A day as the browser's calendar has it: its midnight and the next. */
export type Span = readonly [Date, Date];

/** Each MPPT input's learned correction by month and hour, and its last 30 days measured against
 * the model (ADR 20). */
export interface Corrections {
  readonly inputs: readonly {
    readonly device: number;
    readonly input: number;
    readonly factors: readonly {
      readonly month: number;
      readonly hour: number;
      readonly factor: number;
    }[];
    readonly recent?: { readonly measured: number; readonly modelled: number } | null;
  }[];
}

/** What the builder's frame reads of its host besides the scene (ADR 25 "What the frame reads of
 * its host"). Each is optional: without one the frame runs a clear sky, shows no stored weather,
 * no model check or no uploaded car body. */
export interface Records {
  /** A saved string's measured or forecast production through `span`; none, empty. */
  readonly production?: (
    string: { readonly id: number; readonly device: number },
    source: "measured" | "forecast",
    span: Span,
  ) => Promise<readonly Interval[]>;
  /** The stored weather through `span`: the weather at an instant, as it was known at `asOf`. */
  readonly weather?: (span: Span) => Promise<(at: number, asOf: number) => Weather>;
  readonly corrections?: () => Promise<Corrections | Problem>;
  /** Reads an uploaded car body. */
  readonly model?: ModelLoader;
  /** The live values by device id, then by series name, as last read; read in a derived, so a
   * reactive source is followed. Without them no car is parked. */
  readonly live?: () => Readonly<Record<string, Readonly<Record<string, number>>>>;
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
