// The live readings setup proposes its measurement points from (ADR 14, #831).
import type { Core, Device, PointDraft, Values } from "../api/core.ts";
import { stream } from "../live/stream.svelte.ts";
import { roleWord } from "./point-look.ts";
import { left, propose } from "./topology.ts";

export class Readings {
  /** Made in a component's init. Setup shows no shell, whose layout follows the stream elsewhere,
   * so the readings follow it while the component lives. */
  constructor(core: () => Readonly<Pick<Core, "live">>) {
    $effect(() => stream.follow(core()));
  }

  /** The latest values; none before the first. */
  get values(): Values | undefined {
    return stream.values;
  }

  /** The tree the readings propose; none before the first. */
  proposed(devices: readonly Readonly<Device>[]): PointDraft[] | undefined {
    const values = this.values;

    return values === undefined
      ? undefined
      : propose(devices, values, roleWord("grid.power"), roleWord);
  }

  /** The points the devices could measure that `points` leaves out. */
  left(points: readonly PointDraft[], devices: readonly Readonly<Device>[]): PointDraft[] {
    const values = this.values;

    return values === undefined ? [] : left(points, devices, values, roleWord);
  }
}
