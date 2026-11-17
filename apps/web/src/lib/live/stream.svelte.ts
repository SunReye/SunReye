// The live stream's state, app-wide: the shell's connection chip shows it and every live number
// stops gliding while it is halted (ADR 21). Every live consumer reads it, never `core.live` (#831).
import { PLANT, type Core, type Live, type Values } from "../api/core.ts";
import { motion } from "../motion/tier.svelte.ts";
import { glideDurationMs, TICK_MS } from "./glide.ts";
import { streamState, type StreamState } from "./stream.ts";

class Stream {
  #live = $state.raw<Live>();

  #values = $state.raw<Values>();

  /** The latest frame, a refusal included; none before the first or while nobody follows. */
  get live(): Live | undefined {
    return this.#live;
  }

  /** The latest frame with values, kept through a refusal. */
  get values(): Values | undefined {
    return this.#values;
  }

  readonly state: StreamState = $derived(streamState(this.#live));

  /** Stalled or lost: nothing new is arriving. */
  readonly halted: boolean = $derived(this.state.kind === "stalled" || this.state.kind === "lost");

  /** The `plant` device's values; none before the first frame or while the stream is refused. */
  readonly plant: Readonly<Record<string, number>> | undefined = $derived(
    this.#live !== undefined && "devices" in this.#live ? this.#live.devices[PLANT] : undefined,
  );

  /** When the last frame arrived, in epoch milliseconds. */
  #at = $state(0);

  get at(): number {
    return this.#at;
  }

  #followers = 0;

  #stop = (): void => {};

  /**
   * Follows the core's stream until the disposer runs. Followers share one subscription: the first
   * starts it, the last stops it and clears the values.
   */
  follow(core: Readonly<Pick<Core, "live">>): () => void {
    this.#followers++;

    if (this.#followers === 1) {
      this.#stop = core.live((live) => {
        this.#live = live;

        if (!("problem" in live)) this.#values = live;
        this.#at = Date.now();
      });
    }

    let followed = true;

    return () => {
      if (!followed) return;

      followed = false;
      this.#followers--;

      if (this.#followers > 0) return;

      this.#stop();
      this.#live = undefined;
      this.#values = undefined;
    };
  }
}

export const stream = new Stream();

/** How long a live value glides to a tick now: a step while still or halted (ADR 21). */
export function tickGlideMs(): number {
  return glideDurationMs(TICK_MS, motion.still || stream.halted);
}
