// Which dashboard a browser opens on (ADR 11, 20).
import type { Core, Layout } from "../api/core.ts";
import type { Scene } from "../builder/pv.ts";

export type View = "3d" | "2d";

/** Where each browser keeps its toggle and its low-power switch. */
export const CHOICE = "sunreye.dashboard";
export const LOW_POWER = "sunreye.low-power";

/** The toggle as a browser kept it; null before it was first used. */
export function keptChoice(value: string | null): View | null {
  return value === "3d" || value === "2d" ? value : null;
}

/** What a browser can and chose. `choice` is its toggle; null before it was first used. */
export interface Means {
  readonly scene: boolean;
  readonly webgl2: boolean;
  readonly lowPower: boolean;
  readonly choice: View | null;
}

export interface Shown {
  readonly shows: View;
  /** Whether the toggle between them is offered. */
  readonly toggles: boolean;
}

/** The 3D scene once a scene exists, unless WebGL2 is missing, power is saved or 2D chosen. */
export function dashboard({ scene, webgl2, lowPower, choice }: Means): Shown {
  const toggles = scene && webgl2 && !lowPower;

  return { shows: toggles && choice !== "2d" ? "3d" : "2d", toggles };
}

/** A layout that has a scene. */
export type SceneLayout = Layout & { readonly scene: Scene };

/** The layout in force when it has a scene; viewers read it too (ADR 20). */
export async function sceneLayout(
  core: Readonly<Pick<Core, "layout">>,
): Promise<SceneLayout | null> {
  const read = await core.layout().catch(() => null);

  return read === null || "problem" in read || read.scene === undefined || read.scene === null
    ? null
    : { ...read, scene: read.scene };
}
