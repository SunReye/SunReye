// The live stream's state, app-wide: the shell's connection chip shows it and every live number
// stops gliding while it is halted (ADR 21).
import type { Core, Live } from "../api/core.ts";
import { streamState, type StreamState } from "./stream.ts";

class Stream {
  #live = $state.raw<Live>();

  readonly state: StreamState = $derived(streamState(this.#live));

  /** Stalled or lost: nothing new is arriving. */
  readonly halted: boolean = $derived(this.state.kind === "stalled" || this.state.kind === "lost");

  /** When the last frame arrived, in epoch milliseconds. */
  #at = $state(0);

  get at(): number {
    return this.#at;
  }

  /** Follows the core's stream until the disposer runs. */
  follow(core: Readonly<Pick<Core, "live">>): () => void {
    const stop = core.live((live) => {
      this.#live = live;
      this.#at = Date.now();
    });

    return () => {
      stop();
      this.#live = undefined;
    };
  }
}

export const stream = new Stream();
