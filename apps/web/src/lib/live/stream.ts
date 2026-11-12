// What the connection chip says about the live stream (ADR 21).
import type { Live } from "../api/core.ts";

export type StreamState =
  | { readonly kind: "connecting" }
  | { readonly kind: "live" }
  /** Connected, but every value is past its gap threshold (ADR 3), the newest read at `since`. */
  | { readonly kind: "stalled"; readonly since: number }
  /** Broken at `since`, or refused for `problem`. */
  | { readonly kind: "lost"; readonly since?: number; readonly problem?: string };

export function streamState(live?: Live): StreamState {
  if (live === undefined) return { kind: "connecting" };

  if ("problem" in live) return { kind: "lost", problem: live.problem };

  if (live.lost !== undefined) return { kind: "lost", since: live.lost };

  const values = Object.keys(live.devices).flatMap((device) =>
    Object.keys(live.devices[device] ?? {}).map((name) => live.stale?.[device]?.[name]),
  );

  const read = values.filter((at) => at !== undefined);

  return values.length > 0 && read.length === values.length
    ? { kind: "stalled", since: Math.max(...read) }
    : { kind: "live" };
}

/** How long ago `since` was at `now`, both in epoch milliseconds. */
export function age(since: number, now: number): string {
  const seconds = Math.max(Math.round((now - since) / 1000), 0);

  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
