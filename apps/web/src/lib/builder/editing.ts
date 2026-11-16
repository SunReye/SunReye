// What the handles edit at an inspector level (ADR 20): a selected object, or the imported
// surroundings whole. Pure.
import type { Editing } from "./handles/grabbing.ts";
import type { Level } from "./levels.ts";

/** What every level's handles share: the scene, the crate and where a drag goes. */
export type Handling = Omit<Editing, "target" | "rests">;

const HANDLED: ReadonlySet<string> = new Set([
  "block",
  "obstacle",
  "surface",
  "fence",
  "place",
  "chimney",
  "roofWindow",
  "opening",
]);

/** A selected block, obstacle, ground surface, fence, car place, chimney, roof window or
 * opening's handles,
 * or the imported surroundings' knob and ring with the turns `rests` gives the ring; none for
 * any other level, or without an import. */
export function editingOf(
  level: Level,
  handling: Handling,
  rests: () => readonly number[],
): Editing | undefined {
  if (level.kind === "import") {
    return handling.scene.imported
      ? { ...handling, target: { kind: "import", index: 0 }, rests: rests() }
      : undefined;
  }

  return "index" in level &&
    HANDLED.has(level.kind) &&
    level.kind !== "marker" &&
    level.kind !== "string"
    ? { ...handling, target: { kind: level.kind, index: level.index } }
    : undefined;
}
