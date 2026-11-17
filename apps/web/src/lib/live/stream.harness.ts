// The app's live stream fed by hand: how every live consumer's tests hand it frames (#831).
import { afterEach } from "vitest";
import type { Live } from "../api/core.ts";
import { stream } from "./stream.svelte.ts";

let unfollow: (() => void) | undefined;

afterEach(() => {
  unfollow?.();
  unfollow = undefined;
});

const nothing = (): void => {};

/** Follows the stream from a fake core until the test ends; each call of the result is a frame. */
export function feed(): (live: Live) => void {
  let tell: (live: Live) => void = nothing;

  unfollow?.();
  unfollow = stream.follow({
    live: (listener) => {
      tell = listener;

      return () => {
        tell = nothing;
      };
    },
  });

  return (live) => {
    tell(live);
  };
}
