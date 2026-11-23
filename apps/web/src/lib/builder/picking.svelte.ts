// What is picked in the builder (ADR 20) and how it is held: the level the inspector stands on,
// whether its object's ring shows, and the wall spot a tap struck. Held by the page.
import { haptics } from "@sunreye/ui/haptics";
import type { Level } from "@sunreye/builder/builder/levels.ts";
import type { Modules, Scene } from "@sunreye/builder/builder/pv.ts";
import type { Hit } from "@sunreye/builder/builder/scene.ts";
import { spotAt, type WallSpot } from "./wall-spot.ts";

export class Picking {
  /** Where the inspector stands, as last chosen. */
  level = $state.raw<Level>({ kind: "root" });

  /** The turn mode: the picked object's ring shows, and a drag anywhere turns it. */
  turning = $state(false);

  /** Where the last tap struck the picked block's wall, until the draft or the pick changes. */
  spot = $state.raw<WallSpot>();

  /** Picks `level`: felt, and what was held of the last pick is let go. */
  go(level: Level): void {
    haptics.soft();
    this.turning = false;
    this.spot = undefined;
    this.level = level;
  }

  /** The tap that picked the level struck `hit`: on a block's wall, that is its spot. A free-form
   * block's walls take no opening or marker (ADR 20), so have none. */
  strike(hit: Hit, walls: Modules["walls"], scene: Scene): void {
    const { level } = this;

    this.spot =
      level.kind === "block" && hit.kind === "point" && !scene.blocks[level.index]?.freeForm
        ? spotAt(walls, level.index, hit.point)
        : undefined;
  }
}
