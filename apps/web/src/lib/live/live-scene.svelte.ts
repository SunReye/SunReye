// The live scene's chips and shares from the live stream's latest values (ADR 20, #831).
import { liveScene, type Live3d, type LiveScene } from "./labels.ts";
import { stream } from "./stream.svelte.ts";

export type { Chip } from "./labels.ts";

/** The scene as the stream last read it; read in a derived, it follows the stream. */
export function liveSceneNow(input: Omit<Live3d, "values" | "stale">): LiveScene {
  return liveScene({
    ...input,
    values: stream.values?.devices ?? {},
    stale: stream.values?.stale,
  });
}
