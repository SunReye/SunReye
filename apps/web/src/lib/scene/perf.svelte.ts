// The scene's readout as state (ADR 21 "Measuring"): whether the URL asked for it, the studio it
// tells of, and what its switches try in place of this browser's 3D quality. Nothing is kept.
import { asked } from "./perf-lines.ts";
import type { Look } from "./quality.ts";
import type { Studio } from "./studio.ts";

/** What the readout's switches set in place of the look's own. */
export type Trial = Partial<Pick<Look, "occlusion" | "contact" | "pixelRatio" | "shadowMap">>;

class Perf {
  #on = $state(asked(location.hash));
  #studio = $state.raw<Studio>();
  /** What the switches try; empty, the look is drawn as it is. */
  trial = $state.raw<Trial>({});

  /** Whether the readout shows: asked for once, it stays for the page's life. */
  get on(): boolean {
    return this.#on;
  }

  set on(next: boolean) {
    this.#on = next;
  }

  /** Reads the URL again: a route that asks for the readout turns it on. */
  read(): void {
    if (asked(location.hash)) this.#on = true;
  }

  /** The studio the readout tells of: the last one opened. */
  get studio(): Studio | undefined {
    return this.#studio;
  }

  /** `studio` is on show until the release. */
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- three.js draws with it.
  show(studio: Studio): () => void {
    this.#studio = studio;

    return () => {
      if (this.#studio === studio) this.#studio = undefined;
    };
  }

  /** What a studio draws for `look` while the readout shows: the look with what is tried. */
  tried(look: Look): Look {
    return this.#on ? { ...look, ...this.trial } : look;
  }
}

export const perf = new Perf();
