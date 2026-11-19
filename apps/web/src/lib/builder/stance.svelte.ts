// How the picked object is held (ADR 20), besides the level it stands on: whether its ring shows,
// and the wall spot a tap struck. Held by the page; picking anything else lets go of both.
import { haptics } from "../haptics.ts";
import type { Level } from "./levels.ts";
import type { Modules } from "./pv.ts";
import type { Hit } from "./scene.ts";
import { spotAt, type WallSpot } from "./wall-spot.ts";

export class Stance {
  /** The turn mode: the picked object's ring shows, and a drag anywhere turns it. */
  turning = $state(false);

  /** Where the last tap struck the picked block's wall, until the draft or the pick changes. */
  spot = $state.raw<WallSpot>();

  /** A tap that picked `level` struck `hit`: on a block's wall, that is its spot. */
  strike(level: Level, hit: Hit, walls: Modules["walls"]): void {
    this.spot =
      level.kind === "block" && hit.kind === "point"
        ? spotAt(walls, level.index, hit.point)
        : undefined;
  }

  /** Something was picked: felt, and what was held of the last is let go. */
  left(): void {
    haptics.soft();
    this.turning = false;
    this.spot = undefined;
  }
}
