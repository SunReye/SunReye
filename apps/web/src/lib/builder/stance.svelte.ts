// How the picked object is held (ADR 20), besides the level it stands on: whether its ring shows.
// Held by the page; picking anything else lets go of it.
import { haptics } from "../haptics.ts";

export class Stance {
  /** The turn mode: the picked object's ring shows and turns it, and nothing else of it drags. */
  turning = $state(false);

  /** Something was picked: felt, and what was held of the last is let go. */
  left(): void {
    haptics.soft();
    this.turning = false;
  }
}
