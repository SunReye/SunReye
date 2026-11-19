// The scene's readout as state (ADR 21 "Measuring"): whether the URL asked for it, the studio it
// tells of, and what its switches try in place of this browser's 3D quality. Nothing is kept.
import { read } from "../kept.ts";
import { MOTION_STRAIN, STRAINED_AT } from "../motion/tier.ts";
import { asked, type Facts } from "./perf-lines.ts";
import { STEPS } from "./quality.svelte.ts";
import type { Look } from "./quality.ts";
import type { Studio } from "./studio.ts";

class Perf {
  #on = $state(asked(location.hash));
  #studio = $state.raw<Studio>();
  /** What the readout's switches set in place of the look's own; empty, the look is drawn as it
   * is. */
  trial = $state.raw<Partial<Pick<Look, "occlusion" | "contact" | "pixelRatio" | "shadowMap">>>({});

  /** Whether the readout shows: asked for once, it stays for the page's life. */
  get on(): boolean {
    return this.#on;
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

/** What this browser keeps of its strains, as kept. */
export function strains(): Facts["strains"] {
  return { drawing: read(STEPS), motion: read(MOTION_STRAIN), at: read(STRAINED_AT) };
}
