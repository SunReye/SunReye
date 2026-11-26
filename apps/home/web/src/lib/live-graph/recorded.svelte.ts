// The live stream as the dashboard keeps it: the latest frame, and every live power's last two
// minutes, recorded from when the dashboard opened so a sheet opens with its graph (ADR 21, #831).
import { untrack } from "svelte";
import type { Live } from "../api/core.ts";
import { stream } from "../live/stream.svelte.ts";
import { record, type LiveSeries } from "./series.ts";

export class Recorded {
  #series = $state.raw<LiveSeries>({});

  /** Made in a component's init: it records while the component lives. */
  constructor() {
    // The store holds the latest frame; each one extends the graphs.
    $effect(() => {
      const next = stream.live;

      if (next !== undefined && "devices" in next)
        this.#series = untrack(() => record(this.#series, next, Date.now()));
    });
  }

  /** The latest frame, a refusal included. */
  get live(): Live | undefined {
    return stream.live;
  }

  get series(): LiveSeries {
    return this.#series;
  }
}
